import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {Canvas} from './canvas.js';
import {AssetJobs,type JobScope} from './jobs.js';
import {digest,ObjectStore} from './object-store.js';
import {object,uuid} from './workspaces.js';
import {VideoStateError,VideoVault} from './video-vault.js';
const live=new Set(['queued','running','retrying']);
const proofSQL=`SELECT e.*,v.project_id,v.status,v.review_revision,v.sha256 AS version_sha256,v.reviewed_by,p.latest_version_id,a.id AS approval_id,a.context_revision,a.context_type,a.context_id
 FROM app.creative_exports e JOIN app.creative_versions v ON v.id=e.version_id JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_export_approvals a ON a.export_id=e.id
 WHERE e.id=$1 AND a.id=$2`;
const current=(p:any,image:string)=>p&&p.renderer_image===image&&p.status==='approved'&&p.reviewed_by&&p.latest_version_id===p.version_id&&p.source_sha256===p.version_sha256&&p.context_type==='canvas'&&p.context_id===p.version_id&&p.context_revision===p.review_revision;

/** Application-only consent binding: no worker database or provider secrets. */
export class VideoReferenceBindings {
 constructor(readonly canvas:Canvas|undefined,readonly image?:string){}
 bind(user:string,brand:string,jobId:string,body:unknown,scoped?:{db:any;b:any}){
  jobId=uuid(jobId);const v=object(body,['export_id','approval_id','source_sha256','export_sha256','confirmed']);
  const exportId=uuid(String(v.export_id)),approvalId=uuid(String(v.approval_id));
  if(v.confirmed!==true||![v.source_sha256,v.export_sha256].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))throw new BadRequestException('Confirm the exact approved image may be sent to the video provider');
  const action=async(db:any,b:any)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${b.organization_id}`]);
   const j=(await db.query("SELECT * FROM app.jobs WHERE id=$1 AND kind='creative.video' FOR UPDATE",[jobId])).rows[0];
   if(!j||j.requested_by!==user)throw new NotFoundException('Video request not found');
   if(j.status!=='queued'||j.cancel_requested)throw new ConflictException('This video request cannot accept a reference');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
   const p=(await db.query(proofSQL,[exportId,approvalId])).rows[0];
   if(!current(p,this.image??'')||p.sha256!==v.export_sha256||p.source_sha256!==v.source_sha256)throw new ConflictException('Approve the current saved image before using it as a video reference');
   const prior=(await db.query('SELECT * FROM app.video_references WHERE job_id=$1',[jobId])).rows[0];
   if(prior){if(prior.export_id!==exportId||prior.approval_id!==approvalId||prior.source_sha256!==v.source_sha256||prior.export_sha256!==v.export_sha256)throw new ConflictException('The video request already uses a different reference');return {job_id:jobId,export_id:exportId};}
   if((await db.query('SELECT job_id FROM app.video_operations WHERE job_id=$1',[jobId])).rowCount)throw new ConflictException('Provider preparation already started');
   await db.query('INSERT INTO app.video_references(job_id,organization_id,brand_id,export_id,approval_id,version_id,project_id,source_sha256,export_sha256,review_revision,consented_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[jobId,b.organization_id,brand,exportId,approvalId,p.version_id,p.project_id,p.source_sha256,p.sha256,p.review_revision,user]);
   return {job_id:jobId,export_id:exportId};
  };
  return scoped?action(scoped.db,scoped.b):this.canvas!.scope(user,brand,true,action);
 }
}

/** Internal parent-workflow component. No customer route or provider call here.
 * Explicit user consent binds an existing owned video job to exact approved
 * pixels. The lease URL stays encrypted in the worker ledger, never in model
 * context, application queries, logs, or customer response payloads. */
export class VideoReferences extends VideoReferenceBindings {
 #jobs:AssetJobs;#store:ObjectStore;#vault:VideoVault;#image:string;
 constructor(canvas:Canvas|undefined,jobs:AssetJobs,key:string,rendererImage:string,mode:'test'|'development'|'staging'){
  super(canvas,rendererImage);
  if(!/^sha256:[a-f0-9]{64}$/.test(rendererImage))throw new VideoStateError('REFERENCE_RENDERER_REQUIRED');
  const endpoint=new URL(jobs.store.config.endpoint);
  if(!['test','development','staging'].includes(mode)||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||endpoint.protocol!=='https:'&&!(mode==='test'&&endpoint.protocol==='http:'&&['127.0.0.1','[::1]'].includes(endpoint.hostname)))throw new VideoStateError('REFERENCE_STORAGE_ORIGIN_INVALID');
  this.#jobs=jobs;this.#store=jobs.store;this.#vault=new VideoVault(key);this.#image=rendererImage;
 }
 private transaction<T>(scope:JobScope,fn:(db:any,j:any)=>Promise<T>){return this.#jobs.transaction(scope,async(db,j)=>{
  if(j.kind!=='creative.video')throw new VideoStateError('VIDEO_JOB_KIND_DENIED');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);return fn(db,j);
 });}
 private async proof(db:any,j:any){
  if(!live.has(j.status)||!await this.#jobs.permitted(db,j))throw new VideoStateError('REFERENCE_ACCESS_REVOKED');
  const ref=(await db.query('SELECT * FROM app.video_references WHERE job_id=$1',[j.id])).rows[0];
  if(!ref)throw new VideoStateError('REFERENCE_CONSENT_REQUIRED');
  const p=(await db.query(proofSQL,[ref.export_id,ref.approval_id])).rows[0];
  if(!current(p,this.#image)||p.version_id!==ref.version_id||p.sha256!==ref.export_sha256||p.source_sha256!==ref.source_sha256||p.review_revision!==ref.review_revision)throw new VideoStateError('REFERENCE_APPROVAL_CHANGED');
  return p;
 }
 async verifyTransaction(db:any,j:any){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);return this.proof(db,j);}
 async verifySubmission(db:any,j:any){
  await this.verifyTransaction(db,j);
  const lease=(await db.query('SELECT state,expires_at FROM app.video_reference_leases WHERE job_id=$1',[j.id])).rows[0];
  if(lease?.state!=='active'||new Date(lease.expires_at).getTime()-Date.now()<6*3600*1000)throw new VideoStateError('REFERENCE_LEASE_TOO_OLD');
 }
 async verify(scope:JobScope){return this.transaction(scope,(db,j)=>this.proof(db,j));}
 async prepare(scope:JobScope){
  try{
   const prepared=await this.transaction(scope,async(db,j)=>{
    const p=await this.proof(db,j);
    let lease=(await db.query('SELECT * FROM app.video_reference_leases WHERE job_id=$1',[j.id])).rows[0];
    if(!lease){
     // Use the database transaction clock used by the lease RLS ceiling.
     const expires=new Date((await db.query("SELECT date_trunc('second',now())+interval '8 hours' AS expires")).rows[0].expires),key=`video-reference/${j.organization_id}/${j.brand_id}/${j.id}/${p.sha256}`;
     const url=await this.#store.referenceURL(key,expires);
     lease=(await db.query('INSERT INTO app.video_reference_leases(job_id,organization_id,brand_id,object_key,sha256,bytes,encrypted_url,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[j.id,j.organization_id,j.brand_id,key,p.sha256,p.bytes,this.#vault.seal(scope,'reference',{url}),expires])).rows[0];
    }
    if(!['prepared','active'].includes(lease.state))throw new VideoStateError('REFERENCE_LEASE_REVOKED');
    if(new Date(lease.expires_at).getTime()-Date.now()<6*3600*1000)throw new VideoStateError('REFERENCE_LEASE_TOO_OLD');
    return {lease,source:p};
   });
   const {lease,source}=prepared;
   // An active lease is never recreated if its copy disappeared: that could
   // resurrect a concurrently revoked bearer URL. Prepared leases may replay.
   const bytes=await this.#store.read(lease.state==='active'?lease.object_key:source.object_key);
   if(bytes.length!==lease.bytes||digest(bytes)!==lease.sha256)throw new VideoStateError('REFERENCE_MEDIA_INTEGRITY_FAILED');
   if(lease.state==='prepared')await this.#store.persist(lease.object_key,bytes,'image/png',lease.sha256);
   return await this.transaction(scope,async(db,j)=>{
    await this.proof(db,j);
    const r=(await db.query('SELECT * FROM app.video_reference_leases WHERE job_id=$1',[j.id])).rows[0];
    if(!['prepared','active'].includes(r.state))throw new VideoStateError('REFERENCE_LEASE_REVOKED');
    if(new Date(r.expires_at).getTime()-Date.now()<6*3600*1000)throw new VideoStateError('REFERENCE_LEASE_TOO_OLD');
    await db.query("UPDATE app.video_reference_leases SET state='active' WHERE job_id=$1",[j.id]);
    const secret=this.#vault.open(scope,'reference',r.encrypted_url) as {url:string};
    return {url:secret.url,expires_at:new Date(r.expires_at).toISOString(),sha256:r.sha256,bytes:r.bytes,width:source.width,height:source.height,kind:'image' as const};
   });
  }catch(error){
   if(error instanceof VideoStateError&&['REFERENCE_ACCESS_REVOKED','REFERENCE_APPROVAL_CHANGED','REFERENCE_LEASE_TOO_OLD','REFERENCE_LEASE_REVOKED','REFERENCE_MEDIA_INTEGRITY_FAILED','VIDEO_STATE_INVALID'].includes(error.code))await this.revoke(scope);
   throw error;
  }
 }
 async revoke(scope:JobScope){
  const row=await this.transaction(scope,async(db,j)=>{
   const r=(await db.query('SELECT object_key FROM app.video_reference_leases WHERE job_id=$1',[j.id])).rows[0];
   if(r)await db.query("UPDATE app.video_reference_leases SET state='revoking' WHERE job_id=$1",[j.id]);return r;
  });
  if(!row)return;
  // Only the dedicated copy is removed. The approved original remains intact.
  await this.#store.removeQuarantine(row.object_key);
  await this.transaction(scope,async(db,j)=>{await db.query("UPDATE app.video_reference_leases SET state='revoked' WHERE job_id=$1",[j.id]);});
 }
}
