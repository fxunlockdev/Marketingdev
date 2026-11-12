import {AssetJobs,type JobScope} from './jobs.js';
import {VideoReferences} from './video-references.js';
import {VideoProviderJobs} from './video-provider-jobs.js';
import {VideoDownload} from './video-download.js';
import {VideoRenderer} from './video-renderer.js';
import {VideoStateError} from './video-vault.js';
import {RUNWAY_VIDEO_MODEL,type RunwayIntent} from './runway-client.js';
import {digest,MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';
import type {ReelShot} from './reel-plan.js';

type Db={query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>};
export type ShotRow={job_id:string;shot_index:number;duration_seconds:number;object_key:string|null;sha256:string|null;bytes:number|null};
export type ShotCheck=(db:Db,shotJob:{id:string;organization_id:string;brand_id:string})=>Promise<void>;
/** Outcome of one advance: every shot saved, still generating, or stopped with the shot's terminal state. */
export type ReelProgress={state:'completed'}|{state:'accepted'}|{state:'stopped';status:'unknown'|'failed'|'rejected'|'canceled';code:string};
const BAD=new Set(['unknown','failed','nsfw','canceled','rejected']);

/** Advances a reel's shots one at a time through the durable provider ledger. A shot is submitted only
 * after the previous one is saved, so a refused or failed shot stops the reel before any further spend,
 * and an uncertain paid call is held for reconciliation, never resubmitted. Every shot starts from the
 * same owner-approved frame: only approved pixels are ever sent to the provider. */
export class ReelShots {
 constructor(readonly jobs:AssetJobs,readonly references:VideoReferences,readonly provider:VideoProviderJobs,readonly download:VideoDownload,readonly renderer:VideoRenderer){}
 child(scope:JobScope,row:ShotRow):JobScope{return {organizationId:scope.organizationId,brandId:scope.brandId,jobId:row.job_id};}
 async rows(scope:JobScope):Promise<ShotRow[]>{
  return this.jobs.transaction(scope,async db=>(await db.query('SELECT job_id,shot_index,duration_seconds,object_key,sha256,bytes FROM app.reel_shots WHERE parent_job_id=$1 ORDER BY shot_index',[scope.jobId])).rows as ShotRow[]);
 }
 private async phase(scope:JobScope):Promise<string|undefined>{
  return this.jobs.transaction(scope,async db=>(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[scope.jobId])).rows[0]?.phase as string|undefined);
 }
 private stopped(phase:string,code:string):ReelProgress{
  return {state:'stopped',status:phase==='unknown'?'unknown':phase==='failed'?'failed':phase==='canceled'?'canceled':'rejected',code};
 }
 /** One workflow step. `intents` holds the approved per-shot prompts; `check` re-validates the reel's
  * approval, reference, slot and authority inside the shot's own transaction before any paid call. */
 async advance(scope:JobScope,shots:ReelShot[],aspectRatio:RunwayIntent['aspectRatio'],check:ShotCheck):Promise<ReelProgress>{
  const rows=await this.rows(scope);
  if(rows.length!==shots.length||rows.some((r,i)=>r.shot_index!==i||r.duration_seconds!==shots[i]!.duration_seconds))throw new VideoStateError('VIDEO_REEL_SHOTS_MISMATCH');
  for(const row of rows){
   if(row.sha256)continue;
   const child=this.child(scope,row),shot=shots[row.shot_index]!;
   let phase=await this.phase(child);
   if(!phase){
    const lease=await this.references.prepare(child);
    await this.references.verify(child);
    await this.provider.prepare(child,{kind:'image',model:RUNWAY_VIDEO_MODEL,idempotencyKey:row.job_id,referenceURL:lease.url,prompt:shot.prompt,durationSeconds:shot.duration_seconds,sound:'off',aspectRatio},check);
    phase='prepared';
   }
   if(phase==='prepared'||phase==='accepted')phase=await this.provider.step(child,check);
   if(phase==='completed'){await this.save(scope,row);continue;}
   if(BAD.has(phase)){await this.references.revoke(child);return this.stopped(phase,await this.code(child,phase));}
   return {state:'accepted'};
  }
  return {state:'completed'};
 }
 private async code(child:JobScope,phase:string):Promise<string>{
  return this.jobs.transaction(child,async(db,j)=>String(j.error_code??`VIDEO_SHOT_${phase.toUpperCase()}`));
 }
 /** Download the finished clip, normalise it in the sandbox and save it once under the reel. */
 private async save(scope:JobScope,row:ShotRow):Promise<void>{
  const child=this.child(scope,row);
  const remote=await this.provider.output(child),untrusted=await this.download.readProviderOutput(remote);
  const clean=await this.renderer.render(untrusted.bytes,row.duration_seconds,[]);
  const key=`video/${scope.organizationId}/${scope.brandId}/${scope.jobId}/shot/${row.shot_index}/${clean.manifest.video_sha256}`;
  await this.jobs.store.persist(key,clean.video,'video/mp4',clean.manifest.video_sha256);
  const operation=await this.jobs.transaction(child,async(db,j)=>{
   const r=(await db.query('SELECT routing,provider FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
   await db.query("UPDATE app.jobs SET status='succeeded',error_code=NULL,updated_at=now() WHERE id=$1 AND status IN ('queued','running','retrying')",[j.id]);
   return r;
  });
  await this.jobs.transaction(scope,async db=>{
   await db.query('UPDATE app.reel_shots SET object_key=$2,sha256=$3,bytes=$4,manifest=$5 WHERE job_id=$1 AND object_key IS NULL',[row.job_id,key,clean.manifest.video_sha256,clean.video.length,JSON.stringify({...clean.manifest,video_provider:operation?.provider??null,video_routing:operation?.routing??null})]);
  });
  await this.references.revoke(child);
 }
 /** The saved, hash-checked clips in shot order. */
 async clips(scope:JobScope):Promise<{bytes:Buffer;duration_seconds:number;sha256:string;manifest:unknown}[]>{
  const rows=await this.jobs.transaction(scope,async db=>(await db.query('SELECT shot_index,duration_seconds,object_key,sha256,bytes,manifest FROM app.reel_shots WHERE parent_job_id=$1 ORDER BY shot_index',[scope.jobId])).rows);
  return Promise.all(rows.map(async(r:any)=>{
   if(!r.object_key)throw new VideoStateError('VIDEO_REEL_SHOT_MISSING');
   const bytes=await this.jobs.store.read(r.object_key,MAX_CANONICAL_VIDEO_BYTES);
   if(bytes.length!==r.bytes||digest(bytes)!==r.sha256)throw new VideoStateError('VIDEO_BASE_INTEGRITY_FAILED');
   return {bytes,duration_seconds:r.duration_seconds as number,sha256:r.sha256 as string,manifest:r.manifest};
  }));
 }
 /** Stop every shot: cancel prepared or accepted work (never resubmitting), close shots that never
  * started and revoke their reference copies. An uncertain shot keeps its hold for reconciliation. */
 async close(scope:JobScope,forceCancel:boolean):Promise<void>{
  for(const row of await this.rows(scope)){
   const child=this.child(scope,row),phase=await this.phase(child);
   if(phase==='prepared'||phase==='accepted'&&forceCancel){try{await this.provider.step(child,undefined,true);}catch{/* A status outage keeps the remote ID; recovery reconciles it. */}}
   if(!phase)await this.jobs.transaction(child,async(db,j)=>{await db.query("UPDATE app.jobs SET status='canceled',error_code='VIDEO_REEL_STOPPED',updated_at=now() WHERE id=$1 AND status='queued'",[j.id]);});
   await this.references.revoke(child);
  }
 }
}
