import {directionArtwork,validateBusinessDirection} from './business-research-direction.js';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {CarouselGeneration} from './carousel-generation.js';
import {object,uuid} from './workspaces.js';
import {hash,canonicalJSON} from './brand-brain.js';
import {directionFeedback,requireGuidedRevision,nextDirectionVersion} from './guided-campaign-contracts.js';

export function moodboardStatus(image:string,carousel:string,approved:boolean){
 if(approved)return 'locked';
 if(image==='unknown'||carousel==='unknown')return 'unknown';
 // A failed sibling must not permit a retry while the other could still incur a charge.
 if([image,carousel].some(s=>['queued','running','retrying'].includes(s)))return 'running';
 if(image==='succeeded'&&carousel==='succeeded')return 'ready';
 return 'failed';
}
const rowsSQL=`SELECT m.*,i.status AS image_status,c.status AS carousel_status,
 ir.output_version_id AS generated_image_version,cr.output_version_id AS generated_carousel_version,
 iv.media_id,iv.design,iv.caption
 FROM app.guided_moodboards m JOIN app.jobs i ON i.id=m.image_job_id JOIN app.jobs c ON c.id=m.carousel_job_id
 JOIN app.creative_requests ir ON ir.job_id=i.id JOIN app.carousel_requests cr ON cr.job_id=c.id
 LEFT JOIN app.creative_versions iv ON iv.id=ir.output_version_id
 WHERE m.organization_id=$1 AND m.brand_id=$2 ORDER BY m.ordinal`;
