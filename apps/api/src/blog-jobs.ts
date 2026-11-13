/** blog.generate on the worker: one article draft through the skills harness.
 *
 * The API snapshotted the request and enqueued the job; it holds no model key. Every harness
 * model call is reserved before it is made (campaign_blog_step_calls), against the business's
 * planning credit shared with plans and earlier articles, so a replay never pays twice.
 * An uncertain call leaves the job 'unknown'; the customer may release it with stop-waiting.
 */
import OpenAI from 'openai';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {AssetJobs,type JobScope} from './jobs.js';
import {SkillRuntime} from './skill-runtime.js';
import {CreativeProvider} from './creative-provider.js';
import {CreativeError,type PlannerRequest,type PlannerResponse} from './creative-contracts.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {exceedsAllowance,monthlyBudgetExceeded} from './spending-allowance.js';
import {packForJob,promptKnowledge,type StoredKnowledge} from './knowledge-production.js';
import {BLOG_OUTPUT_TOKENS,blogSchema,validateBlogInput,validateBlogResult,type BlogInput,type BlogResult} from './blog-contracts.js';
import {CHARGED_MICROS} from './call-settlement.js';

const terminal=new Set(['succeeded','failed','rejected','canceled','unknown']);
const UNCERTAIN=['BLOG_SUBMISSION_UNKNOWN','BLOG_REPLAY_MISMATCH'];
/** Shared planning credit: plans, earlier articles and this article's own steps. */
const USED_SQL=`SELECT COALESCE(sum(n),0) AS n FROM (
 SELECT ${CHARGED_MICROS} n FROM app.planning_calls WHERE organization_id=$1 AND brand_id=$2 AND provider='openai'
 UNION ALL SELECT reserved_micros FROM app.campaign_blog_calls WHERE organization_id=$1 AND brand_id=$2) q`;
type Job={id:string;kind:string;status:string;organization_id:string;brand_id:string};
type BlogRequest={job_id:string;blog_id:string;call_id:string;revision:number;model:string;requested_by:string;input:BlogInput;input_sha256:string;knowledge_context:StoredKnowledge|null;output:BlogResult|null};
/** SkillRuntime.run is the shared harness entry; the runtime has no public blog task yet. */
type HarnessRun=<T>(input:unknown,model:(request:PlannerRequest)=>Promise<PlannerResponse>,validate:(value:unknown)=>T)=>Promise<T>;

