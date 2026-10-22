import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {HiggsfieldClient,HiggsfieldError,type VideoIntent} from './higgsfield-client.js';
import {VideoVault,VideoStateError} from './video-vault.js';
const terminal=new Set(['completed','failed','nsfw','canceled','rejected','unknown']);

/** Durable paid-provider stage, not the complete Canvas workflow. The owning
 * pipeline must validate approved brand/skill/reference lineage before prepare,
 * then decode and privately save completed output before marking a job succeeded.
 * There is deliberately no customer route or default worker registration yet. */
export class VideoProviderJobs {
 #jobs:AssetJobs;#provider:HiggsfieldClient;#vault:VideoVault;
 constructor(jobs:AssetJobs,provider:HiggsfieldClient,encryptionKey:string){this.#jobs=jobs;this.#provider=provider;this.#vault=new VideoVault(encryptionKey);}
 private transaction<T>(scope:JobScope,action:(db:any,j:any)=>Promise<T>){return this.#jobs.transaction(scope,(db,j)=>{
  if(j.kind!=='creative.video')throw new VideoStateError('VIDEO_JOB_KIND_DENIED');return action(db,j);
 });}
 private async grant(db:any,j:any,model:string){
  const g=(await db.query('SELECT * FROM app.video_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id])).rows[0];
  if(!g||!g.models.includes(model))throw new VideoStateError('VIDEO_STAGING_APPROVAL_REQUIRED');return g;
 }
 private async stop(db:any,j:any,phase:string,code:string,release=false){
  await db.query('UPDATE app.video_operations SET phase=$2,error_code=$3 WHERE job_id=$1',[j.id,phase,code]);
  if(release)await db.query("UPDATE app.video_reservations SET state='released' WHERE job_id=$1",[j.id]);
  await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,phase==='canceled'?'canceled':phase==='unknown'?'unknown':phase==='failed'?'failed':'rejected',code]);return phase;
 }
 async prepare(scope:JobScope,intent:VideoIntent,beforePrepare?:(db:any,j:any)=>Promise<void>){
  const prepared=this.#provider.prepare(intent);
  return this.transaction(scope,async(db,j)=>{
   const prior=(await db.query('SELECT * FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
   if(prior){if(prior.intent_sha256!==prepared.sha256||prior.provider_key!==prepared.idempotencyKey)throw new VideoStateError('VIDEO_REPLAY_MISMATCH');return {phase:prior.phase};}
   if(!['queued','running','retrying'].includes(j.status)||!await this.#jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
   if(beforePrepare)await beforePrepare(db,j);
   const g=await this.grant(db,j,prepared.model),reserve=Number(intent.kind==='image'?g.max_create_micros:g.max_edit_micros);
   const used=Number((await db.query("SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.video_reservations WHERE organization_id=$1 AND brand_id=$2 AND state='held'",[j.organization_id,j.brand_id])).rows[0].n);
   if(!Number.isSafeInteger(reserve)||reserve<=0||used+reserve>Number(g.budget_micros))throw new VideoStateError('VIDEO_BUDGET_EXHAUSTED');
   await db.query('INSERT INTO app.video_reservations(job_id,organization_id,brand_id,model,reserved_micros) VALUES($1,$2,$3,$4,$5)',[j.id,j.organization_id,j.brand_id,prepared.model,reserve]);
   await db.query('INSERT INTO app.video_operations(job_id,organization_id,brand_id,provider_key,model,intent_sha256,encrypted_intent) VALUES($1,$2,$3,$4,$5,$6,$7)',[j.id,j.organization_id,j.brand_id,prepared.idempotencyKey,prepared.model,prepared.sha256,this.#vault.seal(scope,'intent',intent)]);
   return {phase:'prepared'};
  });
 }
 async step(scope:JobScope,beforeSubmit?:(db:any,j:any)=>Promise<void>):Promise<string>{
  const state=await this.transaction(scope,async(db,j)=>{
   const r=(await db.query('SELECT * FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
   if(!r)throw new VideoStateError('VIDEO_INTENT_MISSING');
   if(terminal.has(r.phase))return {done:r.phase};
   if(r.phase==='submitting')return {done:await this.stop(db,j,'unknown','VIDEO_SUBMISSION_UNKNOWN')};
   if(r.phase==='prepared'&&(!['queued','running','retrying'].includes(j.status)||new Date(r.deadline_at).getTime()<=Date.now()))
    return {done:await this.stop(db,j,'rejected','VIDEO_UNUSED_INTENT_EXPIRED_OR_STOPPED',true)};
   if(new Date(r.deadline_at).getTime()<=Date.now())return {done:await this.stop(db,j,'unknown','VIDEO_PROVIDER_DEADLINE')};
   const permitted=await this.#jobs.permitted(db,j);
   if(r.phase==='prepared'){
    if(!permitted)return {done:await this.stop(db,j,'canceled','VIDEO_ACCESS_REVOKED_OR_CANCELED',true)};
    let g;try{g=await this.grant(db,j,r.model);}catch{return {done:await this.stop(db,j,'rejected','VIDEO_STAGING_APPROVAL_REQUIRED',true)};}
    const held=(await db.query('SELECT reserved_micros,state FROM app.video_reservations WHERE job_id=$1',[j.id])).rows[0];
    const intent=this.#vault.open(scope,'intent',r.encrypted_intent) as VideoIntent,prepared=this.#provider.prepare(intent);
    if(prepared.sha256!==r.intent_sha256||prepared.idempotencyKey!==r.provider_key||prepared.model!==r.model||held.state!=='held')throw new VideoStateError('VIDEO_REPLAY_MISMATCH');
    const currentCap=Number(intent.kind==='image'?g.max_create_micros:g.max_edit_micros);
    const used=Number((await db.query("SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.video_reservations WHERE state='held'",[])).rows[0].n);
    if(Number(held.reserved_micros)!==currentCap||used>Number(g.budget_micros))return {done:await this.stop(db,j,'rejected','VIDEO_BUDGET_CHANGED',true)};
    if(beforeSubmit)await beforeSubmit(db,j);
    await db.query("UPDATE app.video_operations SET phase='submitting' WHERE job_id=$1",[j.id]);
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);
    return {submit:intent,sha:r.intent_sha256};
   }
   if(r.cancel_phase==='submitting')await db.query("UPDATE app.video_operations SET cancel_phase='unknown' WHERE job_id=$1",[j.id]);
   return {poll:r.remote_request_id,cancel:!permitted&&r.cancel_phase==='none'};
  });
  if('done' in state)return state.done!;
  if('submit' in state){
   let receipt;
   try{receipt=await this.#provider.submit(state.submit!,state.sha!);}catch(e){
    return this.transaction(scope,async(db,j)=>{
     const known=e instanceof HiggsfieldError&&e.outcome==='rejected';
     return this.stop(db,j,known?'rejected':'unknown',e instanceof HiggsfieldError?e.code:'VIDEO_SUBMISSION_UNKNOWN',known);
    });
   }
   // If committing this receipt fails, leave the submitting marker. A later
   // activity holds it unknown; it must not repeat the paid POST automatically.
   return this.transaction(scope,async(db,j)=>{
    await db.query("UPDATE app.video_operations SET phase='accepted',remote_request_id=$2,error_code=NULL WHERE job_id=$1",[j.id,receipt.requestId]);
    await db.query("UPDATE app.jobs SET status='running',error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return 'accepted';
   });
  }
  if(state.cancel){
   const send=await this.transaction(scope,async(db,j)=>{
    const r=(await db.query('SELECT phase,cancel_phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
    if(r.phase!=='accepted'||r.cancel_phase!=='none')return false;
    await db.query("UPDATE app.video_operations SET cancel_phase='submitting' WHERE job_id=$1",[j.id]);return true;
   });
   if(send){
    let phase='accepted';try{await this.#provider.cancel(state.poll!);}catch(e){phase=e instanceof HiggsfieldError&&e.outcome==='rejected'?'rejected':'unknown';}
    await this.transaction(scope,async(db,j)=>{await db.query('UPDATE app.video_operations SET cancel_phase=$2 WHERE job_id=$1',[j.id,phase]);});
   }
  }
  let observed;
  try{observed=await this.#provider.status(state.poll!);}catch(e){
   await this.transaction(scope,async(db,j)=>{await db.query('UPDATE app.video_operations SET error_code=$2,last_checked_at=now() WHERE job_id=$1',[j.id,e instanceof HiggsfieldError?e.code:'VIDEO_STATUS_UNAVAILABLE']);});
   throw new VideoStateError('VIDEO_STATUS_UNAVAILABLE');
  }
  return this.transaction(scope,async(db,j)=>{
   const current=(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
   if(terminal.has(current.phase))return current.phase;
   await db.query('INSERT INTO app.video_observations(id,organization_id,brand_id,job_id,state) VALUES($1,$2,$3,$4,$5)',[randomUUID(),j.organization_id,j.brand_id,j.id,observed.state]);
   const phase=['completed','failed','nsfw','canceled'].includes(observed.state)?observed.state:'accepted';
   await db.query('UPDATE app.video_operations SET phase=$2,remote_state=$3,encrypted_output=$4,error_code=$5,last_checked_at=now() WHERE job_id=$1',[j.id,phase,observed.state,phase==='completed'?this.#vault.seal(scope,'output',{url:observed.videoURL}):null,observed.errorCode]);
   if(['failed','nsfw','canceled'].includes(phase))await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,phase==='failed'?'failed':phase==='canceled'?'canceled':'rejected',observed.errorCode]);
   // Completed provider work is not a succeeded Desvio job; validation/save and
   // a fresh permission check are still required. Reservation remains held.
   return phase;
  });
 }
 async output(scope:JobScope){return this.transaction(scope,async(db,j)=>{
  if(!await this.#jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
  const r=(await db.query('SELECT phase,encrypted_output FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
  if(r?.phase!=='completed')throw new VideoStateError('VIDEO_OUTPUT_NOT_READY');
  return this.#vault.open(scope,'output',r.encrypted_output) as {url:string};
 });}
 async cancelPrepared(scope:JobScope,code:string){return this.transaction(scope,async(db,j)=>{
  const r=(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
  if(r?.phase==='prepared')return this.stop(db,j,'canceled',code,true);
  return r?.phase??null;
 });}
 async exhausted(scope:JobScope){return this.transaction(scope,async(db,j)=>{
  const r=(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
  if(!r)throw new VideoStateError('VIDEO_INTENT_MISSING');
  if(terminal.has(r.phase))return r.phase;
  return this.stop(db,j,'unknown','VIDEO_RECONCILIATION_REQUIRED');
 });}
}
