import OpenAI from 'openai';
import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {SkillRuntime} from './skill-runtime.js';
import {CreativeProvider} from './creative-provider.js';
import {CreativeError,type PlannerRequest} from './creative-contracts.js';
import {validatePlanningResult,type PlanningInput,type PlanningResult} from './planning-contracts.js';
import {canonicalJSON,hash} from './brand-brain.js';
const terminal=new Set(['succeeded','failed','rejected','canceled','unknown']);
export class PlanningJobs {
 constructor(readonly jobs:AssetJobs,readonly runtime:SkillRuntime,readonly provider:CreativeProvider){}
 finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 async call(scope:JobScope,message:PlannerRequest,model:string){
  const wire=this.provider.plannerRequest(message,model,16000);
  const prepared=await this.jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='plan.generate')throw new Error('JOB_KIND_DENIED');
   if(!await this.jobs.permitted(db,j))throw new CreativeError('PLAN_ACCESS_REVOKED');
   const prior=(await db.query('SELECT * FROM app.planning_calls WHERE job_id=$1 AND step=$2',[j.id,message.step])).rows[0];
   if(prior){
    if(prior.model!==model||prior.input_sha256!==wire.sha256)return {blocked:'PLAN_REPLAY_MISMATCH'};
    if(prior.status==='succeeded')return {cached:prior.result};
    if(prior.status==='submitted')await db.query("UPDATE app.planning_calls SET status='unknown' WHERE job_id=$1 AND step=$2",[j.id,message.step]);
    return {blocked:prior.status==='rejected'?'PLAN_PROVIDER_REJECTED':'PLAN_SUBMISSION_UNKNOWN'};
   }
   const grant=(await db.query('SELECT * FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id])).rows[0];
   if(!grant)throw new CreativeError('PLAN_STAGING_APPROVAL_REQUIRED');
   if(grant.model!==model)throw new CreativeError('PLAN_CONFIG_CHANGED');
   const cost=Math.ceil(wire.maxInputTokens*Number(grant.input_micros_per_token)+wire.maxOutputTokens*Number(grant.output_micros_per_token));
   const used=Number((await db.query('SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.planning_calls WHERE organization_id=$1 AND brand_id=$2',[j.organization_id,j.brand_id])).rows[0].n);
   if(!Number.isSafeInteger(cost)||cost<=0||cost+used>Number(grant.budget_micros))throw new CreativeError('PLAN_BUDGET_EXHAUSTED');
   await db.query("INSERT INTO app.planning_calls(job_id,step,organization_id,brand_id,model,input_sha256,reserved_micros,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')",[j.id,message.step,j.organization_id,j.brand_id,model,wire.sha256,cost]);
   return {submit:true};
  });
  if('cached' in prepared)return prepared.cached;
  if('blocked' in prepared)throw new CreativeError(prepared.blocked!);
  let result;
  try{result=await this.provider.plan(message,model,16000);}catch(error){
   const known=error instanceof CreativeError||(error instanceof OpenAI.APIError&&[400,401,403,404,422,429].includes(error.status??0));
   await this.jobs.transaction(scope,async(db,j)=>{await db.query('UPDATE app.planning_calls SET status=$3 WHERE job_id=$1 AND step=$2',[j.id,message.step,known?'rejected':'unknown']);});
   throw new CreativeError(known?(error instanceof CreativeError?error.code:'PLAN_PROVIDER_REJECTED'):'PLAN_SUBMISSION_UNKNOWN');
  }
  // A lost commit after provider success stays submitted; replay never resubmits it.
  await this.jobs.transaction(scope,async(db,j)=>{await db.query("UPDATE app.planning_calls SET status='succeeded',result=$3 WHERE job_id=$1 AND step=$2",[j.id,message.step,JSON.stringify(result)]);});
  return result;
 }
 async run(scope:JobScope):Promise<string>{
  try{
   const prepared=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='plan.generate')throw new Error('JOB_KIND_DENIED');
    if(terminal.has(j.status))return null;
    if(!await this.jobs.permitted(db,j)){await this.finish(db,j,'canceled','PLAN_ACCESS_REVOKED');return null;}
    if(!this.runtime.configured)throw new CreativeError('SKILL_RUNTIME_NOT_CONFIGURED');
    if(!this.provider.configured)throw new CreativeError('PLAN_PROVIDER_NOT_CONFIGURED');
    const request=(await db.query('SELECT * FROM app.planning_requests WHERE job_id=$1',[j.id])).rows[0];
    const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE id=$1',[request.brain_id])).rows[0];
    const input=request.input as PlanningInput;
    if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256||hash(canonicalJSON(input))!==request.input_sha256||input.brand.id!==brain.id||input.brand.sha256!==brain.sha256||canonicalJSON(input.brand.facts)!==canonicalJSON(brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))))throw new CreativeError('PLAN_BRAND_INTEGRITY_FAILED');
    const grant=(await db.query('SELECT model FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id])).rows[0];
    if(!grant)throw new CreativeError('PLAN_STAGING_APPROVAL_REQUIRED');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",[j.id]);
    return {request,input,model:grant.model};
   });
   if(!prepared)return 'finished';
   const {request,input,model}=prepared;
   let result:PlanningResult=request.output;
   if(!result){
    result=await this.runtime.contentPlan(input,message=>this.call(scope,message,model));
    await this.jobs.transaction(scope,async(db,j)=>{
     if(!await this.jobs.permitted(db,j))throw new CreativeError('PLAN_ACCESS_REVOKED');
     await db.query('UPDATE app.planning_requests SET output=$2 WHERE job_id=$1',[j.id,JSON.stringify(result)]);
    });
   }
   result=validatePlanningResult(result,input);
   return await this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','PLAN_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
    const prior=(await db.query('SELECT id FROM app.content_plans WHERE job_id=$1',[j.id])).rows[0];
    if(prior)return this.finish(db,j,'succeeded');
    if((await db.query('SELECT count(*)::int AS n FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2',[j.organization_id,j.brand_id])).rows[0].n>=36)throw new CreativeError('PLAN_LIMIT_REACHED');
    const planId=randomUUID(),reserved=(await db.query('SELECT sum(reserved_micros)::text AS n FROM app.planning_calls WHERE job_id=$1',[j.id])).rows[0].n;
    const manifest={skills:result.skills,reads:result.reads,runtime:result.version,model,model_calls:result.model_calls,reserved_cost_micros:Number(reserved),source_preferences:input.preferences,input_sha256:request.input_sha256,helpers_executed:false};
    await db.query(`INSERT INTO app.content_plans(id,organization_id,brand_id,title,objective,starts_on,timezone,origin,created_by,request_key,request_hash,job_id,brain_id,strategy,skill_manifest,duration_days)
      VALUES($1,$2,$3,$4,$5,$6,$7,'generated',$8,$9,$10,$11,$12,$13,$14,$15)`,[planId,j.organization_id,j.brand_id,result.plan.title,input.preferences.goal,input.preferences.starts_on,input.preferences.timezone,j.requested_by,`generation:${j.id}`,request.request_hash,j.id,request.brain_id,JSON.stringify(result.plan),JSON.stringify(manifest),input.duration_days??30]);
    for(const [index,s] of result.plan.slots.entries()){
     const sid=randomUUID();
     await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,created_by,strategy_slot_index)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[sid,j.organization_id,j.brand_id,planId,s.channel,s.planned_at,s.format,s.brief,s.pillar,s.hook,s.cta,j.requested_by,index]);
     const snapshot={...s,plan_id:planId,origin:'generated',strategy_slot_index:index,state:'content_needed',creative_version_id:null,creative_sha256:null};
     await db.query(`INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,feedback,snapshot)
       VALUES($1,$2,$3,$4,1,'created',$5,'',$6)`,[randomUUID(),j.organization_id,j.brand_id,sid,j.requested_by,JSON.stringify(snapshot)]);
    }
    await db.query('UPDATE app.planning_requests SET output_plan_id=$2 WHERE job_id=$1',[j.id,planId]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){
   if(!(error instanceof CreativeError))throw error;
   return this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    const status=['PLAN_SUBMISSION_UNKNOWN','PLAN_REPLAY_MISMATCH'].includes(error.code)?'unknown':error.code==='PLAN_ACCESS_REVOKED'?'canceled':'rejected';
    return this.finish(db,j,status,error.code);
   });
  }
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,async(db,j)=>{
  if(j.kind!=='plan.generate')throw new Error('JOB_KIND_DENIED');
  if(terminal.has(j.status))return j.status;
  const uncertain=(await db.query("SELECT job_id FROM app.planning_calls WHERE job_id=$1 AND status IN ('submitted','unknown') LIMIT 1",[j.id])).rowCount;
  return this.finish(db,j,uncertain?'unknown':'failed',uncertain?'PLAN_SUBMISSION_UNKNOWN':'PLAN_RETRIES_EXHAUSTED');
 });}
}
