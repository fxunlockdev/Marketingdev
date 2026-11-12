import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {canonicalJSON,hash} from './brand-brain.js';
import type {ContentPlan} from './content-plan.js';
import {CreativeError} from './creative-contracts.js';
import {planningLearning} from './learning-context.js';
import {packForJob,promptKnowledge} from './knowledge-production.js';
import {marketNotes,researchEvidence,savedResearch} from './strategy-evidence.js';
import {object,uuid} from './workspaces.js';
import {strategySnapshot,validateStrategyInput,type StrategyInput,type StrategyResult,type StrategySnapshot} from './strategy-contracts.js';

type Scope={organization_id:string};
const DAILY_STRATEGY_REQUESTS=3;

/** Latest owner-approved strategy as the compact snapshot planners receive. */
export async function approvedStrategy(db:PoolClient,organization:string,brand:string):Promise<StrategySnapshot|undefined>{
 const row=(await db.query("SELECT id,version,sha256,strategy FROM app.brand_strategies WHERE organization_id=$1 AND brand_id=$2 AND status='approved' ORDER BY version DESC LIMIT 1",[organization,brand])).rows[0];
 if(!row)return undefined;
 if(hash(canonicalJSON(row.strategy))!==row.sha256)throw new ConflictException('The approved brand strategy needs an integrity check');
 return strategySnapshot(row);
}

