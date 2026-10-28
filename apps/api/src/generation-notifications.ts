import {createHash,randomUUID} from 'node:crypto';
import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {ContentPlan} from './content-plan.js';
import {MailQueue,mailbox} from './mail.js';
import {object,uuid} from './workspaces.js';

/** One explicit request watches only the generation jobs selected at that moment. */
export class GenerationNotifications {
 constructor(readonly plans:ContentPlan,readonly mail:MailQueue){}
 async read(user:string,brand:string,plan:string|null){
  plan=plan===null?null:uuid(plan);
  return this.plans.scope(user,brand,false,async(db,b)=>{
   if(plan&&!(await db.query('SELECT id FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,brand,plan])).rows.length)throw new NotFoundException('Campaign not found');
   return {available:this.mail.enabled,notifications:(await db.query(`SELECT n.id,o.status,n.created_at,n.job_ids FROM app.generation_notifications n JOIN delivery.outbox o ON o.id=n.mail_id WHERE n.organization_id=$1 AND n.brand_id=$2 AND n.plan_id IS NOT DISTINCT FROM $3::uuid AND n.actor_id=$4 ORDER BY n.created_at DESC LIMIT 20`,[b.organization_id,brand,plan,user])).rows};
  });
 }
 async subscribe(user:string,verifiedEmail:string,brand:string,plan:string|null,input:unknown){
  plan=plan===null?null:uuid(plan);const v=object(input,['job_ids']);
  if(!Array.isArray(v.job_ids)||!v.job_ids.length||v.job_ids.length>90)throw new BadRequestException('Choose the generation jobs to follow');
  const jobs=v.job_ids.map((id:unknown)=>uuid(String(id))).sort();
  if(new Set(jobs).size!==jobs.length)throw new BadRequestException('Choose each generation once');
  if(!this.mail.enabled)throw new ConflictException('Email notifications are not available yet');
  const to=mailbox(verifiedEmail);
  return this.plans.scope(user,brand,true,async(db,b)=>{
   const rows=(await db.query(`SELECT j.id AS job_id,COALESCE(r.thread_id,p.thread_id) AS thread_id FROM app.jobs j
    LEFT JOIN app.creative_requests r ON r.job_id=j.id AND r.organization_id=j.organization_id AND r.brand_id=j.brand_id
    LEFT JOIN app.video_requests v ON v.job_id=j.id AND v.organization_id=j.organization_id AND v.brand_id=j.brand_id
    LEFT JOIN app.video_projects p ON p.id=v.project_id AND p.organization_id=v.organization_id AND p.brand_id=v.brand_id
    WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.id=ANY($4::uuid[]) AND j.kind IN ('creative.generate','creative.video') AND (r.job_id IS NOT NULL OR v.job_id IS NOT NULL)
    AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM app.content_slots s WHERE s.organization_id=j.organization_id AND s.brand_id=j.brand_id AND s.plan_id=$3
     AND (s.id=v.slot_id OR EXISTS(SELECT 1 FROM app.content_slot_generations g WHERE g.slot_id=s.id AND g.job_id=j.id))))`,[b.organization_id,brand,plan,jobs])).rows;
   if(rows.length!==jobs.length)throw new NotFoundException('Generation not found');
   if(!plan&&new Set(rows.map(r=>r.thread_id)).size!==1)throw new BadRequestException('Choose generation jobs from one conversation');
   const existing=(await db.query(`SELECT n.id,o.status FROM app.generation_notifications n JOIN delivery.outbox o ON o.id=n.mail_id WHERE n.organization_id=$1 AND n.brand_id=$2 AND n.plan_id IS NOT DISTINCT FROM $3::uuid AND n.actor_id=$4 AND n.job_ids=$5::uuid[]`,[b.organization_id,brand,plan,user,jobs])).rows[0];
   if(existing)return existing;
   const id=randomUUID();
   // Query parameters identify the exact one-shot request, keeping queue dedupe stable.
   const url=new URL(`/b/${brand}/${plan?'content-plan':'canvas'}`,this.mail.origin);if(plan)url.searchParams.set('plan',plan);else url.searchParams.set('thread',rows[0].thread_id);url.searchParams.set('notification',createHash('sha256').update(jobs.join(',')).digest('hex'));
   const mailId=await this.mail.enqueue(db,'generation',{to,url:url.href},new Date(Date.now()+7*86400000),b.organization_id,user,true);
   await db.query('INSERT INTO app.generation_notifications(id,organization_id,brand_id,plan_id,actor_id,job_ids,mail_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,b.organization_id,brand,plan,user,jobs,mailId]);
   return {id,status:'waiting_generation'};
  });
 }
 async cancel(user:string,brand:string,plan:string|null,id:string){
  plan=plan===null?null:uuid(plan);id=uuid(id);
  return this.plans.scope(user,brand,false,async(db,b)=>{
   const row=(await db.query(`SELECT n.mail_id,o.status FROM app.generation_notifications n JOIN delivery.outbox o ON o.id=n.mail_id WHERE n.id=$1 AND n.organization_id=$2 AND n.brand_id=$3 AND n.plan_id IS NOT DISTINCT FROM $4::uuid AND n.actor_id=$5 FOR UPDATE OF o`,[id,b.organization_id,brand,plan,user])).rows[0];
   if(!row)throw new NotFoundException('Notification not found');
   if(row.status==='canceled')return {id,status:'canceled'};
   if(!['waiting_generation','pending','retry'].includes(row.status))throw new ConflictException('This message has already been handed to the email service');
   await db.query("UPDATE delivery.outbox SET status='canceled',encrypted_payload=NULL WHERE id=$1",[row.mail_id]);return {id,status:'canceled'};
  });
 }
}