export class BlogJobs{
 constructor(readonly jobs:AssetJobs,readonly runtime:SkillRuntime,readonly provider:CreativeProvider){}
 private finish(db:PoolClient,job:Job,status:string,code:string|null=null):Promise<string>{
  return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[job.id,status,code]).then(()=>status);
 }
 /** Settles the job and its article request together. */
 private async settle(db:PoolClient,job:Job,status:string,code:string|null):Promise<string>{
  const call=status==='canceled'||status==='failed'?'rejected':status;
  await db.query("UPDATE app.campaign_blog_calls SET status=$2,error_code=$3 WHERE job_id=$1 AND status='submitted'",[job.id,call,code]);
  return this.finish(db,job,status,code);
 }
 private harness(input:BlogInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<BlogResult>{
  validateBlogInput(input);
  const run=(this.runtime as unknown as {run:HarnessRun}).run.bind(this.runtime);
  return run(input,request=>model({...request,content_plan_schema:blogSchema()}),validateBlogResult);
 }
 /** One reserved harness step. Mirrors the other worker ledgers: reserve, call, record. */
 async call(scope:JobScope,message:PlannerRequest,model:string):Promise<PlannerResponse>{
  const wire=this.provider.plannerRequest(message,model,BLOG_OUTPUT_TOKENS);
  const prepared=await this.jobs.transaction(scope,async(db,j):Promise<{cached?:PlannerResponse;blocked?:string}>=>{
   if(j.kind!=='blog.generate')throw new Error('JOB_KIND_DENIED');
   if(!await this.jobs.permitted(db,j))throw new CreativeError('BLOG_ACCESS_REVOKED');
   const prior=(await db.query('SELECT * FROM app.campaign_blog_step_calls WHERE job_id=$1 AND step=$2',[j.id,message.step])).rows[0];
   if(prior){
    if(prior.model!==model||prior.input_sha256!==wire.sha256)return {blocked:'BLOG_REPLAY_MISMATCH'};
    if(prior.status==='succeeded')return {cached:prior.result};
    if(prior.status==='submitted')await db.query("UPDATE app.campaign_blog_step_calls SET status='unknown' WHERE job_id=$1 AND step=$2",[j.id,message.step]);
    return {blocked:prior.status==='rejected'?'BLOG_PROVIDER_REJECTED':'BLOG_SUBMISSION_UNKNOWN'};
   }
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`planning-budget:${j.brand_id.toLowerCase()}`]);
   const grant=(await db.query("SELECT * FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider='openai' AND enabled AND expires_at>now()",[j.organization_id,j.brand_id])).rows[0];
   if(!grant)throw new CreativeError('BLOG_GRANT_REQUIRED');
   if(grant.model!==model)throw new CreativeError('BLOG_CONFIG_CHANGED');
   const cost=Math.ceil(wire.maxInputTokens*Number(grant.input_micros_per_token)+wire.maxOutputTokens*Number(grant.output_micros_per_token));
   const used=Number((await db.query(USED_SQL,[j.organization_id,j.brand_id])).rows[0].n);
   if(!Number.isSafeInteger(cost)||cost<=0||exceedsAllowance(used+cost,grant.budget_micros))throw new CreativeError('BLOG_BUDGET_EXHAUSTED');
   await db.query("INSERT INTO app.campaign_blog_step_calls(job_id,step,organization_id,brand_id,model,input_sha256,reserved_micros,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')",[j.id,message.step,j.organization_id,j.brand_id,model,wire.sha256,cost]);
   // The request row carries the running total, so plans and later articles see this spend.
   await db.query('UPDATE app.campaign_blog_calls SET reserved_micros=reserved_micros+$2 WHERE job_id=$1',[j.id,cost]);
   return {};
  }).catch(error=>{if(monthlyBudgetExceeded(error))throw new CreativeError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');throw error;});
  if(prepared.cached)return prepared.cached;
  if(prepared.blocked)throw new CreativeError(prepared.blocked);
  let result:PlannerResponse;
  try{result=await this.provider.plan(message,model,BLOG_OUTPUT_TOKENS);}catch(error){
   const known=error instanceof CreativeError||(error instanceof OpenAI.APIError&&[400,401,403,404,422,429].includes(error.status??0));
   await this.jobs.transaction(scope,db=>db.query('UPDATE app.campaign_blog_step_calls SET status=$3 WHERE job_id=$1 AND step=$2',[scope.jobId,message.step,known?'rejected':'unknown']));
   throw new CreativeError(known?'BLOG_PROVIDER_REJECTED':'BLOG_SUBMISSION_UNKNOWN');
  }
  // A lost commit after provider success stays submitted; a replay never resubmits it.
  await this.jobs.transaction(scope,db=>db.query("UPDATE app.campaign_blog_step_calls SET status='succeeded',result=$3 WHERE job_id=$1 AND step=$2",[scope.jobId,message.step,JSON.stringify(result)]));
  return result;
 }
 /** Stored before any model call, so a replay sends the same input. */
 private async knowledge(db:PoolClient,job:Job,request:BlogRequest):Promise<StoredKnowledge>{
  if(request.knowledge_context)return request.knowledge_context;
  const started=(await db.query('SELECT 1 FROM app.campaign_blog_step_calls WHERE job_id=$1 LIMIT 1',[job.id])).rowCount;
  const stored:StoredKnowledge=started||request.output?{status:'skipped',reason:'KNOWLEDGE_JOB_ALREADY_STARTED'}
   :await packForJob(db,{organizationId:job.organization_id,brandId:job.brand_id},'plan',`${request.input.topic}\n${request.input.context}`);
  await db.query('UPDATE app.campaign_blog_requests SET knowledge_context=$2 WHERE job_id=$1',[job.id,JSON.stringify(stored)]);
  return stored;
 }
 async run(scope:JobScope):Promise<string>{
  try{
   const request=await this.jobs.transaction(scope,async(db,j):Promise<BlogRequest|null>=>{
    if(j.kind!=='blog.generate')throw new Error('JOB_KIND_DENIED');
    if(terminal.has(j.status))return null;
    if(!await this.jobs.permitted(db,j)){await this.settle(db,j,'canceled','BLOG_ACCESS_REVOKED');return null;}
    const r:BlogRequest|undefined=(await db.query('SELECT * FROM app.campaign_blog_requests WHERE job_id=$1',[j.id])).rows[0];
    if(!r||hash(canonicalJSON(r.input))!==r.input_sha256)throw new CreativeError('BLOG_INPUT_CHANGED');
    if(!r.output&&(!this.runtime.configured||!this.provider.configured))throw new CreativeError('BLOG_NOT_CONFIGURED');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",[j.id]);
    return {...r,knowledge_context:await this.knowledge(db,j,r)};
   });
   if(!request)return 'finished';
   const pack=request.knowledge_context?promptKnowledge(request.knowledge_context):undefined;
   const input:BlogInput=pack?{...request.input,brand:{...request.input.brand,knowledge:pack}}:request.input;
   const result=request.output??await this.harness(input,message=>this.call(scope,message,request.model));
   return await this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    if(!await this.jobs.permitted(db,j))return this.settle(db,j,'canceled','BLOG_ACCESS_REVOKED');
    // The article is kept even when it can no longer be applied.
    await db.query('UPDATE app.campaign_blog_requests SET output=$2 WHERE job_id=$1',[j.id,JSON.stringify(result)]);
    const blog=(await db.query('SELECT revision,state FROM app.campaign_blogs WHERE id=$1 FOR UPDATE',[request.blog_id])).rows[0];
    if(!blog||blog.revision!==request.revision||blog.state==='archived')return this.settle(db,j,'rejected','BLOG_REVISION_CHANGED');
    const version=randomUUID();
    await db.query('INSERT INTO app.campaign_blog_versions(id,organization_id,brand_id,blog_id,title,body,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[version,j.organization_id,j.brand_id,request.blog_id,result.article.title,result.article.body,request.requested_by]);
    await db.query("UPDATE app.campaign_blogs SET title=$2,latest_version_id=$3,state='draft',revision=revision+1 WHERE id=$1",[request.blog_id,result.article.title,version]);
    await db.query("UPDATE app.campaign_blog_calls SET status='succeeded',error_code=NULL,version_id=$2 WHERE job_id=$1",[j.id,version]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){
   if(!(error instanceof CreativeError))throw error;
   return this.jobs.transaction(scope,(db,j)=>terminal.has(j.status)?j.status:this.settle(db,j,UNCERTAIN.includes(error.code)?'unknown':error.code==='BLOG_ACCESS_REVOKED'?'canceled':'rejected',error.code));
  }
 }
 /** Retries exhausted. A step that may have reached the provider makes the outcome uncertain. */
 fail(scope:JobScope):Promise<string>{
  return this.jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='blog.generate')throw new Error('JOB_KIND_DENIED');
   if(terminal.has(j.status))return j.status;
   const uncertain=(await db.query("SELECT 1 FROM app.campaign_blog_step_calls WHERE job_id=$1 AND status IN ('submitted','unknown')",[j.id])).rowCount;
   return this.settle(db,j,uncertain?'unknown':'failed',uncertain?'BLOG_SUBMISSION_UNKNOWN':'BLOG_RETRIES_EXHAUSTED');
  });
 }
}
