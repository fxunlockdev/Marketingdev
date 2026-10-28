import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {AssetJobs,type JobScope} from './jobs.js';
import {HiggsfieldImageClient,HiggsfieldImageError,HIGGSFIELD_IMAGE_MODEL,type StillIntent} from './higgsfield-image-client.js';
import {ImageReplacementVault} from './image-replacement-vault.js';
import {SafeWeb,websiteURL} from './safe-web.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {digest} from './object-store.js';
import {validateDesign} from './creative-design.js';
import {exceedsAllowance,monthlyBudgetExceeded} from './spending-allowance.js';
const terminal=new Set(['succeeded','rejected','failed','canceled','unknown']);
export class HiggsfieldReplacementJobs {
 constructor(readonly jobs:AssetJobs,readonly provider:HiggsfieldImageClient,readonly vault:ImageReplacementVault,readonly web=new SafeWeb()){}
 handles(scope:JobScope){return this.jobs.transaction(scope,async(db)=> (await db.query('SELECT image_provider FROM app.creative_requests WHERE job_id=$1',[scope.jobId])).rows[0]?.image_provider==='higgsfield');}
 private finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 private async grant(db:any,j:any){const g=(await db.query('SELECT * FROM app.higgsfield_image_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[j.organization_id,j.brand_id])).rows[0];if(!g)throw new HiggsfieldImageError('IMAGE_REPLACEMENT_ALLOWANCE_REQUIRED');return g;}
 async step(scope:JobScope):Promise<string>{
  try{
   const state:any=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='creative.generate')throw new Error('JOB_KIND_DENIED');
    const r=(await db.query('SELECT * FROM app.creative_requests WHERE job_id=$1',[j.id])).rows[0];if(r?.image_provider!=='higgsfield')throw new Error('JOB_KIND_DENIED');
    if(terminal.has(j.status))return {done:j.status};
    const op=(await db.query('SELECT * FROM app.higgsfield_image_operations WHERE job_id=$1',[j.id])).rows[0];
    if(op?.phase==='submitting')return {done:await this.finish(db,j,'unknown','HIGGSFIELD_SUBMISSION_UNKNOWN')};
    const allowed=await this.jobs.permitted(db,j);
    if(!op){
     if(!allowed)return {done:await this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED')};
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`higgsfield-image-budget:${j.brand_id}`]);
     const g=await this.grant(db,j);
     const p=(await db.query('SELECT v.*,m.width,m.height,p.latest_version_id,p.archived_at FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1',[r.parent_version_id])).rows[0];
     if(!p||p.latest_version_id!==p.id||p.archived_at)return {done:await this.finish(db,j,'rejected','CREATIVE_VERSION_CHANGED')};
     const aspect=r.creative_spec?.aspect==='vertical'?'9:16':p.width===p.height?'1:1':p.width>p.height?'3:2':'2:3';
     const intent:StillIntent={model:HIGGSFIELD_IMAGE_MODEL,idempotencyKey:j.id,prompt:'Generate only a photographic background for an editable marketing design. No text, logos, watermark or collage. Do not depict invented buildings as actual business properties. User visual direction: '+r.prompt,aspect};
     const prepared=this.provider.prepare(intent),cap=Number(r.max_cost_micros),used=Number((await db.query("SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.creative_calls WHERE provider='higgsfield'",[])).rows[0].n);
     if(!Number.isSafeInteger(cap)||cap<1||cap!==Number(g.max_request_micros)||exceedsAllowance(used+cap,g.budget_micros))return {done:await this.finish(db,j,'rejected','IMAGE_REPLACEMENT_BUDGET_EXHAUSTED')};
     // Shares the account monthly budget trigger. Reserve before any external request.
     await db.query("INSERT INTO app.creative_calls(job_id,organization_id,brand_id,step,provider,model,input_sha256,reserved_micros,status) VALUES($1,$2,$3,'image','higgsfield',$4,$5,$6,'submitted')",[j.id,j.organization_id,j.brand_id,intent.model,prepared.sha256,cap]);
     await db.query('INSERT INTO app.higgsfield_image_operations(job_id,organization_id,brand_id,intent_sha256,encrypted_intent) VALUES($1,$2,$3,$4,$5)',[j.id,j.organization_id,j.brand_id,prepared.sha256,this.vault.seal(scope,'intent',intent)]);
     await db.query("UPDATE app.jobs SET status='running',updated_at=now() WHERE id=$1",[j.id]);
     return {prepared:true};
    }
    if(new Date(op.deadline_at).getTime()<=Date.now())return {done:await this.finish(db,j,'unknown','HIGGSFIELD_DEADLINE_EXCEEDED')};
    if(op.phase==='prepared'){
     if(!allowed)return {done:await this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED')};
     const g=await this.grant(db,j);if(Number(g.max_request_micros)!==Number(r.max_cost_micros))return {done:await this.finish(db,j,'rejected','IMAGE_REPLACEMENT_BUDGET_CHANGED')};
     return {estimate:this.vault.open(scope,'intent',op.encrypted_intent),cap:Number(r.max_cost_micros),sha:op.intent_sha256};
    }
    if(!allowed&&op.remote_request_id&&!op.cancel_attempted){await db.query('UPDATE app.higgsfield_image_operations SET cancel_attempted=true WHERE job_id=$1',[j.id]);return {cancel:op.remote_request_id};}
    if(op.phase==='completed')return allowed?{save:op,request:r}:{done:await this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED')};
    return {poll:op.remote_request_id};
   });
   if(state.done)return state.done;
   if(state.prepared)return 'waiting';
   if(state.cancel){try{await this.provider.cancel(state.cancel);}catch{}return 'waiting';}
   if(state.estimate){
    const price=await this.provider.estimate(state.estimate);
    const submit=await this.jobs.transaction(scope,async(db,j)=>{
     const op=(await db.query('SELECT phase FROM app.higgsfield_image_operations WHERE job_id=$1',[j.id])).rows[0];
     if(terminal.has(j.status)||op.phase!=='prepared')return false;
     if(!await this.jobs.permitted(db,j)){await this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED');return false;}
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`higgsfield-image-budget:${j.brand_id}`]);
     const g=await this.grant(db,j),reserved=Number((await db.query("SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.creative_calls WHERE provider='higgsfield'")).rows[0].n);
     if(exceedsAllowance(reserved,g.budget_micros)){await this.finish(db,j,'rejected','IMAGE_REPLACEMENT_BUDGET_CHANGED');return false;}
     if(price>state.cap||Number(g.max_request_micros)!==state.cap){await this.finish(db,j,'rejected','IMAGE_REPLACEMENT_ESTIMATE_EXCEEDS_CAP');return false;}
     await db.query("UPDATE app.higgsfield_image_operations SET phase='submitting' WHERE job_id=$1",[j.id]);return true;
    });
    if(!submit)return 'waiting';
    const receipt=await this.provider.submit(state.estimate,state.sha);
    await this.jobs.transaction(scope,async(db,j)=>{await db.query("UPDATE app.higgsfield_image_operations SET phase='submitted',remote_request_id=$2 WHERE job_id=$1 AND phase='submitting'",[j.id,receipt.requestId]);});return 'waiting';
   }
   if(state.poll){
    const observation=await this.provider.status(state.poll);
    return this.jobs.transaction(scope,async(db,j)=>{
     if(terminal.has(j.status))return j.status;
     if(observation.state==='completed'){
      await db.query("UPDATE app.higgsfield_image_operations SET phase='completed',encrypted_output=$2 WHERE job_id=$1",[j.id,this.vault.seal(scope,'output',observation)]);return 'waiting';
     }
     if(['failed','nsfw','canceled'].includes(observation.state))return this.finish(db,j,observation.state==='canceled'?'canceled':'rejected',observation.errorCode);
     return 'waiting';
    });
   }
   if(state.save)return await this.save(scope,state.request,state.save);
   throw new HiggsfieldImageError('HIGGSFIELD_STATE_INVALID');
  }catch(error){
   if(monthlyBudgetExceeded(error))error=new HiggsfieldImageError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
   if(error instanceof HiggsfieldImageError){return this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;
    const op=(await db.query('SELECT phase FROM app.higgsfield_image_operations WHERE job_id=$1',[j.id])).rows[0];
    // Failed polls are retryable; an ambiguous paid submit is never repeated.
    if(op?.phase==='submitted'&&error.outcome==='not_sent')return 'waiting';
    const status=error.outcome==='unknown'&&op?.phase==='submitting'?'unknown':'rejected';
    await db.query('UPDATE app.creative_calls SET status=$2 WHERE job_id=$1 AND step=\'image\'',[j.id,status]);return this.finish(db,j,status,error.code);
   });}
   throw error;
  }
 }
 private async save(scope:JobScope,r:any,op:any){
  // URL exists only in authenticated encrypted provider output, never caller input.
  const output=this.vault.open(scope,'output',op.encrypted_output) as any;
  const url=websiteURL(output.imageURL,true);if(url.protocol!=='https:'||url.hash)throw new HiggsfieldImageError('HIGGSFIELD_OUTPUT_INVALID');
  const download=await this.jobs.transaction(scope,async(db,j)=>{
   if(terminal.has(j.status))return j.status;
   if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED');
   const reserved=await db.query("UPDATE app.higgsfield_image_operations SET download_attempts=download_attempts+1 WHERE job_id=$1 AND phase='completed' AND download_attempts<3 RETURNING job_id",[j.id]);
   return reserved.rowCount?'download':this.finish(db,j,'unknown','HIGGSFIELD_DOWNLOAD_RECONCILIATION_REQUIRED');
  });
  if(download!=='download')return download;
  const response=await this.web.fetch(url,20*1024*1024,'image/png,image/jpeg,image/webp');
  if(response.status!==200||!/^image\/(png|jpeg|webp)(?:;|$)/i.test(String(response.headers['content-type'])))throw new HiggsfieldImageError('HIGGSFIELD_OUTPUT_INVALID');
  const parent=await this.jobs.transaction(scope,async(db,j)=>{if(!await this.jobs.permitted(db,j))throw new HiggsfieldImageError('ACCESS_REVOKED_OR_CANCELED');return (await db.query('SELECT v.*,m.width,m.height FROM app.creative_versions v JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1',[r.parent_version_id])).rows[0];});
  const meta=await sharp(response.bytes,{limitInputPixels:24_000_000}).metadata();if(!meta.width||!meta.height||meta.pages&&meta.pages>1)throw new HiggsfieldImageError('HIGGSFIELD_OUTPUT_INVALID');
  const bytes=await sharp(response.bytes,{limitInputPixels:24_000_000}).resize(parent.width,parent.height,{fit:'contain',background:'#ffffff'}).png().toBuffer(),sha=digest(bytes),key=`creative/${scope.organizationId}/${scope.brandId}/${scope.jobId}/${sha}`;
  if(bytes.length>20*1024*1024)throw new HiggsfieldImageError('HIGGSFIELD_OUTPUT_INVALID');
  await this.jobs.store.persist(key,bytes,'image/png',sha);
  return this.jobs.transaction(scope,async(db,j)=>{
   if(terminal.has(j.status))return j.status;
   if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','ACCESS_REVOKED_OR_CANCELED');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
   const p=(await db.query('SELECT latest_version_id,archived_at FROM app.creative_projects WHERE id=$1 FOR UPDATE',[r.project_id])).rows[0];
   if(p.archived_at||p.latest_version_id!==parent.id)return this.finish(db,j,'rejected','CREATIVE_VERSION_CHANGED');
   if(Number((await db.query('SELECT COALESCE(sum(bytes),0) AS n FROM app.creative_media')).rows[0].n)+bytes.length>512*1024*1024)return this.finish(db,j,'rejected','CREATIVE_STORAGE_LIMIT');
   const media=randomUUID(),id=randomUUID(),design=validateDesign({...parent.design,background_media_id:media},media,parent.width,parent.height),versionHash=hash(canonicalJSON({design,caption:parent.caption,brain_id:parent.brain_id}));
   await db.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[media,j.organization_id,j.brand_id,j.id,key,sha,bytes.length,parent.width,parent.height]);
   const manifest={...parent.skill_manifest,replacement:{provider:'higgsfield',model:HIGGSFIELD_IMAGE_MODEL,kind:'generated_image',request_id:output.requestId,source_sha256:digest(response.bytes),framing:'contain',parent_version_id:parent.id}};
   await db.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,parent_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,j.organization_id,j.brand_id,r.project_id,parent.id,parent.brain_id,j.id,media,JSON.stringify(design),parent.caption,JSON.stringify(manifest),versionHash,j.requested_by]);
   await db.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[r.project_id,id]);await db.query('UPDATE app.creative_requests SET output_version_id=$2 WHERE job_id=$1',[j.id,id]);
   await db.query("UPDATE app.creative_calls SET status='succeeded',result=$2 WHERE job_id=$1 AND step='image'",[j.id,JSON.stringify({media_id:media,sha256:sha,request_id:output.requestId})]);
   await db.query("UPDATE app.higgsfield_image_operations SET phase='saved' WHERE job_id=$1",[j.id]);return this.finish(db,j,'succeeded');
  });
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,async(db,j)=>{if(terminal.has(j.status))return j.status;return this.finish(db,j,'unknown','HIGGSFIELD_REPLACEMENT_RECONCILIATION_REQUIRED');});}
}
