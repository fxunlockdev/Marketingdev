import {addDays,dayStart} from './local-calendar.js';
import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {ContentPlan} from './content-plan.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
import type {PlanningInput} from './planning-contracts.js';
export class Planning {
 constructor(readonly plans:ContentPlan){}
 submit(user:string,id:string,body:unknown,key:unknown){
  const v=object(body,['starts_on','brief','duration_days','post_count','video_count','provider','repeat_cycles','loop_budget_micros','confirm_recurring_spend','canvas_thread_id']),brief=v.brief??'';
  if(typeof v.starts_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.starts_on)||!Number.isFinite(Date.parse(v.starts_on))||new Date(v.starts_on).toISOString().slice(0,10)!==v.starts_on||v.starts_on<'2000-01-01'||v.starts_on>'2100-12-01')throw new BadRequestException('Choose a valid start date');
  if(typeof brief!=='string'||brief.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(brief))throw new BadRequestException('Use a planning brief of at most 2000 characters');
  if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const days=v.duration_days??30,count=v.post_count??days;
  if(!Number.isInteger(days)||Number(days)<1||Number(days)>90||!Number.isInteger(count)||Number(count)<1||Number(count)>90)throw new BadRequestException('Choose 1–90 days and 1–90 posts');
  const videos=v.video_count??0;
  if(!Number.isInteger(videos)||Number(videos)<0||Number(videos)>Math.min(Number(count),30))throw new BadRequestException('Choose up to 30 videos within the total post count');
  const provider=v.provider??'openai';if(!['openai','gemini'].includes(String(provider)))throw new BadRequestException('Choose OpenAI or Gemini');
  const threadId=v.canvas_thread_id===undefined?undefined:v.canvas_thread_id===null?null:uuid(String(v.canvas_thread_id));
  const cycles=v.repeat_cycles??1;
  if(!Number.isInteger(cycles)||Number(cycles)<1||Number(cycles)>12||Number(cycles)*Number(days)>366)throw new BadRequestException('Choose up to 12 cycles within one year');
  if(Number(cycles)>1&&(v.confirm_recurring_spend!==true||!Number.isSafeInteger(v.loop_budget_micros)||Number(v.loop_budget_micros)<1||Number(v.loop_budget_micros)>1000000000))throw new BadRequestException('Confirm recurring planning charges and a total budget');
  const requestHash=hash(canonicalJSON({starts_on:v.starts_on,brief,user,...(threadId!==undefined?{canvas_thread_id:threadId}:{}),...(Number(cycles)>1?{repeat_cycles:cycles,loop_budget_micros:v.loop_budget_micros}:{}),...(v.duration_days!==undefined||v.post_count!==undefined?{duration_days:days,post_count:count}:{}),...(v.video_count!==undefined?{video_count:videos}:{}),...(v.provider!==undefined?{provider}:{})}));
  return this.plans.scope(user,id,true,async(db,b)=>{
   const prior=(await db.query('SELECT r.request_hash,j.id,j.status,r.output_plan_id,r.thread_id,r.loop_id FROM app.planning_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3',[b.organization_id,id,key])).rows[0];
   if(prior){if(prior.request_hash!==requestHash)throw new ConflictException('That request key belongs to another planning request');return {id:prior.id,status:prior.status,output_plan_id:prior.output_plan_id,thread_id:prior.thread_id,loop_id:prior.loop_id};}
   if((await db.query("SELECT j.id FROM app.jobs j JOIN app.planning_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='plan.generate' AND (j.status='unknown' OR (j.status IN ('queued','running','retrying') AND r.scheduled_at<=now() AND (r.loop_id IS NULL OR EXISTS(SELECT 1 FROM app.planning_loops l WHERE l.id=r.loop_id AND l.stopped_at IS NULL))))",[b.organization_id,id])).rowCount)throw new ConflictException('A plan is running or its uncertain provider result needs reconciliation');
   if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='plan.generate' AND created_at>now()-interval '1 day'",[b.organization_id,id])).rows[0].n>=5)throw new ConflictException('Daily planning request limit reached');
   if((await db.query('SELECT count(*)::int AS n FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0].n>=36)throw new ConflictException('This business has reached its plan limit');
   const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY approved_at DESC,id LIMIT 1',[b.organization_id,id])).rows[0];
   if(!brain)throw new ConflictException('Confirm your brand profile before planning');
   if(hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new ConflictException('The approved brand profile needs an integrity check');
   const prefs=(await db.query('SELECT goal,timezone,cadence,channels,must_avoid,revision,step FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0];
   if(!prefs||prefs.step!==3||!prefs.channels.length)throw new ConflictException('Finish your brand goals and choose content channels before planning');
   const input:PlanningInput={task:'content_plan',brand:{id:brain.id,sha256:brain.sha256,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value}))},preferences:{starts_on:v.starts_on as string,timezone:prefs.timezone,goal:prefs.goal,cadence:prefs.cadence,channels:prefs.channels,must_avoid:prefs.must_avoid,revision:prefs.revision},brief,duration_days:Number(days),post_count:Number(count),...(v.video_count!==undefined?{video_count:Number(videos)}:{})};
   if(Buffer.byteLength(JSON.stringify(input))>390000)throw new ConflictException('The approved brand profile exceeds the planning context limit');
   const grant=(await db.query('SELECT model FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider=$3 AND enabled AND expires_at>now()',[b.organization_id,id,provider])).rows[0];
   if(Number(cycles)>1&&(await db.query("SELECT l.id FROM app.planning_loops l WHERE l.organization_id=$1 AND l.brand_id=$2 AND l.stopped_at IS NULL AND EXISTS(SELECT 1 FROM app.planning_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.loop_id=l.id AND j.status IN ('queued','running','retrying','unknown'))",[b.organization_id,id])).rowCount)throw new ConflictException('Stop the active planning loop before starting another');
   if(Number(cycles)>1&&!grant)throw new ConflictException('Enable this planning model before starting a loop');
   let conversation=threadId;
   if(conversation){if(!(await db.query('SELECT id FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,conversation])).rowCount)throw new NotFoundException('Conversation not found');}
   if(conversation===null){
    if((await db.query('SELECT count(*)::int AS n FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0].n>=100)throw new ConflictException('This business has reached its conversation limit');
    conversation=randomUUID();await db.query('INSERT INTO app.canvas_threads(id,organization_id,brand_id,title,created_by,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[conversation,b.organization_id,id,brief.trim().slice(0,140)||'Content planning',user,`plan:${key}`,requestHash]);
   }
   const loop=Number(cycles)>1?randomUUID():null;
   if(loop)await db.query('INSERT INTO app.planning_loops(id,organization_id,brand_id,created_by,cycles,budget_micros) VALUES($1,$2,$3,$4,$5,$6)',[loop,b.organization_id,id,user,cycles,v.loop_budget_micros]);
   let first='';
   for(let cycle=0;cycle<Number(cycles);cycle++){
   const job=randomUUID();if(!first)first=job;
   const cycleInput={...input,preferences:{...input.preferences,starts_on:addDays(input.preferences.starts_on,cycle*Number(days))}};
   const due=cycle===0?new Date().toISOString():dayStart(cycleInput.preferences.starts_on,input.preferences.timezone);
   if(cycleInput.preferences.starts_on>'2100-12-01'||(cycle>0&&Date.parse(due)<=Date.now()))throw new BadRequestException('Future loop cycles must start in the future');
   await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'plan.generate')",[job,b.organization_id,id,user]);
   await db.query('INSERT INTO app.planning_requests(job_id,organization_id,brand_id,brain_id,input,input_sha256,request_key,request_hash,provider,selected_model,loop_id,scheduled_at,thread_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[job,b.organization_id,id,brain.id,JSON.stringify(cycleInput),hash(canonicalJSON(cycleInput)),cycle===0?key:`loop:${loop}:${cycle}`,requestHash,provider,grant?.model??null,loop,due,conversation??null]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind,available_at) VALUES($1,$2,$3,'plan.generate',$4)",[job,b.organization_id,id,due]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'plan.requested',$4)",[b.organization_id,id,user,job]);
   if(conversation&&cycle===0)await db.query("INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'user',$6)",[randomUUID(),b.organization_id,id,conversation,job,`${brief.trim()||'Plan content for this business.'}\n${count} posts over ${days} days, starting ${v.starts_on}; ${videos} videos. ${cycles} planning cycle(s).`]);
   }
   return {id:first,status:'queued',output_plan_id:null,loop_id:loop,thread_id:conversation??null};
  });
 }
 loops(user:string,id:string){return this.plans.scope(user,id,false,async(db,b)=>({loops:(await db.query(`SELECT l.id,l.cycles,l.budget_micros::text,l.stopped_at,l.created_at,count(*) FILTER(WHERE j.status='succeeded')::int AS completed,count(*) FILTER(WHERE j.status IN ('failed','rejected','unknown'))::int AS needs_attention,min(r.scheduled_at) FILTER(WHERE j.status='queued') AS next_at FROM app.planning_loops l JOIN app.planning_requests r ON r.loop_id=l.id JOIN app.jobs j ON j.id=r.job_id WHERE l.organization_id=$1 AND l.brand_id=$2 GROUP BY l.id ORDER BY l.created_at DESC LIMIT 30`,[b.organization_id,id])).rows}));}
 stopLoop(user:string,id:string,loopId:string){loopId=uuid(loopId);return this.plans.scope(user,id,true,async(db,b)=>{
  const r=await db.query('UPDATE app.planning_loops SET stopped_at=COALESCE(stopped_at,now()) WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING id,stopped_at',[b.organization_id,id,loopId]);
  if(!r.rowCount)throw new NotFoundException('Planning loop not found');
  await db.query("UPDATE app.jobs SET cancel_requested=true WHERE id IN (SELECT job_id FROM app.planning_requests WHERE loop_id=$1) AND status IN ('queued','running','retrying')",[loopId]);
  return r.rows[0];
 });}
 jobs(user:string,id:string){return this.plans.scope(user,id,false,async(db,b)=>({jobs:(await db.query("SELECT j.id,j.status,j.cancel_requested,j.error_code,j.created_at,r.output_plan_id,r.input->'preferences' AS preferences,r.input->'duration_days' AS duration_days,r.input->'post_count' AS post_count,r.provider,r.selected_model,r.loop_id,r.scheduled_at,r.thread_id FROM app.jobs j JOIN app.planning_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='plan.generate' ORDER BY j.created_at DESC,j.id LIMIT 100",[b.organization_id,id])).rows}));}
 cancel(user:string,id:string,jobId:string){jobId=uuid(jobId);return this.plans.scope(user,id,true,async(db,b)=>{
  const j=(await db.query("SELECT id,status FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND kind='plan.generate'",[b.organization_id,id,jobId])).rows[0];
  if(!j)throw new NotFoundException('Planning request not found');
  if(!['queued','running','retrying'].includes(j.status))throw new ConflictException('This planning request finished or needs reconciliation');
  await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[jobId]);return {id:jobId,cancel_requested:true};
 });}
 detail(user:string,id:string,planId:string){planId=uuid(planId);return this.plans.scope(user,id,false,async(db,b)=>{
  const p=(await db.query('SELECT id,title,objective,starts_on::text,timezone,duration_days,origin,brain_id,strategy,skill_manifest,created_by,created_at FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,planId])).rows[0];
  if(!p)throw new NotFoundException('Content plan not found');return p;
 });}
}
