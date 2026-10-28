import {ContentPlan} from './content-plan.js';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
export const publicationProofSQL=`SELECT DISTINCT e.*,s.id AS slot_id,s.revision AS slot_revision,s.planned_at,v.caption,s.channel,p.id AS project_id FROM app.content_slots s JOIN app.creative_versions v ON v.id=s.creative_version_id JOIN app.creative_projects p ON p.id=v.project_id
   JOIN app.creative_exports e ON e.version_id=v.id AND e.source_sha256=s.creative_sha256
   JOIN app.creative_export_approvals a ON a.export_id=e.id AND a.context_type='slot' AND a.context_id=s.id AND a.context_revision=s.revision
   WHERE s.state='approved' AND s.approved_by IS NOT NULL AND s.creative_sha256=v.sha256 AND p.latest_version_id=v.id AND e.renderer_image=$1 AND ((s.channel IN ('linkedin','facebook') AND e.format='png') OR (s.channel='instagram' AND e.format='instagram-jpeg'))`;
export class CreativeExports {
 constructor(readonly canvas:Canvas,readonly image?:string){}
 get configured(){return !!this.image&&/^sha256:[a-f0-9]{64}$/.test(this.image);}
 async lock(db:any,id:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);}
 list(user:string,id:string,versionId:string){versionId=uuid(versionId);return this.canvas.scope(user,id,false,async(db,b)=>{
  if(!(await db.query('SELECT id FROM app.creative_versions WHERE id=$1',[versionId])).rowCount)throw new NotFoundException('Creative version not found');
  const exports=(await db.query('SELECT id,version_id,source_sha256,renderer_image,format,sha256,bytes,width,height,manifest,created_at FROM app.creative_exports WHERE version_id=$1 ORDER BY created_at DESC',[versionId])).rows;
  const jobs=(await db.query('SELECT j.id,j.status,j.error_code,j.cancel_requested,r.renderer_image,r.format FROM app.creative_export_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.version_id=$1 ORDER BY j.created_at DESC LIMIT 20',[versionId])).rows;
  const approvals=(await db.query('SELECT a.* FROM app.creative_export_approvals a JOIN app.creative_exports e ON e.id=a.export_id WHERE e.version_id=$1 ORDER BY a.created_at DESC',[versionId])).rows;
  return {configured:this.configured,renderer_image:this.image??null,exports,jobs,approvals};
 });}
 submit(user:string,id:string,versionId:string,body:unknown,key:unknown){versionId=uuid(versionId);const v=object(body,['source_sha256','format']);const format=v.format??'png';if(!['png','instagram-jpeg'].includes(String(format)))throw new BadRequestException('Choose a supported image format');
  if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key)||typeof v.source_sha256!=='string'||! /^[a-f0-9]{64}$/.test(v.source_sha256))throw new BadRequestException('Include the saved version fingerprint and request key');
  if(!this.configured)throw new ConflictException('The final image renderer has not been configured');
  const requestHash=hash(canonicalJSON({user,versionId,sha:v.source_sha256,image:this.image,...(format==='png'?{}:{format})}));
  return this.canvas.scope(user,id,true,async(db,b)=>{await this.lock(db,id);
   const prior=(await db.query('SELECT j.id,j.status,r.request_hash FROM app.creative_export_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.request_key=$1',[key])).rows[0];if(prior){if(prior.request_hash!==requestHash)throw new ConflictException('That request key belongs to another export');return {id:prior.id,status:prior.status};}
   const version=(await db.query('SELECT v.*,p.latest_version_id FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id WHERE v.id=$1',[versionId])).rows[0];if(!version)throw new NotFoundException('Creative version not found');
   if(version.sha256!==v.source_sha256||version.latest_version_id!==versionId)throw new ConflictException('Open the latest saved creative before exporting');
   const ready=(await db.query('SELECT id FROM app.creative_exports WHERE version_id=$1 AND renderer_image=$2 AND format=$3',[versionId,this.image,format])).rows[0];if(ready)return {export_id:ready.id,status:'succeeded'};
   const active=(await db.query("SELECT j.id,j.status FROM app.creative_export_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.version_id=$1 AND r.renderer_image=$2 AND r.format=$3 AND j.status IN ('queued','running','retrying')",[versionId,this.image,format])).rows[0];if(active)return active;
   if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.export' AND created_at>now()-interval '1 day'",[id])).rows[0].n>=100)throw new ConflictException('Daily export limit reached');
   if(Number((await db.query(`SELECT COALESCE((SELECT sum(bytes) FROM app.creative_exports WHERE brand_id=$1),0)+(SELECT count(*)*20971520 FROM app.jobs WHERE brand_id=$1 AND kind='creative.export' AND status IN ('queued','running','retrying')) AS n`,[id])).rows[0].n)+20*1024*1024>512*1024*1024)throw new ConflictException('Export storage limit reached');
   const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'creative.export')",[job,b.organization_id,id,user]);
   await db.query('INSERT INTO app.creative_export_requests(job_id,organization_id,brand_id,version_id,source_sha256,renderer_image,request_key,request_hash,format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,b.organization_id,id,versionId,v.source_sha256,this.image,key,requestHash,format]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'creative.export')",[job,b.organization_id,id]);return {id:job,status:'queued'};
  });
 }
 download(user:string,id:string,exportId:string){exportId=uuid(exportId);return this.canvas.scope(user,id,false,async(db)=>{
  const e=(await db.query('SELECT object_key,sha256,bytes,format FROM app.creative_exports WHERE id=$1',[exportId])).rows[0];if(!e)throw new NotFoundException('Saved export not found');return {url:await this.canvas.store.downloadURL(e.object_key,e.format==='png'?'desvio-final.png':'desvio-instagram.jpg',e.format==='png'?'image/png':'image/jpeg'),sha256:e.sha256,bytes:e.bytes,expires_in:60};
 });}
 cancel(user:string,id:string,jobId:string){jobId=uuid(jobId);return this.canvas.scope(user,id,true,async(db)=>{const j=(await db.query("SELECT id,status FROM app.jobs WHERE id=$1 AND kind='creative.export'",[jobId])).rows[0];if(!j)throw new NotFoundException('Export request not found');if(!['queued','running','retrying'].includes(j.status))throw new ConflictException('This export request already finished');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[jobId]);return {id:jobId,cancel_requested:true};});}
 approve(user:string,id:string,exportId:string,body:unknown){exportId=uuid(exportId);const v=object(body,['sha256','source_sha256','context_type','context_id','context_revision','confirmed']);
  if(v.confirmed!==true||!['canvas','slot'].includes(String(v.context_type))||!Number.isSafeInteger(v.context_revision)||Number(v.context_revision)<1)throw new BadRequestException('Confirm the saved image and approval revision');const context=uuid(String(v.context_id));
  return this.canvas.scope(user,id,true,async(db,b)=>{await this.lock(db,id);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${id.toLowerCase()}`]);
   if(!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can approve a final image');
   const e=(await db.query('SELECT e.*,v.status,v.review_revision,p.latest_version_id FROM app.creative_exports e JOIN app.creative_versions v ON v.id=e.version_id JOIN app.creative_projects p ON p.id=v.project_id WHERE e.id=$1',[exportId])).rows[0];if(!e)throw new NotFoundException('Saved export not found');
   if(e.sha256!==v.sha256||e.source_sha256!==v.source_sha256||e.version_id!==e.latest_version_id||e.renderer_image!==this.image)throw new ConflictException('Review the current saved export before approving');
   const prior=(await db.query('SELECT id,context_revision FROM app.creative_export_approvals WHERE export_id=$1 AND actor_id=$2 AND context_type=$3 AND context_id=$4 AND context_revision IN ($5,$6) ORDER BY context_revision DESC',[exportId,user,v.context_type,context,v.context_revision,Number(v.context_revision)+1])).rows[0];
   let approvedRevision=Number(v.context_revision);
   if(v.context_type==='canvas'){
    if(context!==e.version_id)throw new ConflictException('Review the current creative version');
    if(e.status==='in_review'&&e.review_revision===v.context_revision){const approved=await this.canvas.review(user,id,e.version_id,{decision:'approved',feedback:'Approved exact final image',revision:v.context_revision},{db,b});approvedRevision=approved.revision;}
    else if(e.status==='approved'&&(e.review_revision===v.context_revision||prior?.context_revision===e.review_revision))approvedRevision=e.review_revision;
    else throw new ConflictException('Send the current creative for review before approving its final image');
   }else{
    const s=(await db.query('SELECT * FROM app.content_slots WHERE id=$1',[context])).rows[0];
    if(!s||s.creative_version_id!==e.version_id||s.creative_sha256!==e.source_sha256)throw new ConflictException('Review the current planned post');
    if(s.state==='pending_review'&&s.revision===v.context_revision){const approved=await new ContentPlan(this.canvas.businesses).decide(db,b,user,id,context,{revision:s.revision,creative_version_id:e.version_id,creative_sha256:e.source_sha256,decision:'approved',feedback:'Approved exact final image'});approvedRevision=approved.revision;}
    else if(s.state==='approved'&&(s.revision===v.context_revision||prior?.context_revision===s.revision))approvedRevision=s.revision;
    else throw new ConflictException('Send the current planned post for review before approving its final image');
   }
   if(prior?.context_revision===approvedRevision)return {id:prior.id};
   const approval=randomUUID();await db.query('INSERT INTO app.creative_export_approvals(id,organization_id,brand_id,export_id,actor_id,context_type,context_id,context_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[approval,b.organization_id,id,exportId,user,v.context_type,context,approvedRevision]);return {id:approval};
  },true);
 }
 // Publication must recheck this proof in its own locked transaction immediately
 // before submitting approved bytes. Historical approvals alone are insufficient.
 async publicationProof(db:any,slotId:string){
  const proof=(await db.query(publicationProofSQL+' AND s.id=$2 LIMIT 1',[this.image,slotId])).rows[0];
  if(!proof)throw new ConflictException('Review and approve the current post and final saved image before publishing');return proof;
 }

}
