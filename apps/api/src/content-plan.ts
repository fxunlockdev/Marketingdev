import {normalizeCreativeSpec,creativeDimensions,type CreativeSpec} from './campaign-formats.js';
import {carouselPages,currentCarousel,carouselFingerprint} from './carousels.js';
import {calendarExport} from './calendar-export.js';
import {validateVideoConcept} from './video-concept.js';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Businesses } from './businesses.js';
import { canonicalJSON, hash } from './brand-brain.js';
import { object, uuid } from './workspaces.js';

function spec(value:unknown,format:string,channel:string):CreativeSpec {try{return normalizeCreativeSpec(value,format,channel);}catch{throw new BadRequestException('Choose a compatible creative format');}}
const channels = ['linkedin','instagram','facebook'];
const states = ['content_needed','draft_ready','pending_review','approved','changes_requested','rejected','cancelled'];
function text(v:unknown,max:number,empty=false):string {
 if(typeof v!=='string'||(!empty&&!v.trim())||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw new BadRequestException('Check the plan text fields');
 return v.trim();
}
function revision(v:unknown):number {
 if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>=2147483647)throw new BadRequestException('Include the saved revision');
 return Number(v);
}
function date(v:unknown):string {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v||v<'2000-01-01'||v>'2100-12-01')throw new BadRequestException('Choose a valid calendar date');
 return v;
}
function zone(v:unknown):string {
 if(typeof v!=='string'||v.length>100||(!v.includes('/')&&v!=='UTC'))throw new BadRequestException('Choose an IANA timezone');
 try {return new Intl.DateTimeFormat('en',{timeZone:v}).resolvedOptions().timeZone;}catch {throw new BadRequestException('Choose an IANA timezone');}
}
function instant(v:unknown):string {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v)))throw new BadRequestException('Include the exact planned UTC time');
 const iso=new Date(v).toISOString();
 if(iso!==v&&iso.replace('.000Z','Z')!==v)throw new BadRequestException('Choose a valid planned time');
 return iso;
}
export function planTime(value:unknown,startsOn:string,timezone:string,days=30):string {
 const iso=instant(value),parts=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const local=`${part('year')}-${part('month')}-${part('day')}`;
 const end=new Date(Date.parse(startsOn)+days*86400000).toISOString().slice(0,10);
 if(local<startsOn||local>=end)throw new BadRequestException(`Planned time must fall within this plan’s ${days} local calendar days`);
 return iso;
}
type Business={organization_id:string};
export class ContentPlan {
 constructor(readonly businesses:Businesses,readonly rendererImage?:string){}
 async scope<T>(user:string,id:string,write:boolean,action:(db:PoolClient,b:Business)=>Promise<T>,reviewOnly=false) {
  const b=await this.businesses.resolve(user,id);
  return this.businesses.database.transaction(user,b.organization_id,write,async db=>{
   if(write){
    // Same order as Canvas promotion; serialize link/approval with version changes.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${id.toLowerCase()}`]);
   }
   return action(db,b);
  },id,reviewOnly);
 }
 async creative(db:PoolClient,org:string,brand:string,versionId:unknown,format?:string) {
  const vid=uuid(String(versionId));
  const v=(await db.query(`SELECT v.id,v.sha256,v.design,v.caption,v.skill_manifest,v.media_id,v.project_id,p.latest_version_id,p.thread_id,
    r.format AS source_format,r.channel AS source_channel FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id
    LEFT JOIN app.creative_requests r ON r.output_version_id=v.id
    WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.id=$3`,[org,brand,vid])).rows[0];
  if(!v)throw new NotFoundException('Creative version not found');
  if(v.latest_version_id!==v.id)throw new ConflictException('Use the latest creative version');
  // Current Canvas only produces static/ad images; historical manual versions inherit those pixels.
  if(format&&!['static','ad'].includes(format))throw new BadRequestException('Unsupported creative format');
  return v;
 }
 async video(db:PoolClient,org:string,brand:string,versionId:unknown,channel:string) {
  const v=(await db.query(`SELECT v.id,v.sha256,v.status,p.latest_version_id,r.channel,r.creative_spec FROM app.video_versions v
   JOIN app.video_projects p ON p.id=v.project_id JOIN app.video_requests r ON r.job_id=v.job_id
   WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.id=$3`,[org,brand,uuid(String(versionId))])).rows[0];
  if(!v)throw new NotFoundException('Video version not found');
  if(v.latest_version_id!==v.id)throw new ConflictException('Use the latest video version');
  if(v.channel!==channel)throw new BadRequestException('Choose the channel this video was created for');
  return v;
 }
 async carousel(db:PoolClient,org:string,brand:string,versionId:unknown,channel:string) {
  if(!this.rendererImage)throw new ConflictException('The final image renderer must be configured');
  const row=(await db.query('SELECT v.*,p.latest_version_id FROM app.carousel_versions v JOIN app.carousel_projects p ON p.id=v.project_id WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.id=$3',[org,brand,uuid(String(versionId))])).rows[0];
  if(!row)throw new NotFoundException('Carousel version not found');
  const pages=await carouselPages(db,row.id);
  if(row.latest_version_id!==row.id||!currentCarousel(pages,this.rendererImage)||carouselFingerprint(row,pages)!==row.sha256)throw new ConflictException('Use the latest carousel with current saved slides');
  if(row.channel!==channel)throw new BadRequestException('Choose the channel this carousel was created for');
  return {...row,pages};
 }
 async matchSpec(specification:CreativeSpec|null,creative:any,video:any,carousel:any){
  if(!specification)return;const dimensions=creativeDimensions(specification);
  if(creative&&(creative.design?.width!==dimensions.width||creative.design?.height!==dimensions.height))throw new ConflictException('Choose artwork matching this post’s dimensions');
  if(video&&canonicalJSON(video.creative_spec??null)!==canonicalJSON(specification))throw new ConflictException('Choose video generated for this placement and aspect');
  if(carousel&&(carousel.pages.length!==specification.slide_count||carousel.pages.some((p:any)=>p.width!==dimensions.width||p.height!==dimensions.height)))throw new ConflictException('Choose a carousel with matching slide count and dimensions');
 }
 async event(db:PoolClient,user:string,s:any,action:string,feedback='') {
  const snapshot={creative_spec:s.creative_spec??null,reference_ids:s.reference_ids??[],plan_id:s.plan_id,channel:s.channel,planned_at:s.planned_at,format:s.format,brief:s.brief,pillar:s.pillar,hook:s.hook,cta:s.cta,state:s.state,creative_version_id:s.creative_version_id,creative_sha256:s.creative_sha256,video_version_id:s.video_version_id,video_sha256:s.video_sha256,video_draft:s.video_draft,carousel_version_id:s.carousel_version_id,carousel_sha256:s.carousel_sha256};
  await db.query(`INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,creative_version_id,creative_sha256,feedback,snapshot,video_version_id,video_sha256,carousel_version_id,carousel_sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[randomUUID(),s.organization_id,s.brand_id,s.id,s.revision,action,user,s.creative_version_id,s.creative_sha256,feedback,JSON.stringify(snapshot),s.video_version_id??null,s.video_sha256??null,s.carousel_version_id??null,s.carousel_sha256??null]);
 }
 create(user:string,id:string,body:unknown,key:unknown) {
  const v=object(body,['title','objective','starts_on','timezone','slots']);
  const title=text(v.title,140),objective=text(v.objective,2000),starts=date(v.starts_on),timezone=zone(v.timezone);
  if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  if(!Array.isArray(v.slots)||v.slots.length<1||v.slots.length>120)throw new BadRequestException('A plan needs 1–120 content slots');
  const slots=v.slots.map(raw=>{
   const s=object(raw,['channel','planned_at','format','brief','pillar','hook','cta','creative_version_id','video_version_id','carousel_version_id','creative_spec']);
   if(!channels.includes(String(s.channel))||!['static','ad','video','carousel'].includes(String(s.format)))throw new BadRequestException('Choose a supported channel and format');
   if((s.creative_version_id!=null&&!['static','ad'].includes(String(s.format)))||(s.video_version_id!=null&&s.format!=='video')||(s.carousel_version_id!=null&&s.format!=='carousel'))throw new BadRequestException('Match the saved media to the post format');
   return {...(s.creative_spec==null?{}:{creative_spec:spec(s.creative_spec,String(s.format),String(s.channel))}),channel:String(s.channel),planned_at:planTime(s.planned_at,starts,timezone),format:String(s.format),brief:text(s.brief,4000),pillar:text(s.pillar??'',140,true),hook:text(s.hook??'',500,true),cta:text(s.cta??'',500,true),creative_version_id:s.creative_version_id==null?null:uuid(String(s.creative_version_id)),...(s.video_version_id==null?{}:{video_version_id:uuid(String(s.video_version_id))}),...(s.carousel_version_id==null?{}:{carousel_version_id:uuid(String(s.carousel_version_id))})};
  });
  const sha=hash(canonicalJSON({title,objective,starts,timezone,slots}));
  return this.scope(user,id,true,async(db,b)=>{
   const prior=(await db.query('SELECT id,request_hash FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND created_by=$3 AND request_key=$4',[b.organization_id,id,user,key])).rows[0];
   if(prior){if(prior.request_hash!==sha)throw new ConflictException('That request key belongs to different plan content');return {id:prior.id};}
   if((await db.query('SELECT count(*)::int AS n FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0].n>=36)throw new ConflictException('This business has reached its plan limit');
   const pid=randomUUID();
   await db.query('INSERT INTO app.content_plans(id,organization_id,brand_id,title,objective,starts_on,timezone,created_by,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[pid,b.organization_id,id,title,objective,starts,timezone,user,key,sha]);
   for(const s of slots){
    const creative=s.creative_version_id?await this.creative(db,b.organization_id,id,s.creative_version_id,s.format):null;
    const video=s.video_version_id?await this.video(db,b.organization_id,id,s.video_version_id,s.channel):null;
    const carousel=s.carousel_version_id?await this.carousel(db,b.organization_id,id,s.carousel_version_id,s.channel):null;
    await this.matchSpec(s.creative_spec??null,creative,video,carousel);
    const row=(await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,creative_version_id,creative_sha256,state,created_by,video_version_id,video_sha256,carousel_version_id,carousel_sha256,creative_spec)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[randomUUID(),b.organization_id,id,pid,s.channel,s.planned_at,s.format,s.brief,s.pillar,s.hook,s.cta,creative?.id??null,creative?.sha256??null,creative||video||carousel?'draft_ready':'content_needed',user,video?.id??null,video?.sha256??null,carousel?.id??null,carousel?.sha256??null,s.creative_spec?JSON.stringify(s.creative_spec):null])).rows[0];
    await this.event(db,user,row,'created');
   }
   return {id:pid};
  });
 }
 catalog(user:string,id:string){return this.scope(user,id,false,async(db,b)=>({plans:(await db.query('SELECT id,title,starts_on::text,timezone,duration_days FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 ORDER BY created_at DESC,id LIMIT 36',[b.organization_id,id])).rows}));}
 addPost(user:string,id:string,planId:string,body:unknown,key:unknown){
  planId=uuid(planId);const v=object(body,['format','brief','context','channel','planned_at','creative_spec','reference_ids']);
  const format=String(v.format),channel=String(v.channel),topic=text(v.brief,2000),context=v.context===undefined?'':text(v.context,1800,true);
  if(!['static','carousel','video'].includes(format)||!channels.includes(channel))throw new BadRequestException('Choose a supported post format and channel');
  const specification=spec(v.creative_spec,format,channel),brief=context?`${topic}\n\nAdditional creative direction: ${context}`:topic;
  if(!Array.isArray(v.reference_ids??[])||((v.reference_ids??[]) as unknown[]).length>3)throw new BadRequestException('Choose up to three references');
  const references=((v.reference_ids??[]) as unknown[]).map(r=>uuid(String(r)));
  if(new Set(references).size!==references.length)throw new BadRequestException('Choose each reference once');
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const sha=hash(canonicalJSON({planId,...v}));
  return this.scope(user,id,true,async(db,b)=>{
   const prior=(await db.query('SELECT id,request_hash FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND created_by=$3 AND request_key=$4',[b.organization_id,id,user,key])).rows[0];
   if(prior){if(prior.request_hash!==sha)throw new ConflictException('That request key belongs to another post');return {id:prior.id};}
   const plan=(await db.query('SELECT starts_on::text,timezone,duration_days FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,planId])).rows[0];
   if(!plan)throw new NotFoundException('Content plan not found');
   const when=planTime(v.planned_at,plan.starts_on,plan.timezone,plan.duration_days);
   if((await db.query('SELECT count(*)::int AS n FROM app.content_slots WHERE plan_id=$1',[planId])).rows[0].n>=120)throw new ConflictException('This campaign has reached its 120-post limit');
   if(references.length&&(await db.query('SELECT id FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[]) AND revoked_at IS NULL',[b.organization_id,id,references])).rowCount!==references.length)throw new ConflictException('A reference is no longer approved. Choose another image.');
   const row=(await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,creative_spec,reference_ids,state,created_by,request_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'','','',$9,$10,'content_needed',$11,$12,$13) RETURNING *`,[randomUUID(),b.organization_id,id,planId,channel,when,format,brief,JSON.stringify(specification),references,user,key,sha])).rows[0];
   await this.event(db,user,row,'created',context);return {id:row.id};
  });
 }
 addVideo(user:string,id:string,planId:string,body:unknown,key:unknown){
  planId=uuid(planId);const v=object(body,['video_version_id','planned_at','channel','brief']);
  const version=uuid(String(v.video_version_id)),brief=text(v.brief,4000);
  if(!channels.includes(String(v.channel)))throw new BadRequestException('Choose a supported channel');
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const sha=hash(canonicalJSON({planId,...v}));
  return this.scope(user,id,true,async(db,b)=>{
   const prior=(await db.query('SELECT id,request_hash FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND created_by=$3 AND request_key=$4',[b.organization_id,id,user,key])).rows[0];
   if(prior){if(prior.request_hash!==sha)throw new ConflictException('That request key belongs to another post');return {id:prior.id};}
   const plan=(await db.query('SELECT starts_on::text,timezone,duration_days FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,planId])).rows[0];
   if(!plan)throw new NotFoundException('Content plan not found');
   const when=planTime(v.planned_at,plan.starts_on,plan.timezone,plan.duration_days);
   if((await db.query('SELECT count(*)::int AS n FROM app.content_slots WHERE plan_id=$1',[planId])).rows[0].n>=120)throw new ConflictException('This plan has reached its 120-post limit');
   const video=await this.video(db,b.organization_id,id,version,String(v.channel));
   const row=(await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,video_version_id,video_sha256,state,created_by,request_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,'video',$7,'','','',$8,$9,'draft_ready',$10,$11,$12) RETURNING *`,[randomUUID(),b.organization_id,id,planId,v.channel,when,brief,video.id,video.sha256,user,key,sha])).rows[0];
   await this.event(db,user,row,'created');return {id:row.id};
  });
 }
 addCarousel(user:string,id:string,planId:string,body:unknown,key:unknown){
  planId=uuid(planId);const v=object(body,['carousel_version_id','planned_at','channel','brief']);
  const version=uuid(String(v.carousel_version_id)),brief=text(v.brief,4000);
  if(!channels.includes(String(v.channel)))throw new BadRequestException('Choose a supported channel');
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const sha=hash(canonicalJSON({planId,...v}));
  return this.scope(user,id,true,async(db,b)=>{
   const prior=(await db.query('SELECT id,request_hash FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND created_by=$3 AND request_key=$4',[b.organization_id,id,user,key])).rows[0];
   if(prior){if(prior.request_hash!==sha)throw new ConflictException('That request key belongs to another post');return {id:prior.id};}
   const plan=(await db.query('SELECT starts_on::text,timezone,duration_days FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,planId])).rows[0];
   if(!plan)throw new NotFoundException('Content plan not found');
   const when=planTime(v.planned_at,plan.starts_on,plan.timezone,plan.duration_days);
   if((await db.query('SELECT count(*)::int AS n FROM app.content_slots WHERE plan_id=$1',[planId])).rows[0].n>=120)throw new ConflictException('This plan has reached its 120-post limit');
   const carousel=await this.carousel(db,b.organization_id,id,version,String(v.channel));
   const row=(await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,carousel_version_id,carousel_sha256,state,created_by,request_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,'carousel',$7,'','','',$8,$9,'draft_ready',$10,$11,$12) RETURNING *`,[randomUUID(),b.organization_id,id,planId,v.channel,when,brief,carousel.id,carousel.sha256,user,key,sha])).rows[0];
   await this.event(db,user,row,'created');return {id:row.id};
  });
 }
 async export(user:string,id:string,query:unknown) {
  const q=object(query,['start','end','channel','state','plan_id','format']);
  const {format,...filters}=q;
  if(format!=='csv'&&format!=='ics')throw new BadRequestException('Choose CSV or calendar export');
  const result=await this.list(user,id,filters,false,true);
  if(result.has_more)throw new BadRequestException('Choose a smaller date range for export');
  const file=calendarExport(result.slots,format);
  return {...file,filename:`desvio-content-plan.${file.extension}`,count:result.slots.length};
 }
 list(user:string,id:string,query:unknown,inbox=false,exportAll=false) {
  const q=object(query,['start','end','channel','state','plan_id','page']);
  const start=instant(q.start),end=instant(q.end);
  if(Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>93*86400000)throw new BadRequestException('Choose a date range of at most 93 days');
  if(q.channel!==undefined&&!channels.includes(String(q.channel)))throw new BadRequestException('Unknown channel');
  if(q.state!==undefined&&!states.includes(String(q.state)))throw new BadRequestException('Unknown review state');
  const plan=q.plan_id===undefined?null:uuid(String(q.plan_id)),page=q.page===undefined?1:Number(q.page);
  if(!Number.isSafeInteger(page)||page<1||page>100)throw new BadRequestException('Invalid page');
  return this.scope(user,id,false,async(db,b)=>{
   const args=[b.organization_id,id,start,end,q.channel??null,q.state??null,plan];
   const where=`s.organization_id=$1 AND s.brand_id=$2 AND s.planned_at >= $3 AND s.planned_at < $4
    AND ($5::text IS NULL OR s.channel=$5) AND ($6::text IS NULL OR s.state=$6) AND ($7::uuid IS NULL OR s.plan_id=$7)
    ${inbox?"AND s.state NOT IN ('content_needed','draft_ready','cancelled')":q.state===undefined?"AND s.state<>'cancelled'":''}`;
   const rows=(await db.query(`SELECT s.*,p.title AS plan_title,p.timezone,p.objective,p.starts_on::text,
    COALESCE(v.caption,vv.caption,cv.caption) AS caption,v.design,v.media_id,v.skill_manifest,COALESCE(v.project_id,vv.project_id,cv.project_id) AS project_id,COALESCE(c.thread_id,vp.thread_id) AS thread_id,
    (CASE WHEN s.format='carousel' THEN cp.latest_version_id<>cv.id WHEN s.format='video' THEN vp.latest_version_id<>vv.id ELSE v.id IS NOT NULL AND c.latest_version_id<>v.id END) AS has_newer_version
    FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id
    LEFT JOIN app.creative_versions v ON v.id=s.creative_version_id LEFT JOIN app.creative_projects c ON c.id=v.project_id
    LEFT JOIN app.video_versions vv ON vv.id=s.video_version_id LEFT JOIN app.video_projects vp ON vp.id=vv.project_id
    LEFT JOIN app.carousel_versions cv ON cv.id=s.carousel_version_id LEFT JOIN app.carousel_projects cp ON cp.id=cv.project_id
    WHERE ${where} ORDER BY s.planned_at,s.id LIMIT $9 OFFSET $8`,[...args,exportAll?0:(page-1)*100,exportAll?10000:100])).rows;
   for(const row of rows)if(row.format==='carousel'&&row.carousel_version_id){try{await this.carousel(db,b.organization_id,id,row.carousel_version_id,row.channel);}catch(e){if(e instanceof ConflictException||e instanceof NotFoundException)row.has_newer_version=true;else throw e;}}
   const counts=(await db.query(`SELECT s.channel,s.state,count(*)::int AS count FROM app.content_slots s WHERE ${where} GROUP BY s.channel,s.state`,args)).rows;
   const total=counts.reduce((n,r)=>n+r.count,0);
   return {slots:rows,counts,total,page,has_more:(exportAll?10000:page*100)<total};
  });
 }
 archive(user:string,id:string,query:unknown) {
  const q=object(query,['page']),page=q.page===undefined?1:Number(q.page);
  if(!Number.isSafeInteger(page)||page<1||page>1000)throw new BadRequestException('Invalid page');
  return this.scope(user,id,false,async(db,b)=>{
   const rows=(await db.query(`WITH entries AS (
    SELECT 'archived'::text AS kind,s.id::text AS entry_id,s.id AS slot_id,s.revision,s.updated_at AS archived_at,to_jsonb(s) AS snapshot,
      s.creative_version_id,s.video_version_id,s.carousel_version_id,p.title AS plan_title
    FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id
    WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.state='cancelled'
    UNION ALL
    SELECT 'previous_version',e.id::text,e.slot_id,e.revision,e.created_at,e.snapshot,
      e.creative_version_id,e.video_version_id,e.carousel_version_id,p.title
    FROM (SELECT DISTINCT ON (slot_id,COALESCE(creative_version_id,video_version_id,carousel_version_id)) *
      FROM app.content_slot_events WHERE organization_id=$1 AND brand_id=$2
      AND COALESCE(creative_version_id,video_version_id,carousel_version_id) IS NOT NULL
      ORDER BY slot_id,COALESCE(creative_version_id,video_version_id,carousel_version_id),revision DESC) e
    JOIN app.content_slots s ON s.id=e.slot_id JOIN app.content_plans p ON p.id=s.plan_id
    WHERE s.organization_id=$1 AND s.brand_id=$2
      AND ROW(e.creative_version_id,e.video_version_id,e.carousel_version_id)
        IS DISTINCT FROM ROW(s.creative_version_id,s.video_version_id,s.carousel_version_id)
   ) SELECT e.*,v.design,COALESCE(v.caption,vv.caption,cv.caption) AS caption,
      COALESCE(v.project_id,vv.project_id,cv.project_id) AS project_id
    FROM entries e LEFT JOIN app.creative_versions v ON v.id=e.creative_version_id
    LEFT JOIN app.video_versions vv ON vv.id=e.video_version_id
    LEFT JOIN app.carousel_versions cv ON cv.id=e.carousel_version_id
    ORDER BY e.archived_at DESC,e.entry_id LIMIT 51 OFFSET $3`,[b.organization_id,id,(page-1)*50])).rows;
   return {entries:rows.slice(0,50).map(r=>({...r.snapshot,...r,snapshot:undefined,id:r.slot_id})),page,has_more:rows.length>50};
  });
 }
 restore(user:string,id:string,slotId:string,body:unknown) {
  slotId=uuid(slotId);const v=object(body,['revision']),rev=revision(v.revision);
  return this.scope(user,id,true,async(db,b)=>{
   const s=(await db.query('SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3 FOR UPDATE',[b.organization_id,id,slotId])).rows[0];
   if(!s)throw new NotFoundException('Content slot not found');
   if(s.revision!==rev||s.state!=='cancelled')throw new ConflictException('This archived post changed. Refresh before restoring');
   if((await db.query("SELECT 1 FROM app.publication_requests WHERE slot_id=$1 AND phase NOT IN ('rejected','canceled')",[slotId])).rowCount)throw new ConflictException('Resolve the existing publication before restoring this post');
   const state=s.creative_version_id||s.video_version_id||s.carousel_version_id?'draft_ready':'content_needed';
   const row=(await db.query('UPDATE app.content_slots SET state=$2,revision=revision+1,approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=$1 RETURNING *',[slotId,state])).rows[0];
   await this.event(db,user,row,'edited','Restored from archive as a draft');return row;
  });
 }
 history(user:string,id:string,slotId:string) {
  slotId=uuid(slotId);
  return this.scope(user,id,false,async(db,b)=>{
   if(!(await db.query('SELECT id FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,slotId])).rowCount)throw new NotFoundException('Content slot not found');
   return {events:(await db.query('SELECT revision,action,actor_id,creative_version_id,creative_sha256,video_version_id,video_sha256,carousel_version_id,carousel_sha256,feedback,snapshot,created_at FROM app.content_slot_events WHERE slot_id=$1 ORDER BY revision',[slotId])).rows};
  });
 }
 edit(user:string,id:string,slotId:string,body:unknown) {
  slotId=uuid(slotId);
  const v=object(body,['revision','planned_at','brief','pillar','hook','cta','creative_version_id','video_version_id','carousel_version_id','video_draft','reset_approval','reference_ids','creative_spec']);
  const rev=revision(v.revision);
  if(!['planned_at','brief','pillar','hook','cta','creative_version_id','video_version_id','carousel_version_id','video_draft','reference_ids','creative_spec'].some(k=>k in v))throw new BadRequestException('Include a content change');
  if(v.reset_approval!==undefined&&typeof v.reset_approval!=='boolean')throw new BadRequestException('Invalid approval confirmation');
  return this.scope(user,id,true,async(db,b)=>{
   const s=(await db.query('SELECT s.*,p.starts_on::text,p.timezone,p.duration_days FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.id=$3',[b.organization_id,id,slotId])).rows[0];
   if(!s)throw new NotFoundException('Content slot not found');
   if(s.revision!==rev)throw new ConflictException('This post changed. Reload before editing');
   if(s.state==='cancelled')throw new ConflictException('This content slot was cancelled');
   if(s.state==='approved'&&v.reset_approval!==true)throw new ConflictException('Confirm that editing this approved post requires a new review');
   if(('creative_version_id' in v&&!['static','ad'].includes(s.format))||('video_version_id' in v&&s.format!=='video')||('carousel_version_id' in v&&s.format!=='carousel'))throw new BadRequestException('Match the saved media to the post format');
   const specification='creative_spec' in v?spec(v.creative_spec,s.format,s.channel):s.creative_spec??null;
   const specChanged=canonicalJSON(specification)!==canonicalJSON(s.creative_spec??null);
   if(specChanged){s.creative_version_id=null;s.video_version_id=null;s.carousel_version_id=null;}
   let referenceIds=s.reference_ids??[];
   if('reference_ids' in v){
    if(!['static','carousel'].includes(s.format)||!Array.isArray(v.reference_ids)||v.reference_ids.length>3)throw new BadRequestException('Choose up to three references for an image post');
    referenceIds=v.reference_ids.map(r=>uuid(String(r)));
    if(new Set(referenceIds).size!==referenceIds.length)throw new BadRequestException('Choose each reference once');
    if(referenceIds.length&&(await db.query('SELECT id FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[]) AND revoked_at IS NULL',[b.organization_id,id,referenceIds])).rowCount!==referenceIds.length)throw new ConflictException('An image is unavailable or no longer approved. Choose another reference.');
   }
   let videoDraft=s.video_draft;
   if('video_draft' in v){if(s.format!=='video')throw new BadRequestException('Only video posts have scripts');try{videoDraft=validateVideoConcept(v.video_draft);}catch{throw new BadRequestException('Use a storyline, script, prompt and duration from 3 to 15 seconds');}}
   const when='planned_at' in v?planTime(v.planned_at,s.starts_on,s.timezone,s.duration_days):s.planned_at;
   const creative='creative_version_id' in v?(v.creative_version_id===null?null:await this.creative(db,b.organization_id,id,v.creative_version_id,s.format)):s.creative_version_id?await this.creative(db,b.organization_id,id,s.creative_version_id,s.format):null;
   const videoId='video_version_id' in v?v.video_version_id:s.video_version_id;
   const video=videoId?await this.video(db,b.organization_id,id,videoId,s.channel):null;
   const carouselId='carousel_version_id' in v?v.carousel_version_id:s.carousel_version_id;
   const carousel=carouselId?await this.carousel(db,b.organization_id,id,carouselId,s.channel):null;
   await this.matchSpec(specification,creative,video,carousel);
   const result=(await db.query(`UPDATE app.content_slots SET planned_at=$2,brief=$3,pillar=$4,hook=$5,cta=$6,creative_version_id=$7,creative_sha256=$8,state=$9,video_version_id=$10,video_sha256=$11,video_draft=$12,carousel_version_id=$13,carousel_sha256=$14,reference_ids=$15,creative_spec=$16,revision=revision+1,approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[slotId,when,'brief' in v?text(v.brief,4000):s.brief,'pillar' in v?text(v.pillar,140,true):s.pillar,'hook' in v?text(v.hook,500,true):s.hook,'cta' in v?text(v.cta,500,true):s.cta,creative?.id??null,creative?.sha256??null,creative||video||carousel?'draft_ready':'content_needed',video?.id??null,video?.sha256??null,videoDraft?JSON.stringify(videoDraft):null,carousel?.id??null,carousel?.sha256??null,referenceIds,specification?JSON.stringify(specification):null])).rows[0];
   await this.event(db,user,result,'edited');
   return result;
  });
 }
 review(user:string,id:string,slotId:string,body:unknown) {
  const v=object(body,['revision','creative_version_id','creative_sha256','video_version_id','video_sha256','carousel_version_id','carousel_sha256','decision','feedback']);
  return this.scope(user,id,true,(db,b)=>this.decide(db,b,user,id,uuid(slotId),v),['approved','changes_requested','rejected','reopen'].includes(String(v.decision)));
 }
 async decide(db:PoolClient,b:Business,user:string,id:string,slotId:string,v:Record<string,unknown>) {
  const rev=revision(v.revision),decision=String(v.decision),feedback=text(v.feedback??'',2000,true);
  if(!['pending_review','approved','changes_requested','rejected','cancelled','reopen'].includes(decision))throw new BadRequestException('Choose a review action');
  if(['changes_requested','rejected'].includes(decision)&&!feedback)throw new BadRequestException('Include feedback for the creator');
  const s=(await db.query('SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,slotId])).rows[0];
  if(!s)throw new NotFoundException('Content slot not found');
  if(s.revision!==rev||s.creative_version_id!==(v.creative_version_id??null)||s.creative_sha256!==(v.creative_sha256??null)||s.video_version_id!==(v.video_version_id??null)||s.video_sha256!==(v.video_sha256??null)||(s.carousel_version_id??null)!==(v.carousel_version_id??null)||(s.carousel_sha256??null)!==(v.carousel_sha256??null))throw new ConflictException('Review the current post and creative version');
  if(['approved','rejected','changes_requested','reopen'].includes(decision)&&!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can decide reviews');
  if(['reopen','cancelled'].includes(decision)&&(await db.query("SELECT 1 FROM app.publication_requests WHERE slot_id=$1 AND phase NOT IN ('rejected','canceled')",[slotId])).rowCount)throw new ConflictException('This post has an active or unresolved publication. Manage it in Publishing before changing its review or canceling the plan.');
  const allowed=decision==='reopen'?['approved','rejected','changes_requested'].includes(s.state):decision==='cancelled'?s.state!=='cancelled':decision==='pending_review'?['draft_ready','changes_requested'].includes(s.state):s.state==='pending_review';
  if(!allowed)throw new ConflictException('This post is not eligible for that review action');
  if(!['cancelled','reopen'].includes(decision)){
   if(s.format==='carousel'){const c=await this.carousel(db,b.organization_id,id,s.carousel_version_id,s.channel);if(decision==='approved'&&c.status!=='approved')throw new ConflictException('Review and approve every saved carousel slide first');}
   else if(s.format==='video'){await this.video(db,b.organization_id,id,s.video_version_id,s.channel);}
   else await this.creative(db,b.organization_id,id,s.creative_version_id,s.format);
  }
  const result=(await db.query('UPDATE app.content_slots SET state=$2,revision=revision+1,approved_by=$3,approved_at=$4,updated_at=now() WHERE id=$1 RETURNING *',[slotId,decision==='reopen'?'pending_review':decision,decision==='approved'?user:null,decision==='approved'?new Date():null])).rows[0];
  await this.event(db,user,result,decision==='reopen'?'review_reopened':decision,feedback);
  return result;
 }
 bulkSubmit(user:string,id:string,body:unknown) {
  const v=object(body,['items']);
  if(!Array.isArray(v.items)||!v.items.length||v.items.length>30)throw new BadRequestException('Select 1–30 saved drafts');
  const items=v.items.map(raw=>{const i=object(raw,['id','revision','creative_version_id','creative_sha256','video_version_id','video_sha256','carousel_version_id','carousel_sha256']);return {...i,id:uuid(String(i.id))};});
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new BadRequestException('Select each post once');
  return this.scope(user,id,true,async(db,b)=>{
   const slots=[];
   for(const i of items)slots.push(await this.decide(db,b,user,id,i.id,{...i,decision:'pending_review',feedback:''}));
   return {slots};
  });
 }
 bulkApprove(user:string,id:string,body:unknown) {
  const v=object(body,['confirmed','items']);
  if(v.confirmed!==true||!Array.isArray(v.items)||!v.items.length||v.items.length>30)throw new BadRequestException('Confirm approval of 1–30 selected versions');
  const items=v.items.map(raw=>{const i=object(raw,['id','revision','creative_version_id','creative_sha256','video_version_id','video_sha256','carousel_version_id','carousel_sha256']);return {...i,id:uuid(String(i.id))};});
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new BadRequestException('Select each post once');
  return this.scope(user,id,true,async(db,b)=>{
   const slots=[];
   for(const i of items)slots.push(await this.decide(db,b,user,id,i.id,{...i,decision:'approved',feedback:''}));
   return {slots};
  },true);
 }
}
