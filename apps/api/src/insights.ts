import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {ContentPlan} from './content-plan.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
export class Insights {
 constructor(readonly plans:ContentPlan){}
 read(user:string,brand:string){return this.plans.scope(user,brand,false,async(db,b)=>({can_generate:(await db.query('SELECT app.business_access($1,$2,true) AS allowed',[b.organization_id,brand])).rows[0].allowed,can_review:(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed,runs:(await db.query("SELECT j.id,j.status,j.error_code,j.cancel_requested,j.created_at,r.provider FROM app.jobs j JOIN app.insight_requests r ON r.job_id=j.id ORDER BY j.created_at DESC LIMIT 20")).rows,lessons:(await db.query('SELECT l.*,r.input,r.output FROM app.memory_lessons l JOIN app.insight_requests r ON r.job_id=l.job_id ORDER BY l.created_at DESC,l.id LIMIT 100')).rows.map((r:any)=>({id:r.id,content:r.content,state:r.state,revision:r.revision,applicability:r.applicability,reviewed_by:r.reviewed_by,reviewed_at:r.reviewed_at,created_at:r.created_at,evidence:r.input.observations.filter((o:any)=>r.content.evidence_ids.includes(o.id)),analysis_limitations:r.output.analysis.limitations}))}));}
 submit(user:string,brand:string,body:unknown,key:unknown){
  const v=object(body,['provider']),provider=v.provider??'openai';if(!['openai','gemini'].includes(String(provider))||typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Choose OpenAI or Gemini and include a request key');
  const fingerprint=hash(canonicalJSON({user,provider}));
  return this.plans.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`insights:${brand}`]);
   const prior=(await db.query('SELECT j.id,j.status,r.request_hash FROM app.insight_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.request_key=$1',[key])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This key belongs to a different analysis');return {id:prior.id,status:prior.status};}
   if((await db.query("SELECT id FROM app.jobs WHERE kind='insight.generate' AND status IN ('queued','running','retrying','unknown')")).rowCount)throw new ConflictException('An analysis is active or needs reconciliation');
   if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='insight.generate' AND created_at>now()-interval '1 day'")).rows[0].n>=5)throw new ConflictException('Daily analysis limit reached');
   const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions ORDER BY approved_at DESC,id LIMIT 1')).rows[0];if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new ConflictException('Approve this business’s brand knowledge first');
   const observations=(await db.query(`SELECT a.id,r.job_id AS publication_id,r.caption,r.scheduled_at,c.provider,c.name AS account_name,CASE WHEN r.video_version_id IS NULL THEN 'static' ELSE 'video' END AS format,a.semantics,a.series,a.collected_at FROM app.publication_requests r JOIN app.social_channels c ON c.id=r.channel_id JOIN LATERAL(SELECT * FROM app.post_analytics x WHERE x.publication_id=r.job_id ORDER BY x.collected_at DESC,x.id DESC LIMIT 1)a ON true WHERE r.phase='accepted' AND r.observed_state='published' AND a.state='available' ORDER BY r.scheduled_at DESC,r.job_id LIMIT 20`)).rows;
   if(!observations.length)throw new ConflictException('Collect available post metrics before requesting analysis');
   const input=JSON.parse(JSON.stringify({task:'performance_analysis',brand:{id:brain.id,sha256:brain.sha256,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},observations}));if(Buffer.byteLength(JSON.stringify(input))>290000)throw new ConflictException('The saved evidence is too large for one analysis');
   const grant=(await db.query('SELECT model FROM app.insight_grants WHERE provider=$1 AND enabled AND expires_at>now()',[provider])).rows[0];if(!grant)throw new ConflictException('An operator must authorize a separate analysis allowance first');
   const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'insight.generate')",[job,b.organization_id,brand,user]);
   await db.query('INSERT INTO app.insight_requests(job_id,organization_id,brand_id,provider,selected_model,input,input_sha256,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,b.organization_id,brand,provider,grant.model,JSON.stringify(input),hash(canonicalJSON(input)),key,fingerprint]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'insight.generate')",[job,b.organization_id,brand]);return {id:job,status:'queued'};
  });
 }
 review(user:string,brand:string,id:string,body:unknown){id=uuid(id);const v=object(body,['revision','decision','applicability','confirmed']);
  if(!Number.isSafeInteger(v.revision)||Number(v.revision)<1||Number(v.revision)>=2147483647||!['testing','rejected','retired'].includes(String(v.decision))||typeof v.applicability!=='string'||v.applicability.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.applicability)||v.confirmed!==true)throw new BadRequestException('Confirm the saved lesson revision and intended use');
  return this.plans.scope(user,brand,true,async(db,b)=>{
   if(!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed)throw new ForbiddenException('Only a business owner or administrator can approve learning');
   const prior=(await db.query('SELECT * FROM app.memory_lessons WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!prior)throw new NotFoundException('Learning proposal not found');if(prior.revision!==v.revision)throw new ConflictException('Refresh this lesson before deciding');
   await db.query('UPDATE app.memory_lessons SET state=$2,revision=revision+1,applicability=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',[id,v.decision,v.applicability,user]);
   await db.query('INSERT INTO app.memory_reviews(id,organization_id,brand_id,lesson_id,actor_id,state,revision,applicability) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),b.organization_id,brand,id,user,v.decision,Number(v.revision)+1,v.applicability]);return {id,state:v.decision,revision:Number(v.revision)+1};
  });
 }
 cancel(user:string,brand:string,id:string){id=uuid(id);return this.plans.scope(user,brand,true,async db=>{const r=(await db.query("SELECT id FROM app.jobs WHERE id=$1 AND kind='insight.generate' AND status IN ('queued','running','retrying')",[id])).rows[0];if(!r)throw new ConflictException('Analysis is no longer active');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[id]);return {id,cancel_requested:true};});}
}
