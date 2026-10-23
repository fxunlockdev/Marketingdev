import {ApiError as GeminiAPIError} from '@google/genai';
import {GeminiPlanner} from './gemini-planner.js';
import OpenAI from 'openai';
import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {SkillRuntime} from './skill-runtime.js';
import {CreativeProvider} from './creative-provider.js';
import {CreativeError,type PlannerRequest} from './creative-contracts.js';
import {validateInsightResult} from './insight-contracts.js';
import {canonicalJSON,hash} from './brand-brain.js';
const terminal=new Set(['succeeded','failed','rejected','canceled','unknown']);
export class InsightJobs {
 constructor(readonly jobs:AssetJobs,readonly runtime:SkillRuntime,readonly provider:CreativeProvider,readonly gemini:GeminiPlanner=new GeminiPlanner()){}
 finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 async call(scope:JobScope,message:PlannerRequest,model:string,providerName='openai'){
  const provider=providerName==='gemini'?this.gemini:this.provider;
  const wire=provider.plannerRequest(message,model,4000);
  const prepared=await this.jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='insight.generate')throw new Error('JOB_KIND_DENIED');
   if(!await this.jobs.permitted(db,j))throw new CreativeError('INSIGHT_ACCESS_REVOKED');
   const bound=(await db.query('SELECT provider,selected_model FROM app.insight_requests WHERE job_id=$1',[j.id])).rows[0];
   if(!bound||bound.provider!==providerName||bound.selected_model!==model)throw new CreativeError('INSIGHT_CONFIG_CHANGED');
   const prior=(await db.query('SELECT * FROM app.insight_calls WHERE job_id=$1 AND step=$2',[j.id,message.step])).rows[0];
   if(prior){
    if(prior.provider!==providerName||prior.model!==model||prior.input_sha256!==wire.sha256)return {blocked:'INSIGHT_REPLAY_MISMATCH'};
    if(prior.status==='succeeded')return {cached:prior.result};
    if(prior.status==='submitted')await db.query("UPDATE app.insight_calls SET status='unknown' WHERE job_id=$1 AND step=$2",[j.id,message.step]);
    return {blocked:prior.status==='rejected'?'INSIGHT_PROVIDER_REJECTED':'INSIGHT_SUBMISSION_UNKNOWN'};
   }
   const grant=(await db.query('SELECT * FROM app.insight_grants WHERE organization_id=$1 AND brand_id=$2 AND provider=$3 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id,providerName])).rows[0];
   if(!grant)throw new CreativeError('INSIGHT_STAGING_APPROVAL_REQUIRED');
   if(grant.model!==model)throw new CreativeError('INSIGHT_CONFIG_CHANGED');
   const cost=Math.ceil(wire.maxInputTokens*Number(grant.input_micros_per_token)+wire.maxOutputTokens*Number(grant.output_micros_per_token));
   const used=Number((await db.query('SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.insight_calls WHERE organization_id=$1 AND brand_id=$2 AND provider=$3',[j.organization_id,j.brand_id,providerName])).rows[0].n);
   if(!Number.isSafeInteger(cost)||cost<=0||cost+used>Number(grant.budget_micros))throw new CreativeError('INSIGHT_BUDGET_EXHAUSTED');
   await db.query("INSERT INTO app.insight_calls(job_id,step,organization_id,brand_id,model,input_sha256,reserved_micros,status,provider) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8)",[j.id,message.step,j.organization_id,j.brand_id,model,wire.sha256,cost,providerName]);
   return {submit:true};
  });
  if('cached' in prepared)return prepared.cached;
  if('blocked' in prepared)throw new CreativeError(prepared.blocked!);
  let result;
  try{result=await provider.plan(message,model,4000);}catch(error){
   const known=error instanceof CreativeError||((error instanceof OpenAI.APIError||error instanceof GeminiAPIError)&&[400,401,403,404,422,429].includes(error.status??0));
   await this.jobs.transaction(scope,async(db,j)=>{await db.query('UPDATE app.insight_calls SET status=$3 WHERE job_id=$1 AND step=$2',[j.id,message.step,known?'rejected':'unknown']);});
   throw new CreativeError(known?(error instanceof CreativeError?error.code:'INSIGHT_PROVIDER_REJECTED'):'INSIGHT_SUBMISSION_UNKNOWN');
  }
  // A lost commit after provider success stays submitted; replay never resubmits it.
  await this.jobs.transaction(scope,async(db,j)=>{await db.query("UPDATE app.insight_calls SET status='succeeded',result=$3 WHERE job_id=$1 AND step=$2",[j.id,message.step,JSON.stringify(result)]);});
  return result;
 }
 async run(scope:JobScope):Promise<string>{
  try{
   const request=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='insight.generate')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return null;
    if(!await this.jobs.permitted(db,j)){await this.finish(db,j,'canceled','INSIGHT_ACCESS_REVOKED');return null;}
    const r=(await db.query('SELECT * FROM app.insight_requests WHERE job_id=$1',[j.id])).rows[0];if(!r||hash(canonicalJSON(r.input))!==r.input_sha256)throw new CreativeError('INSIGHT_INPUT_CHANGED');
    if(!this.runtime.configured||!(r.provider==='gemini'?this.gemini:this.provider).configured)throw new CreativeError('INSIGHT_PROVIDER_NOT_CONFIGURED');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",[j.id]);return r;
   });
   if(!request)return 'finished';
   const result=validateInsightResult(request.output??await this.runtime.insights(request.input,message=>this.call(scope,message,request.selected_model,request.provider)),request.input);
   return await this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','INSIGHT_ACCESS_REVOKED');
    await db.query('UPDATE app.insight_requests SET output=$2 WHERE job_id=$1',[j.id,JSON.stringify(result)]);
    for(const [position,content] of result.analysis.insights.entries())await db.query('INSERT INTO app.memory_lessons(id,organization_id,brand_id,job_id,position,content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id,position) DO NOTHING',[randomUUID(),j.organization_id,j.brand_id,j.id,position,JSON.stringify(content)]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){if(!(error instanceof CreativeError))throw error;return this.jobs.transaction(scope,(db,j)=>terminal.has(j.status)?j.status:this.finish(db,j,['INSIGHT_SUBMISSION_UNKNOWN','INSIGHT_REPLAY_MISMATCH'].includes(error.code)?'unknown':error.code==='INSIGHT_ACCESS_REVOKED'?'canceled':'rejected',error.code));}
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,async(db,j)=>{if(j.kind!=='insight.generate')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return j.status;const uncertain=(await db.query("SELECT 1 FROM app.insight_calls WHERE job_id=$1 AND status IN ('submitted','unknown')",[j.id])).rowCount;return this.finish(db,j,uncertain?'unknown':'failed',uncertain?'INSIGHT_SUBMISSION_UNKNOWN':'INSIGHT_RETRIES_EXHAUSTED');});}
}
