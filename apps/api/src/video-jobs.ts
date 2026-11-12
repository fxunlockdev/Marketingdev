import {normalizeCreativeSpec,creativeDimensions} from "./campaign-formats.js";
import {monthlyBudgetExceeded} from './spending-allowance.js';
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
import {RUNWAY_VIDEO_MODEL,RunwayError} from './runway-client.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {digest,MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';
import {validateVideoPlanningResult,type VideoPlanningInput} from './video-planning.js';
import {packForJob,promptKnowledge,recordPost,type StoredKnowledge} from './knowledge-production.js';
import {logActivityFailure} from './activity-log.js';
/** What a video plan was given beyond its request, stored once so a retry sends the same input. */
export type VideoKnowledge={knowledge:StoredKnowledge;shot_list:string|null};
const PROMPT_LIMIT=4000;
type Shot={visual:string;camera:string;on_screen_text:string};
/** The shot list the customer reviewed in their plan, as a 'Shot list:' section that fits in `room` characters. Pure. */
export function shotListSection(storyline:unknown,room:number):string|null{
 const shots=(storyline as {kind?:unknown;shots?:unknown})?.kind==='video'&&Array.isArray((storyline as {shots?:unknown}).shots)?(storyline as {shots:Shot[]}).shots:[];
 const head='\nShot list:';let text=head;
 for(const [i,shot] of shots.entries()){
  const flat=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim();
  const line=`\n${i+1}. ${flat(shot.visual)} Camera: ${flat(shot.camera)}.${flat(shot.on_screen_text)?` On-screen text: ${flat(shot.on_screen_text)}`:''}`;
  if(text.length+line.length>room)break;text+=line;
 }
 return text===head?null:text;
}
const terminal=new Set(['succeeded','rejected','failed','canceled','unknown']);
export class VideoJobs {
 constructor(readonly jobs:AssetJobs,readonly references:VideoReferences,readonly creative:CreativeJobs,readonly provider:VideoProviderJobs,readonly download:VideoDownload,readonly renderer:VideoRenderer){}
 private transaction<T>(scope:JobScope,action:(db:any,j:any)=>Promise<T>){return this.jobs.transaction(scope,async(db,j)=>{if(j.kind!=='creative.video')throw new VideoStateError('VIDEO_JOB_KIND_DENIED');return action(db,j);});}
 private async finish(scope:JobScope,status:string,code:string|null){await this.transaction(scope,async(db,j)=>{await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]);});await this.references.revoke(scope);return status;}
 private async providerStep(scope:JobScope,forceCancel=false){const phase=await this.provider.step(scope,async(db,j)=>{await this.assertGenerationAuthority(db,j);await this.references.verifySubmission(db,j);await assertLearningCurrent(db,(await db.query('SELECT memory_context FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0]?.memory_context);await this.checkSlot(db,j);},forceCancel);if(!['accepted','prepared','completed'].includes(phase))await this.references.revoke(scope);return phase;}
 private async assertGenerationAuthority(db:any,j:any){
  const r=(await db.query('SELECT generation_authorized_by FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
  if(!r?.generation_authorized_by)return;
  const allowed=(await db.query(`SELECT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=$1 AND b.brand_id=$3 AND b.user_id=$2 AND b.active AND b.role='admin')))) AS allowed`,[j.organization_id,r.generation_authorized_by,j.brand_id])).rows[0]?.allowed;
  if(r.generation_authorized_by!==j.requested_by||!allowed)throw new VideoStateError('VIDEO_GENERATION_AUTHORITY_REVOKED');
 }
 private async checkSlot(db:any,j:any){
  const r=(await db.query('SELECT slot_id,slot_revision,creative_spec FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
  if(!r?.slot_id)return;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
  const s=(await db.query('SELECT revision,state,creative_spec FROM app.content_slots WHERE id=$1',[r.slot_id])).rows[0];
  if(!s||canonicalJSON(s.creative_spec??null)!==canonicalJSON(r.creative_spec??null)||s.revision!==r.slot_revision||['approved','cancelled'].includes(s.state))throw new VideoStateError('VIDEO_CALENDAR_CHANGED');
 }
 /** The stored pack and reviewed shot list, or new ones saved before any planner call. A job that already called
  * a model before packs existed keeps its original input, so its recorded calls still match. */
 private async knowledgeContext(db:any,j:any,request:any,base:string):Promise<VideoKnowledge>{
  if(request.knowledge_context)return request.knowledge_context as VideoKnowledge;
  const started=(await db.query('SELECT 1 FROM app.creative_calls WHERE job_id=$1 LIMIT 1',[j.id])).rowCount;
  const storyline=!started&&request.slot_id?(await db.query('SELECT storyline FROM app.content_slots WHERE id=$1',[request.slot_id])).rows[0]?.storyline:null;
  const stored:VideoKnowledge=started?{knowledge:{status:'skipped',reason:'KNOWLEDGE_JOB_ALREADY_STARTED'},shot_list:null}
   :{knowledge:await packForJob(db,{organizationId:j.organization_id,brandId:j.brand_id},'video',base),shot_list:shotListSection(storyline,PROMPT_LIMIT-base.length)};
  await db.query('UPDATE app.video_requests SET knowledge_context=$2 WHERE job_id=$1',[j.id,JSON.stringify(stored)]);
  request.knowledge_context=stored;return stored;
 }
 /** Production record for the graph: a post node and used_in edges from the video's pack. Never fails the video. */
 private async recordKnowledge(scope:JobScope):Promise<void>{
  try{
   await this.transaction(scope,async(db,j)=>{
    const row=(await db.query('SELECT r.knowledge_context,r.output_version_id,r.approved_brief FROM app.video_requests r WHERE r.job_id=$1',[j.id])).rows[0];
    const knowledge=(row?.knowledge_context as VideoKnowledge|null)?.knowledge;
    if(!row?.output_version_id||knowledge?.status!=='ready')return;
    await recordPost(db,{organizationId:j.organization_id,brandId:j.brand_id},{key:`video ${row.output_version_id}`,label:String(row.approved_brief?.title??'Video'),jobId:j.id,properties:{video_version_id:row.output_version_id}},knowledge.used_node_ids);
   });
  }catch(error){logActivityFailure('KnowledgeRecord',scope,error);}
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
    if(state.phase&&state.phase!=='completed'){
     // Re-read the durable phase under the provider lock: it may have advanced
     // since this activity read it. Never overwrite an uncertain paid outcome.
     await this.references.revoke(scope);
     const phase=await this.providerStep(scope,true);
     if(phase!=='completed')return phase;
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
     const base=request.prompt+(request.creative_spec?`\nCompose for ${request.creative_spec.placement}, ${request.creative_spec.aspect} framing. Keep the subject and text within this frame.`:'');
     const extra=request.plan?(request.knowledge_context as VideoKnowledge|null)??null:await this.knowledgeContext(db,j,request,base);
     const input:VideoPlanningInput={task:'video',brand:{id:brain.id,sha256:brain.sha256,learning:request.memory_context,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},prompt:base+(extra?.shot_list??''),channel:request.channel,duration_seconds:request.duration_seconds,reference:{kind:'image',sha256:proof.sha256,width:proof.width,height:proof.height,duration_seconds:null,caption:''}};
     return {input,grant,knowledge:extra?.knowledge};
    });
    let plan=request.plan;
    if(!plan){
     plan=await this.creative.runtime.videoPlan(context.input,message=>this.creative.planCall(scope,message,request),context.knowledge?promptKnowledge(context.knowledge):undefined);
     validateVideoPlanningResult(plan,context.input);
     await this.transaction(scope,async(db,j)=>{if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');await db.query('UPDATE app.video_requests SET plan=$2 WHERE job_id=$1',[j.id,JSON.stringify(plan)]);});
    }
    if(request.generation_authorized_by&&!request.approved_brief){
     // Generate is an explicit authorization of this saved prompt/reference. The
     // validated skill plan can proceed without another browser round-trip.
     const approved=await this.transaction(scope,async(db,j)=>{
      if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
      await this.assertGenerationAuthority(db,j);
      return (await db.query(`UPDATE app.video_requests SET approved_brief=plan->'brief',approved_revision=draft_revision,approved_by=generation_authorized_by,approved_at=now() WHERE job_id=$1 AND approved_brief IS NULL AND edited_brief IS NULL AND draft_revision=1 RETURNING *`,[j.id])).rows[0];
     });
     if(approved)Object.assign(request,approved);
    }
    if(!request.approved_brief||request.approved_revision!==request.draft_revision)return 'awaiting_approval';
    plan={...plan,brief:request.approved_brief};
    validateVideoPlanningResult(plan,context.input);
    await this.transaction(scope,async(db)=>assertLearningCurrent(db,request.memory_context));
    const lease=await this.references.prepare(scope);
    await this.references.verify(scope);
    await this.provider.prepare(scope,{kind:'image',model:RUNWAY_VIDEO_MODEL,idempotencyKey:scope.jobId,referenceURL:lease.url,...(request.duration_seconds===3?{routingProfile:'short-clip-v1'}:{}),prompt:plan.brief.video_prompt+'\nScript:\n'+plan.brief.beats.map((b:any)=>`${b.start_ms}-${b.end_ms}ms: ${b.action} Camera: ${b.camera}`).join('\n'),durationSeconds:request.duration_seconds,sound:'off',aspectRatio:request.creative_spec?.aspect==='square'?'1:1':request.creative_spec?.aspect==='landscape'?'16:9':request.creative_spec?.aspect==='portrait'?'3:4':'9:16'},async(db,j)=>{
     await this.checkSlot(db,j);
     const latest=(await db.query('SELECT approved_brief,approved_revision,draft_revision FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
     if(!latest?.approved_brief||latest.approved_revision!==request.approved_revision||latest.draft_revision!==request.draft_revision||canonicalJSON(latest.approved_brief)!==canonicalJSON(request.approved_brief))throw new Error('VIDEO_PROMPT_APPROVAL_CHANGED');
    });
    return this.providerStep(scope);
   }
   if(state.phase!=='completed')return this.providerStep(scope);
   let base=await this.transaction(scope,async(db,j)=>(await db.query('SELECT * FROM app.video_bases WHERE job_id=$1',[j.id])).rows[0]);
   if(!base){
    const remote=await this.provider.output(scope),untrusted=await this.download.readProviderOutput(remote),clean=await this.renderer.render(untrusted.bytes,request.duration_seconds,[]);
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
   const output=await this.renderer.render(source,request.duration_seconds,request.approved_brief.overlays,request.creative_spec?creativeDimensions(normalizeCreativeSpec(request.creative_spec,'video',request.channel)):undefined),prefix=`video/${scope.organizationId}/${scope.brandId}/${scope.jobId}`;
   const key=`${prefix}/render/${output.manifest.video_sha256}`,posterKey=`${prefix}/poster/${output.manifest.poster_sha256}`;
   await this.jobs.store.persist(key,output.video,'video/mp4',output.manifest.video_sha256);
   await this.jobs.store.persist(posterKey,output.poster,'image/png',output.manifest.poster_sha256);
   await this.references.verify(scope);
   const outcome=await this.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    if(!await this.jobs.permitted(db,j))throw new VideoStateError('VIDEO_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
    const freshProof=await this.references.verifyTransaction(db,j);
    const operation=(await db.query('SELECT provider,model,routing FROM app.video_operations WHERE job_id=$1',[j.id])).rows[0];
    const id=randomUUID(),manifest={...output.manifest,video_provider:operation?.provider,video_routing:operation?.routing,...(request.creative_spec?{creative_spec:request.creative_spec}:{}),learning:request.memory_context,text_provider:request.text_provider,text_model:request.selected_text_model,brain_id:request.brain_id,plan:{...request.plan,brief:request.approved_brief},prompt_approval:{actor:request.approved_by,revision:request.approved_revision},reference:freshProof.brand_reference_id?{kind:'upload',brand_reference_id:freshProof.brand_reference_id,sha256:freshProof.sha256}:{export_id:freshProof.id,sha256:freshProof.sha256,approval_id:freshProof.approval_id}};
    await db.query('INSERT INTO app.video_versions(id,organization_id,brand_id,project_id,job_id,object_key,sha256,bytes,poster_key,poster_sha256,poster_bytes,caption,overlays,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,j.organization_id,j.brand_id,request.project_id,j.id,key,output.manifest.video_sha256,output.video.length,posterKey,output.manifest.poster_sha256,output.poster.length,request.approved_brief.caption,JSON.stringify(request.approved_brief.overlays),JSON.stringify(manifest)]);
    await db.query('UPDATE app.video_projects SET latest_version_id=$2 WHERE id=$1',[request.project_id,id]);
    await db.query('UPDATE app.video_requests SET output_version_id=$2 WHERE job_id=$1',[j.id,id]);
    if(request.slot_id){
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${j.brand_id}`]);
     const attached=(await db.query("UPDATE app.content_slots SET video_version_id=$2,video_sha256=$3,revision=revision+1,state='draft_ready',updated_at=now() WHERE id=$1 AND revision=$4 AND creative_spec IS NOT DISTINCT FROM $5::jsonb AND approved_by IS NULL AND state NOT IN ('approved','cancelled') RETURNING *",[request.slot_id,id,output.manifest.video_sha256,request.slot_revision,request.creative_spec?JSON.stringify(request.creative_spec):null])).rows[0];
     if(attached)await db.query("INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,video_version_id,video_sha256,feedback,snapshot) VALUES($1,$2,$3,$4,$5,'creative_attached',$6,$7,$8,'',$9)",[randomUUID(),j.organization_id,j.brand_id,attached.id,attached.revision,j.requested_by,id,output.manifest.video_sha256,JSON.stringify({state:attached.state,creative_spec:attached.creative_spec??null,video_version_id:id,video_sha256:output.manifest.video_sha256,job_id:j.id})]);
    }
    await db.query("UPDATE app.jobs SET status='succeeded',error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return 'succeeded';
   });
   if(outcome==='succeeded')await this.recordKnowledge(scope);
   await this.references.revoke(scope);return outcome;
  }catch(error){
   // Status GET failures are retryable, including after cancellation was requested.
   if(error instanceof VideoStateError&&error.code==='VIDEO_STATUS_UNAVAILABLE')throw error;
   if(monthlyBudgetExceeded(error))error=new VideoStateError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
   if(error instanceof VideoStateError&&error.code==='VIDEO_CALENDAR_CHANGED'){await this.provider.cancelPrepared(scope,error.code);return this.finish(scope,'canceled',error.code);}
   if(error instanceof CreativeError||error instanceof VideoStateError||error instanceof RunwayError){const code=error.code;return this.finish(scope,/UNKNOWN|REPLAY/.test(code)?'unknown':'rejected',code);}
   if(error instanceof VideoDownloadError&&error.code!=='VIDEO_DOWNLOAD_FAILED')return this.finish(scope,'rejected',error.code);
   throw error;
  }
 }
}
