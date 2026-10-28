import {creativeDimensions,normalizeCreativeSpec} from './campaign-formats.js';
import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {CreativeJobs} from './creative-jobs.js';
import {ExportJobs} from './export-jobs.js';
import {CreativeError} from './creative-contracts.js';
import {validateCarouselInput,validateCarouselResult} from './carousel-planning.js';
import {carouselFingerprint} from './carousels.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {assertLearningCurrent} from './learning-context.js';
const terminal=new Set(['succeeded','rejected','failed','canceled','unknown']);
export class CarouselJobs {
 constructor(readonly jobs:AssetJobs,readonly creative:CreativeJobs,readonly exporter:ExportJobs){}
 childScope(scope:JobScope,id:string):JobScope{return {...scope,jobId:id};}
 async children(scope:JobScope){return this.jobs.transaction(scope,async(db,j)=>{if(j.kind!=='carousel.generate')throw Error('JOB_KIND_DENIED');return (await db.query('SELECT position,generation_job_id,export_job_id FROM app.carousel_children WHERE parent_job_id=$1 ORDER BY position',[j.id])).rows;});}
 async stop(scope:JobScope,state:string,code:string):Promise<string>{
  const children=await this.children(scope);let uncertain=await this.jobs.transaction(scope,async(db,j)=>!!(await db.query("SELECT 1 FROM app.creative_calls WHERE job_id=$1 AND status IN ('submitted','unknown') LIMIT 1",[j.id])).rowCount);
  for(const child of children)uncertain=await this.jobs.transaction(this.childScope(scope,child.generation_job_id),async(db,j)=>j.status==='unknown'||!!(await db.query("SELECT 1 FROM app.creative_calls WHERE job_id=$1 AND status IN ('submitted','unknown') LIMIT 1",[j.id])).rowCount)||uncertain;
  const result=await this.jobs.transaction<string>(scope,(db,j)=>terminal.has(j.status)?Promise.resolve(j.status):this.creative.finish(db,j,uncertain?'unknown':state,uncertain?'CREATIVE_SUBMISSION_UNKNOWN':code));
  for(const child of children)for(const id of [child.generation_job_id,child.export_job_id])await this.jobs.transaction(this.childScope(scope,id),async(db,j)=>{if(j.status==='queued'&&j.attempt===0)await db.query("UPDATE app.jobs SET status='canceled',error_code='CAROUSEL_STOPPED',updated_at=now() WHERE id=$1",[j.id]);});
  return result;
 }
 async plan(scope:JobScope):Promise<{state:string;children?:{generation_job_id:string;export_job_id:string;position:number}[]}>{
  try{
   const r=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='carousel.generate')throw Error('JOB_KIND_DENIED');if(terminal.has(j.status))return {terminal:j.status};
    const r=(await db.query('SELECT * FROM app.carousel_requests WHERE job_id=$1',[j.id])).rows[0];if(!r||r.canceled||!await this.jobs.permitted(db,j))throw new CreativeError('CREATIVE_ACCESS_REVOKED');
    if(!this.creative.provider.configured)throw new CreativeError('CREATIVE_PROVIDER_NOT_CONFIGURED');if(!this.exporter.renderer.configured||this.exporter.renderer.image!==r.renderer_image)throw new CreativeError('EXPORT_RENDERER_CHANGED');
    validateCarouselInput(r.input);if(hash(canonicalJSON(r.input))!==r.input_sha256)throw new CreativeError('CAROUSEL_INPUT_CHANGED');await assertLearningCurrent(db,r.memory_context);
    const children=(await db.query('SELECT position,generation_job_id,export_job_id FROM app.carousel_children WHERE parent_job_id=$1 ORDER BY position',[j.id])).rows;if(children.length!==r.input.slide_count||children.some((c,i)=>c.position!==i))throw new CreativeError('CAROUSEL_CHILDREN_INVALID');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",[j.id]);return {...r,children};
   });
   if(r.terminal)return {state:r.terminal};
   const plan=r.plan??await this.creative.runtime.carouselPlan(r.input,message=>this.creative.planCall(scope,message,r,16000));validateCarouselResult(plan,r.input);
   await this.jobs.transaction(scope,async(db,j)=>{const live=(await db.query('SELECT canceled FROM app.carousel_requests WHERE job_id=$1',[j.id])).rows[0];if(live.canceled||!await this.jobs.permitted(db,j))throw new CreativeError('CREATIVE_ACCESS_REVOKED');await db.query('UPDATE app.carousel_requests SET plan=$2 WHERE job_id=$1',[j.id,JSON.stringify(plan)]);});
   return {state:'ready',children:r.children};
  }catch(error){if(!(error instanceof CreativeError))throw error;return {state:await this.stop(scope,error.code==='CREATIVE_ACCESS_REVOKED'?'canceled':'rejected',error.code)};}
 }
 async prepareExport(scope:JobScope,position:number):Promise<{state:string;export_scope?:JobScope}>{
  const children=await this.children(scope),child=children.find(c=>c.position===position);if(!child)throw Error('CAROUSEL_CHILD_MISSING');
  const status=await this.jobs.transaction(this.childScope(scope,child.generation_job_id),async(_db,j)=>j.status);
  if(status!=='succeeded')return {state:await this.stop(scope,status==='unknown'?'unknown':status==='canceled'?'canceled':'rejected','CAROUSEL_SLIDE_FAILED')};
  try{
   await this.jobs.transaction(scope,async(db,j)=>{
    const r=(await db.query('SELECT * FROM app.carousel_requests WHERE job_id=$1',[j.id])).rows[0];if(r.canceled||!await this.jobs.permitted(db,j))throw new CreativeError('CREATIVE_ACCESS_REVOKED');
    const v=(await db.query('SELECT v.id,v.sha256 FROM app.creative_requests r JOIN app.creative_versions v ON v.id=r.output_version_id JOIN app.creative_projects p ON p.id=v.project_id WHERE r.job_id=$1 AND p.latest_version_id=v.id',[child.generation_job_id])).rows[0];if(!v)throw new CreativeError('CAROUSEL_SLIDE_CHANGED');
    const prior=(await db.query('SELECT version_id,source_sha256,renderer_image FROM app.creative_export_requests WHERE job_id=$1',[child.export_job_id])).rows[0];if(prior){if(prior.version_id!==v.id||prior.source_sha256!==v.sha256||prior.renderer_image!==r.renderer_image)throw new CreativeError('CAROUSEL_EXPORT_CHANGED');return;}
    await db.query('INSERT INTO app.creative_export_requests(job_id,organization_id,brand_id,version_id,source_sha256,renderer_image,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[child.export_job_id,j.organization_id,j.brand_id,v.id,v.sha256,r.renderer_image,`carousel-export:${j.id}:${position}`,hash(canonicalJSON({parent:j.id,position,version:v.id,sha:v.sha256,renderer:r.renderer_image}))]);
   });return {state:'ready',export_scope:this.childScope(scope,child.export_job_id)};
  }catch(error){if(!(error instanceof CreativeError))throw error;return {state:await this.stop(scope,error.code==='CREATIVE_ACCESS_REVOKED'?'canceled':'rejected',error.code)};}
 }
 async checkExport(scope:JobScope,position:number){const child=(await this.children(scope)).find(c=>c.position===position);if(!child)throw Error('CAROUSEL_CHILD_MISSING');const state=await this.jobs.transaction(this.childScope(scope,child.export_job_id),async(_db,j)=>j.status);return state==='succeeded'?'ready':this.stop(scope,state==='canceled'?'canceled':'rejected','CAROUSEL_EXPORT_FAILED');}
 async complete(scope:JobScope):Promise<string>{
  try{return await this.jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='carousel.generate')throw Error('JOB_KIND_DENIED');if(terminal.has(j.status))return j.status;
   const r=(await db.query('SELECT * FROM app.carousel_requests WHERE job_id=$1',[j.id])).rows[0];if(r.canceled||!await this.jobs.permitted(db,j))throw new CreativeError('CREATIVE_ACCESS_REVOKED');await assertLearningCurrent(db,r.memory_context);
   const shared=validateCarouselResult(r.plan,r.input);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
   const project=(await db.query('SELECT latest_version_id FROM app.carousel_projects WHERE id=$1 FOR UPDATE',[r.project_id])).rows[0];if(!project||project.latest_version_id)throw new CreativeError('CAROUSEL_PROJECT_CHANGED');
   const pages=(await db.query('SELECT c.position,v.id AS creative_version_id,v.sha256 AS version_sha256,v.brain_id,p.latest_version_id,e.id AS export_id,e.sha256,e.source_sha256,e.width,e.height,e.renderer_image FROM app.carousel_children c JOIN app.creative_requests cr ON cr.job_id=c.generation_job_id JOIN app.creative_versions v ON v.id=cr.output_version_id JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_exports e ON e.job_id=c.export_job_id AND e.version_id=v.id WHERE c.parent_job_id=$1 ORDER BY c.position',[j.id])).rows;
   if(pages.length!==r.input.slide_count||pages.some((p,i)=>p.position!==i||p.creative_version_id!==p.latest_version_id||p.version_sha256!==p.source_sha256||p.renderer_image!==r.renderer_image||p.brain_id!==r.input.brand.id||p.width!==pages[0].width||p.height!==pages[0].height))throw new CreativeError('CAROUSEL_OUTPUT_INCOMPLETE');
   if(r.creative_spec){const spec=normalizeCreativeSpec(r.creative_spec,'carousel',r.input.channel),target=creativeDimensions(spec);if(pages.length!==spec.slide_count||pages.some(p=>p.width!==target.width||p.height!==target.height))throw new CreativeError('CAROUSEL_OUTPUT_INCOMPLETE');}
   for(const p of pages)p.alt_text=shared.plan.slides[p.position].alt_text;
   const content={title:shared.plan.title,caption:shared.plan.caption,channel:r.input.channel},id=randomUUID(),sha=carouselFingerprint(content,pages);
   await db.query('INSERT INTO app.carousel_versions(id,organization_id,brand_id,project_id,title,caption,channel,sha256,created_by,request_key,request_hash,generation_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,j.organization_id,j.brand_id,r.project_id,content.title,content.caption,content.channel,sha,j.requested_by,`carousel-output:${j.id}`,hash(canonicalJSON({plan:r.plan,renderer:r.renderer_image})),j.id]);
   for(const p of pages)await db.query('INSERT INTO app.carousel_pages(organization_id,brand_id,carousel_version_id,position,creative_version_id,export_id,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7)',[j.organization_id,j.brand_id,id,p.position,p.creative_version_id,p.export_id,p.alt_text]);
   await db.query('UPDATE app.carousel_projects SET latest_version_id=$2 WHERE id=$1',[r.project_id,id]);await db.query('UPDATE app.carousel_requests SET output_version_id=$2 WHERE job_id=$1',[j.id,id]);
   const binding=(await db.query('SELECT * FROM app.content_slot_carousel_generations WHERE job_id=$1 FOR UPDATE',[j.id])).rows[0];
   if(binding){
    const slot=(await db.query('SELECT * FROM app.content_slots WHERE id=$1 FOR UPDATE',[binding.slot_id])).rows[0];
    const matches=slot&&slot.format==='carousel'&&slot.channel===r.input.channel&&slot.revision===binding.source_revision&&!slot.approved_by&&!['approved','cancelled'].includes(slot.state)&&canonicalJSON(slot.creative_spec??null)===canonicalJSON(binding.creative_spec??null)&&canonicalJSON(r.creative_spec??null)===canonicalJSON(binding.creative_spec??null);
    if(matches){
     const attached=(await db.query("UPDATE app.content_slots SET carousel_version_id=$2,carousel_sha256=$3,state='draft_ready',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[slot.id,id,sha])).rows[0];
     await db.query("UPDATE app.content_slot_carousel_generations SET attachment_status='attached',attached_version_id=$2 WHERE job_id=$1",[j.id,id]);
     const snapshot={...attached,creative_spec:attached.creative_spec??null};
     await db.query("INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,creative_version_id,creative_sha256,feedback,snapshot,carousel_version_id,carousel_sha256) VALUES($1,$2,$3,$4,$5,'creative_attached',$6,NULL,NULL,'',$7,$8,$9)",[randomUUID(),j.organization_id,j.brand_id,slot.id,attached.revision,j.requested_by,JSON.stringify(snapshot),id,sha]);
    }else await db.query("UPDATE app.content_slot_carousel_generations SET attachment_status='needs_attachment' WHERE job_id=$1",[j.id]);
   }
   return this.creative.finish(db,j,'succeeded');
  });}catch(error){if(!(error instanceof CreativeError))throw error;return this.stop(scope,error.code==='CREATIVE_ACCESS_REVOKED'?'canceled':'rejected',error.code);}
 }
 fail(scope:JobScope){return this.stop(scope,'failed','CAROUSEL_RETRIES_EXHAUSTED');}
}
