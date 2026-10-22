import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Businesses } from './businesses.js';
import { canonicalJSON, hash } from './brand-brain.js';
import { object, uuid } from './workspaces.js';

const channels = ['linkedin','instagram'];
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
export function planTime(value:unknown,startsOn:string,timezone:string):string {
 const iso=instant(value),parts=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const local=`${part('year')}-${part('month')}-${part('day')}`;
 const end=new Date(Date.parse(startsOn)+30*86400000).toISOString().slice(0,10);
 if(local<startsOn||local>=end)throw new BadRequestException('Planned time must fall within this plan’s 30 local calendar days');
 return iso;
}
type Business={organization_id:string};
export class ContentPlan {
 constructor(readonly businesses:Businesses){}
 async scope<T>(user:string,id:string,write:boolean,action:(db:PoolClient,b:Business)=>Promise<T>) {
  const b=await this.businesses.resolve(user,id);
  return this.businesses.database.transaction(user,b.organization_id,write,async db=>{
   if(write){
    // Same order as Canvas promotion; serialize link/approval with version changes.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`plan:${id.toLowerCase()}`]);
   }
   return action(db,b);
  },id);
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
 async event(db:PoolClient,user:string,s:any,action:string,feedback='') {
  const snapshot={plan_id:s.plan_id,channel:s.channel,planned_at:s.planned_at,format:s.format,brief:s.brief,pillar:s.pillar,hook:s.hook,cta:s.cta,state:s.state,creative_version_id:s.creative_version_id,creative_sha256:s.creative_sha256};
  await db.query(`INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,creative_version_id,creative_sha256,feedback,snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),s.organization_id,s.brand_id,s.id,s.revision,action,user,s.creative_version_id,s.creative_sha256,feedback,JSON.stringify(snapshot)]);
 }
 create(user:string,id:string,body:unknown,key:unknown) {
  const v=object(body,['title','objective','starts_on','timezone','slots']);
  const title=text(v.title,140),objective=text(v.objective,2000),starts=date(v.starts_on),timezone=zone(v.timezone);
  if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  if(!Array.isArray(v.slots)||v.slots.length<1||v.slots.length>120)throw new BadRequestException('A plan needs 1–120 content slots');
  const slots=v.slots.map(raw=>{
   const s=object(raw,['channel','planned_at','format','brief','pillar','hook','cta','creative_version_id']);
   if(!channels.includes(String(s.channel))||!['static','ad'].includes(String(s.format)))throw new BadRequestException('Choose a supported channel and image format');
   return {channel:String(s.channel),planned_at:planTime(s.planned_at,starts,timezone),format:String(s.format),brief:text(s.brief,4000),pillar:text(s.pillar??'',140,true),hook:text(s.hook??'',500,true),cta:text(s.cta??'',500,true),creative_version_id:s.creative_version_id==null?null:uuid(String(s.creative_version_id))};
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
    const row=(await db.query(`INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,creative_version_id,creative_sha256,state,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[randomUUID(),b.organization_id,id,pid,s.channel,s.planned_at,s.format,s.brief,s.pillar,s.hook,s.cta,creative?.id??null,creative?.sha256??null,creative?'draft_ready':'content_needed',user])).rows[0];
    await this.event(db,user,row,'created');
   }
   return {id:pid};
  });
 }
 list(user:string,id:string,query:unknown,inbox=false) {
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
    ${inbox?"AND s.state NOT IN ('content_needed','draft_ready','cancelled')":''}`;
   const rows=(await db.query(`SELECT s.*,p.title AS plan_title,p.timezone,p.objective,p.starts_on::text,
    v.caption,v.design,v.media_id,v.skill_manifest,v.project_id,c.thread_id,
    (v.id IS NOT NULL AND c.latest_version_id<>v.id) AS has_newer_version
    FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id
    LEFT JOIN app.creative_versions v ON v.id=s.creative_version_id LEFT JOIN app.creative_projects c ON c.id=v.project_id
    WHERE ${where} ORDER BY s.planned_at,s.id LIMIT 100 OFFSET $8`,[...args,(page-1)*100])).rows;
   const counts=(await db.query(`SELECT s.channel,s.state,count(*)::int AS count FROM app.content_slots s WHERE ${where} GROUP BY s.channel,s.state`,args)).rows;
   const total=counts.reduce((n,r)=>n+r.count,0);
   return {slots:rows,counts,total,page,has_more:page*100<total};
  });
 }
 history(user:string,id:string,slotId:string) {
  slotId=uuid(slotId);
  return this.scope(user,id,false,async(db,b)=>{
   if(!(await db.query('SELECT id FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,slotId])).rowCount)throw new NotFoundException('Content slot not found');
   return {events:(await db.query('SELECT revision,action,actor_id,creative_version_id,creative_sha256,feedback,snapshot,created_at FROM app.content_slot_events WHERE slot_id=$1 ORDER BY revision',[slotId])).rows};
  });
 }
 edit(user:string,id:string,slotId:string,body:unknown) {
  slotId=uuid(slotId);
  const v=object(body,['revision','planned_at','brief','pillar','hook','cta','creative_version_id','reset_approval']);
  const rev=revision(v.revision);
  if(!['planned_at','brief','pillar','hook','cta','creative_version_id'].some(k=>k in v))throw new BadRequestException('Include a content change');
  if(v.reset_approval!==undefined&&typeof v.reset_approval!=='boolean')throw new BadRequestException('Invalid approval confirmation');
  return this.scope(user,id,true,async(db,b)=>{
   const s=(await db.query('SELECT s.*,p.starts_on::text,p.timezone FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.id=$3',[b.organization_id,id,slotId])).rows[0];
   if(!s)throw new NotFoundException('Content slot not found');
   if(s.revision!==rev)throw new ConflictException('This post changed. Reload before editing');
   if(s.state==='cancelled')throw new ConflictException('This content slot was cancelled');
   if(s.state==='approved'&&v.reset_approval!==true)throw new ConflictException('Confirm that editing this approved post requires a new review');
   const when='planned_at' in v?planTime(v.planned_at,s.starts_on,s.timezone):s.planned_at;
   const creative='creative_version_id' in v?(v.creative_version_id===null?null:await this.creative(db,b.organization_id,id,v.creative_version_id,s.format)):s.creative_version_id?await this.creative(db,b.organization_id,id,s.creative_version_id,s.format):null;
   const result=(await db.query(`UPDATE app.content_slots SET planned_at=$2,brief=$3,pillar=$4,hook=$5,cta=$6,creative_version_id=$7,creative_sha256=$8,state=$9,revision=revision+1,approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[slotId,when,'brief' in v?text(v.brief,4000):s.brief,'pillar' in v?text(v.pillar,140,true):s.pillar,'hook' in v?text(v.hook,500,true):s.hook,'cta' in v?text(v.cta,500,true):s.cta,creative?.id??null,creative?.sha256??null,creative?'draft_ready':'content_needed'])).rows[0];
   await this.event(db,user,result,'edited');
   return result;
  });
 }
 review(user:string,id:string,slotId:string,body:unknown) {
  const v=object(body,['revision','creative_version_id','creative_sha256','decision','feedback']);
  return this.scope(user,id,true,(db,b)=>this.decide(db,b,user,id,uuid(slotId),v));
 }
 async decide(db:PoolClient,b:Business,user:string,id:string,slotId:string,v:Record<string,unknown>) {
  const rev=revision(v.revision),decision=String(v.decision),feedback=text(v.feedback??'',2000,true);
  if(!['pending_review','approved','changes_requested','rejected','cancelled'].includes(decision))throw new BadRequestException('Choose a review action');
  if(['changes_requested','rejected'].includes(decision)&&!feedback)throw new BadRequestException('Include feedback for the creator');
  const s=(await db.query('SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,slotId])).rows[0];
  if(!s)throw new NotFoundException('Content slot not found');
  if(s.revision!==rev||s.creative_version_id!==(v.creative_version_id??null)||s.creative_sha256!==(v.creative_sha256??null))throw new ConflictException('Review the current post and creative version');
  if(['approved','rejected','changes_requested'].includes(decision)&&!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or admin can decide reviews');
  const allowed=decision==='cancelled'?s.state!=='cancelled':decision==='pending_review'?['draft_ready','changes_requested'].includes(s.state):s.state==='pending_review';
  if(!allowed)throw new ConflictException('This post is not eligible for that review action');
  if(decision!=='cancelled')await this.creative(db,b.organization_id,id,s.creative_version_id,s.format);
  const result=(await db.query('UPDATE app.content_slots SET state=$2,revision=revision+1,approved_by=$3,approved_at=$4,updated_at=now() WHERE id=$1 RETURNING *',[slotId,decision,decision==='approved'?user:null,decision==='approved'?new Date():null])).rows[0];
  await this.event(db,user,result,decision,feedback);
  return result;
 }
 bulkApprove(user:string,id:string,body:unknown) {
  const v=object(body,['confirmed','items']);
  if(v.confirmed!==true||!Array.isArray(v.items)||!v.items.length||v.items.length>30)throw new BadRequestException('Confirm approval of 1–30 selected versions');
  const items=v.items.map(raw=>{const i=object(raw,['id','revision','creative_version_id','creative_sha256']);return {...i,id:uuid(String(i.id))};});
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new BadRequestException('Select each post once');
  return this.scope(user,id,true,async(db,b)=>{
   const slots=[];
   for(const i of items)slots.push(await this.decide(db,b,user,id,i.id,{...i,decision:'approved',feedback:''}));
   return {slots};
  });
 }
}
