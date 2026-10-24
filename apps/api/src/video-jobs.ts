import {assertLearningCurrent} from './learning-context.js';
import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {VideoReferences} from './video-references.js';
import {VideoProviderJobs} from './video-provider-jobs.js';
import {VideoDownload,VideoDownloadError} from './video-download.js';
import {VideoRenderer} from './video-renderer.js';
import {CreativeJobs} from './creative-jobs.js';
import {CreativeError} from './creative-contracts.js';
import {VideoStateError} from './video-vault.js';
import {HIGGSFIELD_MODELS} from './higgsfield-client.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {digest,MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';
import {validateVideoPlanningResult,type VideoPlanningInput} from './video-planning.js';
const terminal=new Set(['succeeded','rejected','failed','canceled','unknown']);
export class VideoJobs {
 constructor(readonly jobs:AssetJobs,readonly references:VideoReferences,readonly creative:CreativeJobs,readonly provider:VideoProviderJobs,readonly download:VideoDownload,readonly renderer:VideoRenderer){}
 private transaction<T>(scope:JobScope,action:(db:any,j:any)=>Promise<T>){return this.jobs.transaction(scope,async(db,j)=>{if(j.kind!=='creative.video')throw new VideoStateError('VIDEO_JOB_KIND_DENIED');return action(db,j);});}
 private async finish(scope:JobScope,status:string,code:string|null){await this.transaction(scope,async(db,j)=>{await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]);});await this.references.revoke(scope);return status;}
 private async providerStep(scope:JobScope){const phase=await this.provider.step(scope,async(db,j)=>{await this.references.verifySubmission(db,j);await assertLearningCurrent(db,(await db.query('SELECT memory_context FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0]?.memory_context);await this.checkSlot(db,j);});if(!['accepted','prepared','completed'].includes(phase))await this.references.revoke(scope);return phase;}
 private async checkSlot(db:any,j:any){
  const r=(await db.query('SELECT slot_id,slot_revision FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
  if(!r?.slot_id)return;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
  const s=(await db.query('SELECT revision,state FROM app.content_slots WHERE id=$1',[r.slot_id])).rows[0];
  if(!s||s.revision!==r.slot_revision||['approved','cancelled'].includes(s.state))throw new VideoStateError('VIDEO_CALENDAR_CHANGED');
 }
 async exhausted(scope:JobScope){
  const state=await this.transaction(scope,async(db,j)=>({status:j.status,phase:(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0]?.phase}));
  if(terminal.has(state.status)){await this.references.revoke(scope);return state.status;}
  if(state.phase&&state.phase!=='completed'){const phase=await this.provider.exhausted(scope);await this.references.revoke(scope);return phase;}
  return this.finish(scope,'failed','VIDEO_PROCESSING_RETRY_EXHAUSTED');
 }
 async step(scope:JobScope):Promise<string>{
  try{
   const state=await this.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return {done:j.status};
    const request=(await db.query('SELECT * FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
    if(!request)throw new VideoStateError('VIDEO_REQUEST_MISSING');
    const operation=(await db.query('SELECT phase FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
    return {request,phase:operation?.phase,permitted:await this.jobs.permitted(db,j)};
   });
   if('done' in state){await this.references.revoke(scope);return state.done;}
   let proof;
   try{if(!state.permitted)throw new VideoStateError('REFERENCE_ACCESS_REVOKED');proof=await this.references.verify(scope);}catch(e){
    if(!(e instanceof VideoStateError))throw e;
    if(state.phase==='accepted'){
     await this.transaction(scope,async(db,j)=>{await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[j.id]);});
     await this.references.revoke(scope);const phase=await this.providerStep(scope);if(phase==='accepted')return phase;
    }
    return this.finish(scope,'canceled',e instanceof VideoStateError?e.code:'VIDEO_ACCESS_REVOKED');
   }
   if(!this.renderer.configured||!this.creative.runtime.configured||!this.creative.planner(state.request.text_provider).configured)throw new VideoStateError('VIDEO_RUNTIME_NOT_CONFIGURED');
   const request=state.request;
   if(!state.phase){
    await this.transaction(scope,(db,j)=>this.checkSlot(db,j));
    const context=await this.transaction(scope,async(db,j)=>{
     const brain=(await db.query('SELECT * FROM app.brand_brain_versions WHERE id=$1',[request.brain_id])).rows[0];
     if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new VideoStateError('VIDEO_BRAND_INTEGRITY_FAILED');
     const grant=await this.creative.plannerGrant(db,j,request.text_provider);
     if(!grant)throw new VideoStateError('VIDEO_TEXT_APPROVAL_REQUIRED');
     const input:VideoPlanningInput={task:'video',brand:{id:brain.id,sha256:brain.sha256,learning:request.memory_context,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},prompt:request.prompt,channel:request.channel,duration_seconds:request.duration_seconds,reference:{kind:'image',sha256:proof.sha256,width:proof.width,height:proof.height,duration_seconds:null,caption:''}};
     return {input,grant};
    });
    let plan=request.plan;
    if(!plan){
     plan=await this.creative.runtime.videoPlan(context.input,message=>this.creative.planCall(scope,message,request));
     validateVideoPlanningResult(plan,context.input);
     await this.transaction(scope,async(db,j)=>{if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');await db.query('UPDATE app.video_requests SET plan=$2 WHERE job_id=$1',[j.id,JSON.stringify(plan)]);});
    }
    if(!request.approved_brief||request.approved_revision!==request.draft_revision)return 'awaiting_approval';
    plan={...plan,brief:request.approved_brief};
    validateVideoPlanningResult(plan,context.input);
    await this.transaction(scope,async(db)=>assertLearningCurrent(db,request.memory_context));
    const lease=await this.references.prepare(scope);
    await this.references.verify(scope);
    await this.provider.prepare(scope,{kind:'image',model:HIGGSFIELD_MODELS.image,idempotencyKey:scope.jobId,referenceURL:lease.url,prompt:plan.brief.video_prompt+'\nScript:\n'+plan.brief.beats.map((b:any)=>`${b.start_ms}-${b.end_ms}ms: ${b.action} Camera: ${b.camera}`).join('\n'),durationSeconds:request.duration_seconds,sound:'off'},async(db,j)=>{
     await this.checkSlot(db,j);
     const latest=(await db.query('SELECT approved_brief,approved_revision,draft_revision FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
     if(!latest?.approved_brief||latest.approved_revision!==request.approved_revision||latest.draft_revision!==request.draft_revision||canonicalJSON(latest.approved_brief)!==canonicalJSON(request.approved_brief))throw new Error('VIDEO_PROMPT_APPROVAL_CHANGED');
    });
    return this.providerStep(scope);
   }
   if(state.phase!=='completed')return this.providerStep(scope);
   let base=await this.transaction(scope,async(db,j)=>(await db.query('SELECT * FROM app.video_bases WHERE job_id=$1',[j.id])).rows[0]);
   if(!base){
    const remote=await this.provider.output(scope),untrusted=await this.download.read(remote.url),clean=await this.renderer.render(untrusted.bytes,request.duration_seconds,[]);
    const key=`video/${scope.organizationId}/${scope.brandId}/${scope.jobId}/base/${clean.manifest.video_sha256}`;
    await this.jobs.store.persist(key,clean.video,'video/mp4',clean.manifest.video_sha256);
    base=await this.transaction(scope,async(db,j)=>{
     if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
     await db.query('INSERT INTO app.video_bases(job_id,organization_id,brand_id,object_key,sha256,bytes,width,height,duration_ms,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(job_id) DO NOTHING',[j.id,j.organization_id,j.brand_id,key,clean.manifest.video_sha256,clean.video.length,clean.metadata.width,clean.metadata.height,clean.metadata.duration_ms,JSON.stringify(clean.manifest)]);
     return (await db.query('SELECT * FROM app.video_bases WHERE job_id=$1',[j.id])).rows[0];
    });
   }
   if(base.manifest.image!==this.renderer.image)throw new VideoStateError('VIDEO_RENDERER_CHANGED');
   const source=await this.jobs.store.read(base.object_key,MAX_CANONICAL_VIDEO_BYTES);
   if(source.length!==base.bytes||digest(source)!==base.sha256)throw new VideoStateError('VIDEO_BASE_INTEGRITY_FAILED');
   const output=await this.renderer.render(source,request.duration_seconds,request.approved_brief.overlays),prefix=`video/${scope.organizationId}/${scope.brandId}/${scope.jobId}`;
   const key=`${prefix}/render/${output.manifest.video_sha256}`,posterKey=`${prefix}/poster/${output.manifest.poster_sha256}`;
   await this.jobs.store.persist(key,output.video,'video/mp4',output.manifest.video_sha256);
   await this.jobs.store.persist(posterKey,output.poster,'image/png',output.manifest.poster_sha256);
   await this.references.verify(scope);
   const outcome=await this.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
    const freshProof=await this.references.verifyTransaction(db,j);
    const id=randomUUID(),manifest={...output.manifest,learning:request.memory_context,text_provider:request.text_provider,text_model:request.selected_text_model,brain_id:request.brain_id,plan:{...request.plan,brief:request.approved_brief},prompt_approval:{actor:request.approved_by,revision:request.approved_revision},reference:freshProof.brand_reference_id?{kind:'upload',brand_reference_id:freshProof.brand_reference_id,sha256:freshProof.sha256}:{export_id:freshProof.id,sha256:freshProof.sha256,approval_id:freshProof.approval_id}};
    await db.query('INSERT INTO app.video_versions(id,organization_id,brand_id,project_id,job_id,object_key,sha256,bytes,poster_key,poster_sha256,poster_bytes,caption,overlays,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,j.organization_id,j.brand_id,request.project_id,j.id,key,output.manifest.video_sha256,output.video.length,posterKey,output.manifest.poster_sha256,output.poster.length,request.approved_brief.caption,JSON.stringify(request.approved_brief.overlays),JSON.stringify(manifest)]);
    await db.query('UPDATE app.video_projects SET latest_version_id=$2 WHERE id=$1',[request.project_id,id]);
    await db.query('UPDATE app.video_requests SET output_version_id=$2 WHERE job_id=$1',[j.id,id]);
    if(request.slot_id){
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
     const attached=(await db.query("UPDATE app.content_slots SET video_version_id=$2,video_sha256=$3,revision=revision+1,state='draft_ready',updated_at=now() WHERE id=$1 AND revision=$4 AND approved_by IS NULL AND state NOT IN ('approved','cancelled') RETURNING *",[request.slot_id,id,output.manifest.video_sha256,request.slot_revision])).rows[0];
     if(attached)await db.query("INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,video_version_id,video_sha256,feedback,snapshot) VALUES($1,$2,$3,$4,$5,'creative_attached',$6,$7,$8,'',$9)",[randomUUID(),j.organization_id,j.brand_id,attached.id,attached.revision,j.requested_by,id,output.manifest.video_sha256,JSON.stringify({state:attached.state,video_version_id:id,video_sha256:output.manifest.video_sha256,job_id:j.id})]);
    }
    await db.query("UPDATE app.jobs SET status='succeeded',error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return 'succeeded';
   });
   await this.references.revoke(scope);return outcome;
  }catch(error){
   if(error instanceof VideoStateError&&error.code==='VIDEO_CALENDAR_CHANGED'){await this.provider.cancelPrepared(scope,error.code);return this.finish(scope,'canceled',error.code);}
   if(error instanceof CreativeError||error instanceof VideoStateError){const code=error.code;return this.finish(scope,/UNKNOWN|REPLAY/.test(code)?'unknown':'rejected',code);}
   if(error instanceof VideoDownloadError&&error.code!=='VIDEO_DOWNLOAD_FAILED')return this.finish(scope,'rejected',error.code);
   throw error;
  }
 }
}