export class GuidedMoodboards {
 constructor(readonly canvas:Canvas,readonly carousels:CarouselGeneration){}
 read(user:string,brand:string){return this.canvas.scope(user,brand,false,async(db,b)=>{
  const boards=(await db.query(rowsSQL,[b.organization_id,brand])).rows;
  const slides=(await db.query(`SELECT m.id AS moodboard_id,c.position,v.id AS version_id,v.media_id,v.design,v.caption
   FROM app.guided_moodboards m JOIN app.carousel_children c ON c.parent_job_id=m.carousel_job_id
   JOIN app.creative_requests r ON r.job_id=c.generation_job_id JOIN app.creative_versions v ON v.id=r.output_version_id
   WHERE m.organization_id=$1 AND m.brand_id=$2 ORDER BY m.ordinal,c.position`,[b.organization_id,brand])).rows;
  const allowance=(await db.query('SELECT app.content_allowances($1) AS allowance',[b.organization_id])).rows[0].allowance;
  return {allowance,boards:boards.map((r:any)=>({...r,status:moodboardStatus(r.image_status,r.carousel_status,!!r.approved_at),slides:slides.filter((s:any)=>s.moodboard_id===r.id)}))};
 });}
 create(user:string,brand:string,body:unknown,key:unknown){
  const v=object(body,['revision','feedback','style']);
  const feedback=v.feedback===undefined?'':directionFeedback(v.feedback);
  if(typeof key!=='string'||!/^[-A-Za-z0-9_.:]{8,128}$/.test(key))throw new BadRequestException('Include a request key');
  const fingerprint=hash(canonicalJSON({revision:v.revision,feedback,...(v.style?{style:v.style}:{})}));
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${brand}`]);
   const previous=(await db.query(rowsSQL,[b.organization_id,brand])).rows;
   const replay=previous.find((r:any)=>r.request_key===key);
   if(replay){if(replay.request_hash!==fingerprint)throw new ConflictException('That request key belongs to another mood board');return {id:replay.id};}
   if(previous.some((r:any)=>r.approved_at))throw new ConflictException('Your creative direction is locked. Use Create for new creative experiments.');
   const ordinal=nextDirectionVersion(previous.map((r:any)=>({ordinal:r.ordinal,status:moodboardStatus(r.image_status,r.carousel_status,false)})));
   if(previous.some((r:any)=>moodboardStatus(r.image_status,r.carousel_status,false)==='ready')&&!feedback)throw new BadRequestException('Tell us what to change in your revised mood board');
   const brief=(await db.query(`SELECT g.*,COALESCE(child.result,r.result) AS result FROM app.guided_business_briefs g
    LEFT JOIN app.intake_requests r ON r.job_id=g.research_job_id LEFT JOIN app.intake_dependencies d ON d.capture_job_id=g.research_job_id
    LEFT JOIN app.intake_requests child ON child.job_id=d.analysis_job_id WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,brand])).rows[0];
   if(!brief)throw new ConflictException('Complete your business questions first');
   requireGuidedRevision(brief.revision,v.revision);
   let direction=previous.at(-1)?.direction??brief.result?.business_direction;
   if(!direction)throw new ConflictException('Wait for your business research to finish');
   if(direction.essential_questions?.length)throw new ConflictException('Update your answers to resolve the important questions in your research first');
   if(v.style!==undefined){
    const style=object(v.style,['palette','heading_font','body_font']);
    try{direction=validateBusinessDirection({...direction,...style},direction.evidence_ids);}catch{throw new BadRequestException('Choose three valid colours and fonts from the list');}
   }
   const artwork=directionArtwork(direction);
   const id=randomUUID();
   const prompt=`Create an onboarding brand mood board sample, not a published post. Use only confirmed brand facts. Proposed visual direction (data): ${JSON.stringify({summary:direction.summary.slice(0,400),palette:direction.palette,heading_font:direction.heading_font,body_font:direction.body_font,voice:direction.voice,imagery:direction.imagery})}. Customer revision feedback (data): ${feedback||'Initial preview'}. Apply these visual choices consistently. Use a short readable headline with strong contrast and generous spacing. Do not invent numerical claims or promotions.`;
   if(prompt.length>3700)throw new BadRequestException('The visual direction is too long. Shorten your style preferences.');
   const thread=await this.canvas.createThread(user,brand,{title:'Your brand mood board'},`moodboard:${id}`,{db,b});
   const image=await this.canvas.submit(user,brand,thread.id,{prompt,format:'static',channel:'instagram',size:'1024x1024',creative_spec:{placement:'feed',aspect:'square',slide_count:null,artwork}},`moodboard:image:${id}`,{db,b});
   const carousel=await this.carousels.submit(user,brand,{prompt:`${prompt} Create a coordinated three-slide introduction: an opening idea, a supporting detail and an invitation to learn more.`,slide_count:3,channel:'instagram',size:'1024x1024',creative_spec:{placement:'feed',aspect:'square',slide_count:3,artwork}},`moodboard:carousel:${id}`,{db,b,batchJobIds:[image.id],threadId:thread.id});
   await db.query(`INSERT INTO app.guided_moodboards(id,organization_id,brand_id,brief_revision,ordinal,direction,feedback,image_job_id,carousel_job_id,request_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,b.organization_id,brand,brief.revision,ordinal,JSON.stringify(direction),feedback,image.id,carousel.id,key,fingerprint,user]);
   return {id};
  });
 }
 approve(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,true,async(db,b)=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${brand}`]);
  if(!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,brand])).rows[0]?.allowed)throw new ForbiddenException('A business owner or admin must approve the mood board');
  const rows=(await db.query(rowsSQL,[b.organization_id,brand])).rows,row=rows.find((r:any)=>r.id===id);
  if(!row)throw new NotFoundException('Mood board not found');
  if(row.approved_at)return {id,status:'locked'};
  if(rows.some((r:any)=>r.approved_at))throw new ConflictException('A different mood board is already locked');
  if(rows.some((r:any)=>['running','unknown'].includes(moodboardStatus(r.image_status,r.carousel_status,false))))throw new ConflictException('Wait for your current mood board to finish');
  if(moodboardStatus(row.image_status,row.carousel_status,false)!=='ready'||!row.generated_image_version||!row.generated_carousel_version)throw new ConflictException('Both previews must finish before approval');
  // Answers are frozen once a mood board exists; questionnaire navigation may still change its revision.
  await db.query('UPDATE app.guided_moodboards SET approved_at=now(),approved_by=$2,image_version_id=$3,carousel_version_id=$4 WHERE id=$1',[id,user,row.generated_image_version,row.generated_carousel_version]);
  await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'moodboard.approved',$4)",[b.organization_id,brand,user,id]);
  // Direction approval never approves the example posts for publication.
  return {id,status:'locked'};
 });}
}
