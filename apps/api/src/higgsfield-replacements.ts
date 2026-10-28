import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {object,uuid} from './workspaces.js';
import {creativeSourceSize,normalizeCreativeSpec} from './campaign-formats.js';
export class HiggsfieldReplacements {
 constructor(readonly canvas:Canvas,readonly enabled=false){}
 private async available(db:any,org:string,brand:string){
  if(!this.enabled)throw new ConflictException('AI photo replacement is not configured');
  const g=(await db.query('SELECT max_request_micros FROM app.higgsfield_image_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[org,brand])).rows[0];
  if(!g)throw new ConflictException('AI photo replacement allowance is not configured');
  return Number(g.max_request_micros);
 }
 quote(user:string,brand:string){return this.canvas.scope(user,brand,false,async(db,b)=>{
  try{const cap=await this.available(db,b.organization_id,brand);return {configured:true,credits:Math.ceil(cap/10000),provider:'higgsfield',kind:'generated_image'};}catch(e){if(!(e instanceof ConflictException))throw e;return {configured:false,credits:null,provider:'higgsfield',kind:'generated_image'};}
 });}
 status(user:string,brand:string,project:string){project=uuid(project);return this.canvas.scope(user,brand,false,async(db)=>({run:(await db.query("SELECT j.id,j.status,j.error_code,r.parent_version_id,r.output_version_id FROM app.creative_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.project_id=$1 AND r.image_provider='higgsfield' ORDER BY j.created_at DESC LIMIT 1",[project])).rows[0]??null}));}
 submit(user:string,brand:string,project:string,body:unknown,key:unknown){
  project=uuid(project);const v=object(body,['parent_id','prompt','channel','credit_cap']),parent=uuid(String(v.parent_id));
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(key)||typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>3000||/[\x00-\x1f\x7f]/.test(v.prompt)||!['instagram','facebook','linkedin'].includes(String(v.channel))||!Number.isSafeInteger(v.credit_cap)||Number(v.credit_cap)<1||Number(v.credit_cap)>10000)throw new BadRequestException('Describe the replacement photo and confirm its credits');
  const prompt=v.prompt.trim();
  const fingerprint=hash(canonicalJSON({project,parent,prompt,channel:v.channel,credit_cap:v.credit_cap,provider:'higgsfield'}));
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
   const old=(await db.query('SELECT r.request_hash,j.id,j.status FROM app.creative_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3',[b.organization_id,brand,key])).rows[0];
   if(old){if(old.request_hash!==fingerprint)throw new ConflictException('This request key belongs to another image');return {id:old.id,status:old.status};}
   const cap=await this.available(db,b.organization_id,brand);
   if(Math.ceil(cap/10000)!==v.credit_cap)throw new ConflictException('The image credit quote changed; review it again');
   const p=(await db.query('SELECT v.*,p.thread_id,p.latest_version_id,p.archived_at,m.width,m.height,(SELECT r.channel FROM app.creative_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.project_id=p.id ORDER BY j.created_at DESC LIMIT 1) AS source_channel FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1 AND v.project_id=$2',[parent,project])).rows[0];
   if(!p)throw new NotFoundException('Creative not found');
   if(p.archived_at||p.latest_version_id!==parent)throw new ConflictException('Open the latest active image before replacing its photo');
   if((await db.query("SELECT 1 FROM app.jobs WHERE brand_id=$1 AND kind IN ('creative.generate','carousel.generate') AND status IN ('queued','running','retrying','unknown')",[brand])).rowCount)throw new ConflictException('Another image is generating or needs reconciliation');
   if(Number((await db.query("SELECT count(*) AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.generate' AND created_at>now()-interval '1 day'",[brand])).rows[0].n)>=90)throw new ConflictException('Daily image limit reached');
   const channel=p.source_channel??String(v.channel);
   const spec=p.skill_manifest?.creative_spec?normalizeCreativeSpec(p.skill_manifest.creative_spec,'static',channel):null;
   const size=spec?creativeSourceSize(spec):`${p.width}x${p.height}`;
   if(!['1024x1024','1024x1536','1536x1024'].includes(size))throw new BadRequestException('This image size cannot be replaced');
   const id=randomUUID();
   await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'creative.generate')",[id,b.organization_id,brand,user]);
   await db.query("INSERT INTO app.creative_requests(job_id,organization_id,brand_id,thread_id,project_id,brain_id,parent_version_id,prompt,format,channel,size,request_key,request_hash,max_cost_micros,creative_spec,image_provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'static',$9,$10,$11,$12,$13,$14,'higgsfield')",[id,b.organization_id,brand,p.thread_id,project,p.brain_id,parent,prompt,channel,size,key,fingerprint,cap,spec?JSON.stringify(spec):null]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'creative.generate')",[id,b.organization_id,brand]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'creative.ai_replacement_requested',$4)",[b.organization_id,brand,user,id]);
   return {id,status:'queued'};
  });
 }
}
