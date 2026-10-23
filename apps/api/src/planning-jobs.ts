import {approvedLearning,assertLearningCurrent} from './learning-context.js';
import {ApiError as GeminiAPIError} from '@google/genai';
import {GeminiPlanner} from './gemini-planner.js';
import OpenAI from 'openai';
import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {SkillRuntime} from './skill-runtime.js';
import {CreativeProvider} from './creative-provider.js';
import {CreativeError,type PlannerRequest} from './creative-contracts.js';
import {validatePlanningResult,resolvedPlanningInput,type PlanningInput,type PlanningResult} from './planning-contracts.js';
import {canonicalJSON,hash} from './brand-brain.js';
const terminal=new Set(['succeeded','failed','rejected','canceled','unknown']);
export class PlanningJobs {
 constructor(readonly jobs:AssetJobs,readonly runtime:SkillRuntime,readonly provider:CreativeProvider,readonly gemini:GeminiPlanner=new GeminiPlanner()){}
 finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 async call(scope:JobScope,message:PlannerRequest,model:string,providerName='openai'){
  const provider=providerName==='gemini'?this.gemini:this.provider;
  const wire=provider.plannerRequest(message,model,16000);
  const prepared=await this.jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='plan.generate')throw new Error('JOB_KIND_DENIED');
   if(!await this.jobs.permitted(db,j))throw new CreativeError('PLAN_ACCESS_REVOKED');
   const bound=(await db.query('SELECT provider,selected_model,loop_id,scheduled_at,input,execution_input FROM app.planning_requests WHERE job_id=$1',[j.id])).rows[0];
   if(!bound||bound.provider!==providerName||bound.selected_model!==model)throw new CreativeError('PLAN_CONFIG_CHANGED');
   await assertLearningCurrent(db,(bound.execution_input??bound.input).brand.learning);
   if(new Date(bound.scheduled_at).getTime()>Date.now())throw new CreativeError('PLAN_NOT_DUE');
   const loop=bound.loop_id?(await db.query('SELECT * FROM app.planning_loops WHERE id=$1',[bound.loop_id])).rows[0]:null;
   if(bound.loop_id&&(!loop||loop.stopped_at))throw new CreativeError('PLAN_ACCESS_REVOKED');
   const prior=(await db.query('SELECT * FROM app.planning_calls WHERE job_id=$1 AND step=$2',[j.id,message.step])).rows[0];
   if(prior){
    if(prior.provider!==providerName||prior.model!==model||prior.input_sha256!==wire.sha256)return {blocked:'PLAN_REPLAY_MISMATCH'};
    if(prior.status==='succeeded')return {cached:prior.result};
    if(prior.status==='submitted')await db.query("UPDATE app.planning_calls SET status='unknown' WHERE job_id=$1 AND step=$2",[j.id,message.step]);
    return {blocked:prior.status==='rejected'?'PLAN_PROVIDER_REJECTED':'PLAN_SUBMISSION_UNKNOWN'};
   }
   if(loop&&(await db.query("SELECT job_id FROM app.planning_calls WHERE loop_id=$1 AND job_id<>$2 AND status IN ('submitted','unknown') LIMIT 1",[loop.id,j.id])).rowCount)throw new CreativeError('PLAN_LOOP_NEEDS_ATTENTION');
   const grant=(await db.query('SELECT * FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider=$3 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id,providerName])).rows[0];
   if(!grant)throw new CreativeError('PLAN_STAGING_APPROVAL_REQUIRED');
   if(grant.model!==model)throw new CreativeError('PLAN_CONFIG_CHANGED');
   const cost=Math.ceil(wire.maxInputTokens*Number(grant.input_micros_per_token)+wire.maxOutputTokens*Number(grant.output_micros_per_token));
   const used=Number((await db.query('SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.planning_calls WHERE organization_id=$1 AND brand_id=$2 AND provider=$3',[j.organization_id,j.brand_id,providerName])).rows[0].n);
   if(!Number.isSafeInteger(cost)||cost<=0||cost+used>Number(grant.budget_micros))throw new CreativeError('PLAN_BUDGET_EXHAUSTED');
   if(loop){const loopUsed=Number((await db.query('SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.planning_calls WHERE loop_id=$1',[loop.id])).rows[0].n);if(cost+loopUsed>Number(loop.budget_micros))throw new CreativeError('PLAN_LOOP_BUDGET_EXHAUSTED');}
   await db.query("INSERT INTO app.planning_calls(job_id,step,organization_id,brand_id,model,input_sha256,reserved_micros,status,provider,loop_id) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$9)",[j.id,message.step,j.organization_id,j.brand_id,model,wire.sha256,cost,providerName,bound.loop_id]);
   return {submit:true};
  });
  if('cached' in prepared)return prepared.cached;
  if('blocked' in prepared)throw new CreativeError(prepared.blocked!);
  let result;
  try{result=await provider.plan(message,model,16000);}catch(error){
   const known=error instanceof CreativeError||((error instanceof OpenAI.APIError||error instanceof GeminiAPIError)&&[400,401,403,404,422,429].includes(error.status??0));
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
    const request=(await db.query('SELECT * FROM app.planning_requests WHERE job_id=$1',[j.id])).rows[0];
    if(new Date(request.scheduled_at).getTime()>Date.now())return null;
    if(request.loop_id){
     const loop=(await db.query('SELECT stopped_at FROM app.planning_loops WHERE id=$1',[request.loop_id])).rows[0];
     if(!loop||loop.stopped_at){await this.finish(db,j,'canceled','PLAN_ACCESS_REVOKED');return null;}
     if(!request.execution_input){
      if(hash(canonicalJSON(request.input))!==request.input_sha256)throw new CreativeError('PLAN_BRAND_INTEGRITY_FAILED');
      const latest=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY approved_at DESC,id LIMIT 1',[j.organization_id,j.brand_id])).rows[0];
      const prefs=(await db.query('SELECT goal,timezone,cadence,channels,must_avoid,revision,step FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2',[j.organization_id,j.brand_id])).rows[0];
      if(!latest||hash(canonicalJSON(latest.snapshot))!==latest.sha256||!prefs||prefs.step!==3||!prefs.channels.length)throw new CreativeError('PLAN_BRAND_INTEGRITY_FAILED');
      const input={...request.input,brand:{id:latest.id,sha256:latest.sha256,learning:await approvedLearning(db),facts:latest.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},preferences:{...request.input.preferences,goal:prefs.goal,cadence:prefs.cadence,channels:prefs.channels,must_avoid:prefs.must_avoid,revision:prefs.revision}};
      if(Buffer.byteLength(JSON.stringify(input))>390000)throw new CreativeError('SKILL_INPUT_LIMIT');
      request.execution_input=input;request.execution_sha256=hash(canonicalJSON(input));request.execution_brain_id=latest.id;
      await db.query('UPDATE app.planning_requests SET execution_input=$2,execution_sha256=$3,execution_brain_id=$4 WHERE job_id=$1',[j.id,JSON.stringify(input),request.execution_sha256,latest.id]);
     }
     request.input=request.execution_input;request.input_sha256=request.execution_sha256;request.brain_id=request.execution_brain_id;
    }
    const client=request.provider==='gemini'?this.gemini:this.provider;
    if(!client.configured)throw new CreativeError('PLAN_PROVIDER_NOT_CONFIGURED');
    const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE id=$1',[request.brain_id])).rows[0];
    const input=request.input as PlanningInput;
    if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256||hash(canonicalJSON(input))!==request.input_sha256||input.brand.id!==brain.id||input.brand.sha256!==brain.sha256||canonicalJSON(input.brand.facts)!==canonicalJSON(brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))))throw new CreativeError('PLAN_BRAND_INTEGRITY_FAILED');
    const grant=(await db.query('SELECT model FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider=$3 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id,request.provider])).rows[0];
    if(!grant||!request.selected_model)throw new CreativeError('PLAN_STAGING_APPROVAL_REQUIRED');
    if(grant.model!==request.selected_model)throw new CreativeError('PLAN_CONFIG_CHANGED');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",[j.id]);
    return {request,input,model:request.selected_model};
   });
   if(!prepared)return 'finished';
   const {request,input,model}=prepared;
   let result:PlanningResult=request.output;
   if(!result){
    result=await this.runtime.contentPlan(input,message=>this.call(scope,message,model,request.provider));
    await this.jobs.transaction(scope,async(db,j)=>{
     if(!await this.jobs.permitted(db,j))throw new CreativeError('PLAN_ACCESS_REVOKED');
     await db.query('UPDATE app.planning_requests SET output=$2 WHERE job_id=$1',[j.id,JSON.stringify(result)]);
    });
   }
   result=validatePlanningResult(result,input);
   const resolved=resolvedPlanningInput(input,result.plan);
   return await this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','PLAN_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
    const prior=(await db.query('SELECT id FROM app.content_plans WHERE job_id=$1',[j.id])).rows[0];
    if(prior)return this.finish(db,j,'succeeded');
    if((await db.query('SELECT count(*)::int AS n FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2',[j.organization_id,j.brand_id])).rows[0].n>=36)throw new CreativeError('PLAN_LIMIT_REACHED');
    const planId=randomUUID(),reserved=(await db.query('SELECT sum(reserved_micros)::text AS n FROM app.planning_calls WHERE job_id=$1',[j.id])).rows[0].n;
    const manifest={skills:result.skills,reads:result.reads,runtime:result.version,provider:request.provider,model,model_calls:result.model_calls,reserved_cost_micros:Number(reserved),source_preferences:input.preferences,learning:input.brand.learning??[],resolved_counts:{duration_days:resolved.duration_days??30,post_count:resolved.post_count,video_count:resolved.video_count??0},source_plan:input.reference_plan?{id:input.reference_plan.id,sha256:input.reference_plan.sha256}:null,input_sha256:request.input_sha256,helpers_executed:false};
    await db.query(`INSERT INTO app.content_plans(id,organization_id,brand_id,title,objective,starts_on,timezone,origin,created_by,request_key,request_hash,job_id,brain_id,strategy,skill_manifest,duration_days)
      VALUES($1,$2,$3,$4,$5,$6,$7,'generated',$8,$9,$10,$11,$12,$13,$14,$15)`,[planId,j.organization_id,j.brand_id,result.plan.title,input.preferences.goal,input.preferences.starts_on,input.preferences.timezone,j.requested_by,`generation:${j.id}`,request.request_hash,j.id,request.brain_id,JSON.stringify(result.plan),JSON.stringify(manifest),resolved.duration_days??30]);
    for(const [index,s] of result.plan.slots.entries()){
     const sid=randomUUID();
     await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,created_by,strategy_slot_index,video_draft)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[sid,j.organization_id,j.brand_id,planId,s.channel,s.planned_at,s.format,s.brief,s.pillar,s.hook,s.cta,j.requested_by,index,s.video_draft?JSON.stringify(s.video_draft):null]);
     const snapshot={...s,plan_id:planId,origin:'generated',strategy_slot_index:index,state:'content_needed',creative_version_id:null,creative_sha256:null};
     await db.query(`INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,feedback,snapshot)
       VALUES($1,$2,$3,$4,1,'created',$5,'',$6)`,[randomUUID(),j.organization_id,j.brand_id,sid,j.requested_by,JSON.stringify(snapshot)]);
    }
    if(request.thread_id)await db.query("INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'assistant',$6)",[randomUUID(),j.organization_id,j.brand_id,request.thread_id,j.id,`${result.plan.title}\n${result.plan.strategy}\nPrepared ${result.plan.slots.length} draft posts starting ${input.preferences.starts_on}. Open the day-by-day plan to create and review its posts.`]);
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