/** Worker side: store the validated result of a strategy job as the next draft version. Idempotent per job. */
export async function saveDraftStrategy(db:PoolClient,job:{id:string;organization_id:string;brand_id:string;requested_by:string},request:{brain_id:string;input_sha256:string;provider:string},result:StrategyResult,model:string):Promise<string>{
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`strategy:${job.brand_id.toLowerCase()}`]);
 const prior=(await db.query('SELECT id FROM app.brand_strategies WHERE job_id=$1',[job.id])).rows[0];
 if(prior)return prior.id;
 const version=(await db.query('SELECT COALESCE(max(version),0)::int+1 AS n FROM app.brand_strategies WHERE organization_id=$1 AND brand_id=$2',[job.organization_id,job.brand_id])).rows[0].n;
 if(version>200)throw new CreativeError('STRATEGY_LIMIT_REACHED');
 const id=randomUUID(),manifest={skills:result.skills,reads:result.reads,runtime:result.version,provider:request.provider,model,model_calls:result.model_calls,input_sha256:request.input_sha256,helpers_executed:false};
 await db.query(`INSERT INTO app.brand_strategies(id,organization_id,brand_id,version,strategy,sha256,brain_id,job_id,skill_manifest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [id,job.organization_id,job.brand_id,version,JSON.stringify(result.strategy),hash(canonicalJSON(result.strategy)),request.brain_id,job.id,JSON.stringify(manifest),job.requested_by]);
 return id;
}

/** What the client did not send is filled from the business's own saved research and knowledge graph, so a strategy
 * is grounded without the browser carrying evidence. Client-supplied values are kept as they are. */
export async function groundedStrategyContext(db:PoolClient,organization:string,brand:string,supplied:Record<string,unknown>):Promise<Record<string,unknown>>{
 const research=await savedResearch(db,organization,brand),evidence=researchEvidence(research),notes=marketNotes(research,12);
 const pack=supplied.context_pack===undefined?promptKnowledge(await packForJob(db,{organizationId:organization,brandId:brand},'plan','brand strategy personas pains angles pillars audience competitors offers')):undefined;
 return {...(supplied.evidence===undefined&&evidence.length?{evidence}:{}),...(supplied.market_research===undefined&&notes.length?{market_research:notes}:{}),...(pack?{context_pack:pack}:{}),...supplied};
}


/** Customer side of the brand strategy: ask for one, read the versions, approve a draft. */
export class BrandStrategies{
 constructor(readonly plans:ContentPlan){}
 /** Queue a strategy run. Research evidence, the knowledge-graph context pack and market notes are optional. */
 request(user:string,id:string,body:unknown,key:unknown):Promise<{id:string;status:string}>{
  const v=object(body??{},['evidence','context_pack','market_research']);
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const requestKey=`strategy:${key}`,requestHash=hash(canonicalJSON({strategy:v,user}));
  return this.plans.scope(user,id,true,async(db:PoolClient,b:Scope)=>{
   const prior=(await db.query('SELECT r.request_hash,j.id,j.status FROM app.planning_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3',[b.organization_id,id,requestKey])).rows[0];
   if(prior){if(prior.request_hash!==requestHash)throw new ConflictException('That request key belongs to another strategy request');return {id:prior.id,status:prior.status};}
   const recent=(await db.query("SELECT count(*) FILTER(WHERE j.status IN ('queued','running','retrying','unknown'))::int AS active,count(*)::int AS today FROM app.jobs j JOIN app.planning_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='plan.generate' AND r.input->>'task'='strategy' AND (j.created_at>now()-interval '1 day' OR j.status IN ('queued','running','retrying','unknown'))",[b.organization_id,id])).rows[0];
   if(recent.active)throw new ConflictException('A brand strategy is already being prepared');
   if(recent.today>=DAILY_STRATEGY_REQUESTS)throw new ConflictException('Daily strategy request limit reached');
   const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY approved_at DESC,id LIMIT 1',[b.organization_id,id])).rows[0];
   if(!brain)throw new ConflictException('Confirm your brand profile before building a strategy');
   if(hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new ConflictException('The approved brand profile needs an integrity check');
   const prefs=(await db.query('SELECT goal,timezone,channels,must_avoid,business_stage,growth_expectation,creative_brief,revision,step FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0];
   if(!prefs||prefs.step!==3)throw new ConflictException('Finish your brand goals before building a strategy');
   const {step,...preferences}=prefs;
   const grounded=await groundedStrategyContext(db,b.organization_id,id,v);
   let input:StrategyInput;
   try{input=validateStrategyInput({task:'strategy',brand:{id:brain.id,sha256:brain.sha256,learning:await planningLearning(db),facts:brain.snapshot.facts.map((f:{id:string;field:string;value:string})=>({id:f.id,field:f.field,value:f.value}))},preferences,...grounded});}
   catch{throw new BadRequestException('Check the research evidence and context supplied for this strategy');}
   const grant=(await db.query("SELECT model FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider='openai' AND enabled AND expires_at>now()",[b.organization_id,id])).rows[0];
   // The worker compares scheduled_at with its own clock; use the API clock, as plan requests do, not the database's.
   const job=randomUUID(),due=new Date().toISOString();
   await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'plan.generate')",[job,b.organization_id,id,user]);
   await db.query("INSERT INTO app.planning_requests(job_id,organization_id,brand_id,brain_id,input,input_sha256,request_key,request_hash,provider,selected_model,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'openai',$9,$10)",[job,b.organization_id,id,brain.id,JSON.stringify(input),hash(canonicalJSON(input)),requestKey,requestHash,grant?.model??null,due]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind,available_at) VALUES($1,$2,$3,'plan.generate',$4)",[job,b.organization_id,id,due]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'plan.requested',$4)",[b.organization_id,id,user,job]);
   return {id:job,status:'queued'};
  });
 }
 /** Every version, newest first, with the state of any run still in progress. */
 list(user:string,id:string){
  return this.plans.scope(user,id,false,async(db:PoolClient,b:Scope)=>({
   strategies:(await db.query('SELECT id,version,status,sha256,strategy,created_at,approved_at,approved_by FROM app.brand_strategies WHERE organization_id=$1 AND brand_id=$2 ORDER BY version DESC LIMIT 20',[b.organization_id,id])).rows,
   jobs:(await db.query("SELECT j.id,j.status,j.error_code,j.created_at FROM app.jobs j JOIN app.planning_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='plan.generate' AND r.input->>'task'='strategy' ORDER BY j.created_at DESC,j.id LIMIT 10",[b.organization_id,id])).rows,
  }));
 }
 /** Approve exactly the draft the owner read: the checksum must match the stored version. */
 approve(user:string,id:string,strategyId:string,body:unknown){
  strategyId=uuid(strategyId);const v=object(body,['sha256']);
  if(typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw new BadRequestException('Include the checksum of the strategy you reviewed');
  return this.plans.scope(user,id,true,async(db:PoolClient,b:Scope)=>{
   const row=(await db.query('SELECT id,version,status,sha256,strategy FROM app.brand_strategies WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,strategyId])).rows[0];
   if(!row)throw new NotFoundException('Brand strategy not found');
   if(row.sha256!==v.sha256||hash(canonicalJSON(row.strategy))!==row.sha256)throw new ConflictException('This strategy changed. Reload before approving');
   if(row.status==='approved')return {id:row.id,version:row.version,status:'approved'};
   if(!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can approve the strategy');
   const done=await db.query("UPDATE app.brand_strategies SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 AND status='draft'",[strategyId,user]);
   if(!done.rowCount)throw new ConflictException('This strategy could not be approved. Reload and try again');
   return {id:row.id,version:row.version,status:'approved'};
  },true);
 }
}
