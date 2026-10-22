import {validateVideoBrief,type VideoPlanningInput} from './video-planning.js';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {VideoReferenceBindings} from './video-references.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
export class VideoCanvas {
 constructor(readonly canvas:Canvas,readonly references:VideoReferenceBindings,readonly enabled=false){}
 submit(user:string,brand:string,threadId:string,body:unknown,requestKey:unknown){
  if(!this.enabled||!this.references.image)throw new ConflictException('Video generation is not configured');
  threadId=uuid(threadId);const v=object(body,['prompt','channel','duration_seconds','reference','parent_version_id']);
  if(typeof requestKey!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(requestKey)||typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.prompt)||!['instagram','linkedin'].includes(String(v.channel))||!Number.isInteger(v.duration_seconds)||Number(v.duration_seconds)<3||Number(v.duration_seconds)>15)throw new BadRequestException('Choose a video brief, channel and duration from 3 to 15 seconds');
  const prompt=v.prompt.trim();
  const fingerprint=hash(canonicalJSON({threadId,...v}));
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${b.organization_id}`]);
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
   const prior=(await db.query('SELECT r.request_hash,j.id,j.status FROM app.video_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3',[b.organization_id,brand,requestKey])).rows[0];
   if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('That request key belongs to a different video');return {id:prior.id,status:prior.status};}
   if(!(await db.query('SELECT id FROM app.canvas_threads WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[threadId,b.organization_id,brand])).rowCount)throw new NotFoundException('Conversation not found');
   if((await db.query("SELECT id FROM app.jobs WHERE brand_id=$1 AND kind='creative.video' AND status IN ('queued','running','retrying','unknown')",[brand])).rowCount)throw new ConflictException('A video request is running or needs reconciliation');
   if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.video' AND created_at>now()-interval '1 day'",[brand])).rows[0].n>=10)throw new ConflictException('Daily video limit reached');
   const used=Number((await db.query('SELECT (SELECT COALESCE(sum(bytes),0) FROM app.video_bases)+(SELECT COALESCE(sum(bytes+poster_bytes),0) FROM app.video_versions) AS n')).rows[0].n);
   if(used+130*1024*1024>512*1024*1024)throw new ConflictException('Video storage limit reached');
   const brain=(await db.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1 ORDER BY approved_at DESC,id LIMIT 1',[brand])).rows[0];
   if(!brain)throw new ConflictException('Confirm your brand profile before creating a video');
   let project=randomUUID();
   if(v.parent_version_id){const parent=(await db.query('SELECT v.id,v.project_id,p.latest_version_id,p.thread_id FROM app.video_versions v JOIN app.video_projects p ON p.id=v.project_id WHERE v.id=$1',[uuid(String(v.parent_version_id))])).rows[0];if(!parent||parent.latest_version_id!==parent.id||parent.thread_id!==threadId)throw new ConflictException('Revise the latest video in its original conversation');project=parent.project_id;}
   const job=randomUUID();
   await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'creative.video')",[job,b.organization_id,brand,user]);
   await this.references.bind(user,brand,job,v.reference,{db,b});
   if(!v.parent_version_id)await db.query('INSERT INTO app.video_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[project,b.organization_id,brand,threadId,prompt.slice(0,140),user]);
   await db.query('INSERT INTO app.video_requests(job_id,organization_id,brand_id,project_id,brain_id,prompt,channel,duration_seconds,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[job,b.organization_id,brand,project,brain.id,prompt,v.channel,v.duration_seconds,requestKey,fingerprint]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'creative.video')",[job,b.organization_id,brand]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'video.requested',$4)",[b.organization_id,brand,user,job]);
   return {id:job,status:'queued'};
  });
 }
 list(user:string,brand:string){return this.canvas.scope(user,brand,false,async(db)=>({configured:this.enabled,versions:(await db.query('SELECT id,project_id,status,created_at FROM app.video_versions ORDER BY created_at DESC LIMIT 300')).rows,projects:(await db.query('SELECT id,title,thread_id,latest_version_id,created_at FROM app.video_projects ORDER BY created_at DESC LIMIT 100')).rows,runs:(await db.query('SELECT j.id,j.status,j.error_code,r.project_id,r.output_version_id,r.duration_seconds,j.cancel_requested,r.draft_revision,r.approved_revision,(r.plan IS NOT NULL AND r.approved_brief IS NULL) AS awaiting_approval FROM app.jobs j JOIN app.video_requests r ON r.job_id=j.id ORDER BY j.created_at DESC LIMIT 100')).rows}));}
 version(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,false,async(db)=>{const r=(await db.query('SELECT v.id,v.project_id,v.caption,v.overlays,v.manifest,v.status,v.review_revision,v.sha256,r.channel,b.width,b.height,b.duration_ms FROM app.video_versions v JOIN app.video_bases b ON b.job_id=v.job_id JOIN app.video_requests r ON r.job_id=v.job_id WHERE v.id=$1',[id])).rows[0];if(!r)throw new NotFoundException('Video not found');return {...r,reviews:(await db.query('SELECT decision,feedback,revision,created_at FROM app.video_reviews WHERE version_id=$1 ORDER BY revision',[id])).rows};});}
 cancel(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,true,async db=>{
  const row=(await db.query("SELECT id,status FROM app.jobs WHERE id=$1 AND kind='creative.video' FOR UPDATE",[id])).rows[0];if(!row)throw new NotFoundException('Video request not found');if(!['queued','running','retrying'].includes(row.status))throw new ConflictException('This video request has finished');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[id]);return {id,cancel_requested:true};
 });}
 async regenerate(user:string,brand:string,id:string,body:unknown,key:unknown){id=uuid(id);const v=object(body,['feedback']);
  if(typeof v.feedback!=='string'||!v.feedback.trim()||v.feedback.length>2000)throw new BadRequestException('Describe the changes for this video');
  const prior=await this.canvas.scope(user,brand,true,async db=>{
   const r=(await db.query('SELECT p.thread_id,r.channel,r.duration_seconds,r.approved_brief,x.export_id,x.approval_id,x.source_sha256,x.export_sha256 FROM app.video_versions v JOIN app.video_projects p ON p.id=v.project_id JOIN app.video_requests r ON r.job_id=v.job_id JOIN app.video_references x ON x.job_id=v.job_id WHERE v.id=$1',[id])).rows[0];if(!r)throw new NotFoundException('Video not found');return r;
  });
  return this.submit(user,brand,prior.thread_id,{parent_version_id:id,prompt:`Revise the saved video. Previous direction: ${prior.approved_brief.video_prompt.slice(0,1800)}\nRequested changes: ${v.feedback}`,channel:prior.channel,duration_seconds:prior.duration_seconds,reference:{export_id:prior.export_id,approval_id:prior.approval_id,source_sha256:prior.source_sha256,export_sha256:prior.export_sha256,confirmed:true}},key);
 }
 draft(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,false,async db=>{
  const row=(await db.query('SELECT r.job_id,r.prompt,r.channel,r.duration_seconds,j.cancel_requested,r.draft_revision,r.approved_revision,r.edited_brief,r.plan,j.status,j.error_code FROM app.video_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.job_id=$1',[id])).rows[0];
  if(!row)throw new NotFoundException('Video request not found');return {...row,brief:row.edited_brief??row.plan?.brief??null,plan:undefined};
 });}
 saveDraft(user:string,brand:string,id:string,body:unknown){id=uuid(id);const v=object(body,['brief','revision','approve']);
  if(!Number.isSafeInteger(v.revision)||typeof v.approve!=='boolean')throw new BadRequestException('Choose a saved video draft revision');
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   const job=(await db.query("SELECT * FROM app.jobs WHERE id=$1 AND kind='creative.video' FOR UPDATE",[id])).rows[0];
   if(!job)throw new NotFoundException('Video request not found');
   const r=(await db.query('SELECT * FROM app.video_requests WHERE job_id=$1 FOR UPDATE',[id])).rows[0];
   if(!r?.plan||r.draft_revision!==v.revision||!['queued','running','retrying'].includes(job.status)||job.cancel_requested||(await db.query('SELECT job_id FROM app.video_operations WHERE job_id=$1',[id])).rowCount)throw new ConflictException('Refresh the video draft; generation may already have started');
   if(v.approve&&!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can approve generation');
   const brain=(await db.query('SELECT * FROM app.brand_brain_versions WHERE id=$1',[r.brain_id])).rows[0];
   const ref=(await db.query('SELECT e.sha256,e.width,e.height FROM app.video_references r JOIN app.creative_exports e ON e.id=r.export_id WHERE r.job_id=$1',[id])).rows[0];
   const input:VideoPlanningInput={task:'video',brand:{id:brain.id,sha256:brain.sha256,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},prompt:r.prompt,channel:r.channel,duration_seconds:r.duration_seconds,reference:{kind:'image',sha256:ref.sha256,width:ref.width,height:ref.height,duration_seconds:null,caption:''}};
   try{validateVideoBrief(v.brief,input);}catch{throw new BadRequestException('Check the video prompt, script timing and text overlays');}
   const next=r.draft_revision+1;
   await db.query('UPDATE app.video_requests SET edited_brief=$2,draft_revision=$3,approved_brief=$4,approved_revision=$5,approved_by=$6,approved_at=$7 WHERE job_id=$1',[id,JSON.stringify(v.brief),next,v.approve?JSON.stringify(v.brief):null,v.approve?next:null,v.approve?user:null,v.approve?new Date():null]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)",[b.organization_id,brand,user,v.approve?'video.prompt_approved':'video.prompt_edited',id]);
   return {job_id:id,revision:next,approved:v.approve};
  });
 }
 download(user:string,brand:string,id:string,poster=false){id=uuid(id);return this.canvas.scope(user,brand,false,async db=>{
  const v=(await db.query('SELECT object_key,sha256,bytes,poster_key,poster_sha256,poster_bytes FROM app.video_versions WHERE id=$1',[id])).rows[0];
  if(!v)throw new NotFoundException('Video not found');
  return {url:await this.canvas.store.downloadURL(poster?v.poster_key:v.object_key,poster?'desvio-video.png':'desvio-video.mp4',poster?'image/png':'video/mp4'),sha256:poster?v.poster_sha256:v.sha256,bytes:poster?v.poster_bytes:v.bytes,expires_in:60};
 });}
 review(user:string,brand:string,id:string,body:unknown){id=uuid(id);const v=object(body,['decision','feedback','revision','sha256','confirmed']);
  if(!['in_review','approved','rejected','changes_requested'].includes(String(v.decision))||typeof v.feedback!=='string'||v.feedback.length>2000||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||v.decision==='approved'&&v.confirmed!==true)throw new BadRequestException('Review the saved video and confirm its exact version');
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
   const row=(await db.query('SELECT v.*,p.latest_version_id FROM app.video_versions v JOIN app.video_projects p ON p.id=v.project_id WHERE v.id=$1 FOR UPDATE OF v',[id])).rows[0];
   if(!row)throw new NotFoundException('Video not found');
   if(v.decision!=='in_review'&&!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can decide a review');
   if(row.latest_version_id!==id||row.review_revision!==v.revision||row.sha256!==v.sha256)throw new ConflictException('Review the latest saved video');
   if(v.decision==='in_review'?!['draft','changes_requested'].includes(row.status):row.status!=='in_review')throw new ConflictException('This video is not eligible for that review action');
   await db.query('UPDATE app.video_versions SET status=$2,review_revision=review_revision+1,reviewed_by=$3,reviewed_at=$4 WHERE id=$1',[id,v.decision,v.decision==='in_review'?null:user,v.decision==='in_review'?null:new Date()]);
   await db.query('INSERT INTO app.video_reviews(id,organization_id,brand_id,version_id,actor_id,decision,feedback,sha256,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),b.organization_id,brand,id,user,v.decision,v.feedback,v.sha256,Number(v.revision)+1]);
   return {id,status:v.decision,revision:Number(v.revision)+1};
  });
 }

}
