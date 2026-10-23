import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {object,uuid} from './workspaces.js';
type Page={creative_version_id:string;export_id:string;alt_text:string};
const plain=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const fingerprint=(v:any,pages:any[])=>hash(canonicalJSON({title:v.title,caption:v.caption,channel:v.channel,pages:pages.map(p=>({creative_version_id:p.creative_version_id,export_id:p.export_id,alt_text:p.alt_text,source_sha256:p.source_sha256,sha256:p.sha256}))}));
export class Carousels {
 constructor(readonly canvas:Canvas,readonly rendererImage?:string){}
 async lock(db:any,brand:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);}
 list(user:string,brand:string){return this.canvas.scope(user,brand,false,async(db,b)=>({
  can_edit:(await db.query('SELECT app.business_access($1,$2,true) AS allowed',[b.organization_id,brand])).rows[0].allowed,
  can_review:(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed,
  carousels:(await db.query('SELECT p.id,v.id AS version_id,v.title,v.channel,v.status,v.created_at FROM app.carousel_projects p JOIN app.carousel_versions v ON v.id=p.latest_version_id ORDER BY p.created_at DESC,p.id LIMIT 100')).rows,
  candidates:(await db.query('SELECT v.id AS creative_version_id,e.id AS export_id,e.sha256,e.width,e.height,p.id AS project_id,p.thread_id,p.title FROM app.creative_projects p JOIN app.creative_versions v ON v.id=p.latest_version_id JOIN app.creative_exports e ON e.version_id=v.id AND e.source_sha256=v.sha256 WHERE e.renderer_image=$1 ORDER BY e.created_at DESC,e.id LIMIT 100',[this.rendererImage??''])).rows
 }));}
 async pages(db:any,id:string){return (await db.query('SELECT cp.position,cp.creative_version_id,cp.export_id,cp.alt_text,e.source_sha256,e.sha256,e.width,e.height,e.renderer_image,v.brain_id,v.sha256 AS version_sha256,p.id AS project_id,p.thread_id,p.latest_version_id FROM app.carousel_pages cp JOIN app.creative_versions v ON v.id=cp.creative_version_id JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_exports e ON e.id=cp.export_id AND e.version_id=v.id WHERE cp.carousel_version_id=$1 ORDER BY cp.position',[id])).rows;}
 current(pages:any[]){return pages.length>=2&&pages.length<=10&&new Set(pages.map(p=>p.project_id)).size===pages.length&&pages.every((p,i)=>p.position===i&&p.latest_version_id===p.creative_version_id&&p.source_sha256===p.version_sha256&&p.renderer_image===this.rendererImage&&p.width===pages[0].width&&p.height===pages[0].height&&p.brain_id===pages[0].brain_id);}
 read(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,false,async db=>{
  const project=(await db.query('SELECT id,latest_version_id FROM app.carousel_projects WHERE id=$1',[id])).rows[0];if(!project)throw new NotFoundException('Carousel not found');
  const versions=(await db.query('SELECT id,title,caption,channel,sha256,status,review_revision,reviewed_at,created_at FROM app.carousel_versions WHERE project_id=$1 ORDER BY created_at DESC,id DESC',[id])).rows;
  for(const v of versions){v.pages=await this.pages(db,v.id);v.current=v.id===project.latest_version_id&&this.current(v.pages)&&fingerprint(v,v.pages)===v.sha256;}
  return {project,versions,reviews:(await db.query('SELECT r.version_id,r.decision,r.feedback,r.revision,r.created_at FROM app.carousel_reviews r JOIN app.carousel_versions v ON v.id=r.version_id WHERE v.project_id=$1 ORDER BY r.created_at,r.id',[id])).rows};
 });}
 save(user:string,brand:string,body:unknown,key:unknown){
  const v=object(body,['project_id','parent_id','title','caption','channel','pages']),projectId=v.project_id==null?null:uuid(String(v.project_id)),parent=v.parent_id==null?null:uuid(String(v.parent_id));
  if(!!projectId!==!!parent||!plain(v.title,140)||!plain(v.caption,3000)||!['linkedin','instagram'].includes(String(v.channel))||!Array.isArray(v.pages)||v.pages.length<2||v.pages.length>10||typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Choose 2–10 saved slides, a title, caption and channel');
  const pages:Page[]=v.pages.map((raw:any)=>{const p=object(raw,['creative_version_id','export_id','alt_text']);if(!plain(p.alt_text,1000))throw new BadRequestException('Describe each slide with alt text');return {creative_version_id:uuid(String(p.creative_version_id)),export_id:uuid(String(p.export_id)),alt_text:String(p.alt_text)};});
  if(new Set(pages.map(p=>p.creative_version_id)).size!==pages.length)throw new BadRequestException('Use each slide once');
  const requestHash=hash(canonicalJSON({projectId,parent,title:v.title,caption:v.caption,channel:v.channel,pages}));
  return this.canvas.scope(user,brand,true,async(db,b)=>{await this.lock(db,brand);
   const prior=(await db.query('SELECT id,project_id,request_hash FROM app.carousel_versions WHERE created_by=$1 AND request_key=$2',[user,key])).rows[0];if(prior){if(prior.request_hash!==requestHash)throw new ConflictException('This key belongs to another carousel edit');return {id:prior.id,project_id:prior.project_id};}
   let project=projectId;if(project){const p=(await db.query('SELECT latest_version_id FROM app.carousel_projects WHERE id=$1',[project])).rows[0];if(!p)throw new NotFoundException('Carousel not found');if(p.latest_version_id!==parent)throw new ConflictException('Refresh the carousel before saving');if((await db.query('SELECT count(*)::int AS n FROM app.carousel_versions WHERE project_id=$1',[project])).rows[0].n>=100)throw new ConflictException('Carousel version limit reached');}
   else{if((await db.query('SELECT count(*)::int AS n FROM app.carousel_projects')).rows[0].n>=100)throw new ConflictException('Carousel limit reached');project=randomUUID();await db.query('INSERT INTO app.carousel_projects(id,organization_id,brand_id,created_by) VALUES($1,$2,$3,$4)',[project,b.organization_id,brand,user]);}
   const resolved=[];for(const [position,p] of pages.entries()){const r=(await db.query('SELECT e.source_sha256,e.sha256,e.width,e.height,e.renderer_image,v.brain_id,v.sha256 AS version_sha256,v.project_id,cp.latest_version_id FROM app.creative_exports e JOIN app.creative_versions v ON v.id=e.version_id JOIN app.creative_projects cp ON cp.id=v.project_id WHERE e.id=$1 AND v.id=$2',[p.export_id,p.creative_version_id])).rows[0];if(!r)throw new NotFoundException('A saved slide is unavailable');resolved.push({...p,...r,position});}
   if(!this.current(resolved))throw new ConflictException('Use latest saved slides with matching dimensions and brand knowledge');
   const id=randomUUID(),sha=fingerprint(v,resolved);await db.query('INSERT INTO app.carousel_versions(id,organization_id,brand_id,project_id,parent_id,title,caption,channel,sha256,created_by,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,b.organization_id,brand,project,parent,v.title,v.caption,v.channel,sha,user,key,requestHash]);
   for(const [position,p] of pages.entries())await db.query('INSERT INTO app.carousel_pages(organization_id,brand_id,carousel_version_id,position,creative_version_id,export_id,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7)',[b.organization_id,brand,id,position,p.creative_version_id,p.export_id,p.alt_text]);
   await db.query('UPDATE app.carousel_projects SET latest_version_id=$2 WHERE id=$1',[project,id]);return {id,project_id:project};
  });
 }
 review(user:string,brand:string,id:string,body:unknown){id=uuid(id);const v=object(body,['revision','sha256','decision','feedback','confirmed']);
  if(!Number.isSafeInteger(v.revision)||Number(v.revision)<1||Number(v.revision)>=2147483647||!['in_review','approved','changes_requested','rejected'].includes(String(v.decision))||typeof v.feedback!=='string'||v.feedback.length>2000||v.confirmed!==true||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||(['changes_requested','rejected'].includes(String(v.decision))&&!v.feedback.trim()))throw new BadRequestException('Confirm this exact carousel and include feedback when requesting changes or rejecting');
  return this.canvas.scope(user,brand,true,async(db,b)=>{await this.lock(db,brand);
   if(v.decision!=='in_review'&&!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed)throw new ForbiddenException('A reviewer must approve the carousel');
   const row=(await db.query('SELECT v.*,p.latest_version_id FROM app.carousel_versions v JOIN app.carousel_projects p ON p.id=v.project_id WHERE v.id=$1 FOR UPDATE OF v',[id])).rows[0];if(!row)throw new NotFoundException('Carousel version not found');
   const pages=await this.pages(db,id);if(row.latest_version_id!==id||!this.current(pages)||fingerprint(row,pages)!==row.sha256||v.sha256!==row.sha256||row.review_revision!==v.revision)throw new ConflictException('Refresh and review the current carousel');
   if(v.decision==='in_review'? !['draft','changes_requested','rejected'].includes(row.status):row.status!=='in_review')throw new ConflictException('Submit this carousel for review before deciding');
   const revision=Number(v.revision)+1;await db.query('UPDATE app.carousel_versions SET status=$2,review_revision=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',[id,v.decision,revision,v.decision==='in_review'?null:user]);
   await db.query('INSERT INTO app.carousel_reviews(id,organization_id,brand_id,version_id,actor_id,decision,feedback,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),b.organization_id,brand,id,user,v.decision,v.feedback,revision]);return {id,status:v.decision,review_revision:revision};
  },v.decision!=='in_review');
 }
}
