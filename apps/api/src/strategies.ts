import {imageGenerationCapacity,planningGenerationCapacity} from './creative-budget.js';
import type {PoolClient} from 'pg';
import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Planning} from './planning.js';
import {SlotCreatives} from './slot-creatives.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {STRATEGIES} from './strategy-catalog.js';
export class Strategies{
 constructor(readonly planning:Planning,readonly creatives:SlotCreatives){}
 async quote(db:PoolClient,org:string,id:string){
  const image=(await db.query('SELECT max_image_request_micros,input_micros_per_token,output_micros_per_token FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[org,id])).rows[0];
  const planning=(await db.query("SELECT input_micros_per_token,output_micros_per_token FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2 AND provider='openai' AND enabled AND expires_at>now()",[org,id])).rows[0];
  return image&&planning?{available:true,image_credits:imageGenerationCapacity(image,3).credits,planning_credits:planningGenerationCapacity(planning)}:{available:false};
 }
 list(user:string,id:string){return this.planning.plans.scope(user,id,false,async(db,b)=>({catalog:STRATEGIES,quote:await this.quote(db,b.organization_id,id),strategies:(await db.query(`SELECT s.*,l.stopped_at,l.cycles,
 (SELECT jsonb_agg(jsonb_build_object('ordinal',o.ordinal,'job_id',j.id,'status',j.status,'error_code',j.error_code,'scheduled_at',r.scheduled_at,'plan_id',r.output_plan_id,'title',p.title,'images_requested',(SELECT count(*) FROM app.strategy_image_requests ir JOIN app.content_slots cs ON cs.id=ir.slot_id WHERE ir.strategy_id=s.id AND cs.plan_id=p.id),'images_active',(SELECT count(*) FROM app.strategy_image_requests ir JOIN app.content_slots cs ON cs.id=ir.slot_id JOIN app.jobs ij ON ij.id=ir.job_id WHERE ir.strategy_id=s.id AND cs.plan_id=p.id AND ij.status IN ('queued','running','retrying')),'images_failed',(SELECT count(*) FROM app.strategy_image_requests ir JOIN app.content_slots cs ON cs.id=ir.slot_id JOIN app.jobs ij ON ij.id=ir.job_id WHERE ir.strategy_id=s.id AND cs.plan_id=p.id AND ij.status IN ('failed','rejected','unknown','canceled')),'cover',(SELECT jsonb_build_object('design',cv.design,'format','static') FROM app.content_slots cs JOIN app.creative_versions cv ON cv.id=cs.creative_version_id WHERE cs.plan_id=p.id ORDER BY cs.planned_at,cs.id LIMIT 1)) ORDER BY o.ordinal)
 FROM app.strategy_occurrences o JOIN app.jobs j ON j.id=o.job_id JOIN app.planning_requests r ON r.job_id=j.id LEFT JOIN app.content_plans p ON p.id=r.output_plan_id WHERE o.strategy_id=s.id) AS occurrences
 FROM app.content_strategies s JOIN app.planning_loops l ON l.id=s.loop_id WHERE s.organization_id=$1 AND s.brand_id=$2 ORDER BY s.created_at DESC LIMIT 50`,[b.organization_id,id])).rows}));}
 create(user:string,id:string,body:unknown,key:unknown){
  const v=object(body,['kind','name','starts_on','weekly_posts','weeks','weekly_increase','credit_cap','planning_credits','image_credits','schedule_consent','campaign']);
  const template=STRATEGIES.find(t=>t.id===v.kind);if(!template)throw new BadRequestException('Choose a strategy');
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(key))throw new BadRequestException('Include a request key');
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>140)throw new BadRequestException('Name your strategy');
  for(const [field,min,max] of [['weekly_posts',1,14],['weeks',1,12],['weekly_increase',0,2],['credit_cap',1,100000],['planning_credits',1,100000],['image_credits',1,100000]] as const)if(!Number.isSafeInteger(v[field])||Number(v[field])<min||Number(v[field])>max)throw new BadRequestException(`Check ${field.replaceAll('_',' ')}`);
  if(Number(v.planning_credits)+Number(v.image_credits)>Number(v.credit_cap))throw new BadRequestException('Your credit cap must cover planning and at least one image');
  if(Number(v.weeks)>1&&v.schedule_consent!==true)throw new BadRequestException('Confirm scheduled planning before launching multiple weeks');
  const requestHash=hash(canonicalJSON({user,...v}));
  return this.planning.plans.scope(user,id,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`strategy:${id}`]);
   const old=(await db.query('SELECT id,request_hash FROM app.content_strategies WHERE organization_id=$1 AND brand_id=$2 AND request_key=$3',[b.organization_id,id,key])).rows[0];if(old){if(old.request_hash!==requestHash)throw new ConflictException('This request key belongs to another strategy');return {id:old.id};}
   if((await db.query('SELECT count(*)::int AS n FROM app.content_strategies WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0].n>=50)throw new ConflictException('Strategy limit reached');
   const quote=await this.quote(db,b.organization_id,id);if(!quote.available)throw new ConflictException('Generation setup is unavailable for this brand');if(Number(v.image_credits)<Number(quote.image_credits)||Number(v.planning_credits)<Number(quote.planning_credits)*Number(v.weeks))throw new ConflictException('Generation capacity changed. Refresh the strategy quote before continuing.');
   const planned=await this.planning.submit(user,id,{starts_on:v.starts_on,brief:template.theme,duration_days:7,post_count:v.weekly_posts,video_count:0,repeat_cycles:v.weeks,confirm_recurring_spend:v.schedule_consent===true,loop_budget_micros:Number(v.planning_credits)*10000,...(v.campaign?{campaign:v.campaign}:{})},`strategy:${key}`,{db,b,budgetMicros:Number(v.planning_credits)*10000,weeklyIncrease:Number(v.weekly_increase)});
   const strategy=randomUUID();await db.query('INSERT INTO app.content_strategies(id,organization_id,brand_id,created_by,request_key,request_hash,kind,name,loop_id,credit_cap,planning_credits,image_credits,allocated_credits,weekly_increase,schedule_consent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14)',[strategy,b.organization_id,id,user,key,requestHash,template.id,String(v.name).trim(),planned.loop_id,v.credit_cap,v.planning_credits,v.image_credits,v.weekly_increase,v.schedule_consent===true]);
   await db.query('INSERT INTO app.strategy_occurrences(organization_id,brand_id,strategy_id,job_id,ordinal) SELECT organization_id,brand_id,$1,job_id,row_number() OVER(ORDER BY scheduled_at,job_id) FROM app.planning_requests WHERE loop_id=$2',[strategy,planned.loop_id]);return {id:strategy};
  });
 }
 async stop(user:string,id:string,strategyId:string){strategyId=uuid(strategyId);const row=await this.planning.plans.scope(user,id,true,async(db,b)=>{const s=(await db.query('SELECT loop_id FROM app.content_strategies WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,strategyId])).rows[0];if(!s)throw new NotFoundException('Strategy not found');return s;});return this.planning.stopLoop(user,id,row.loop_id);}
 generate(user:string,id:string,strategyId:string,planId:string){strategyId=uuid(strategyId);planId=uuid(planId);
  return this.planning.plans.scope(user,id,true,async(db,b)=>{
   const s=(await db.query('SELECT s.*,l.stopped_at FROM app.content_strategies s JOIN app.planning_loops l ON l.id=s.loop_id WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.id=$3 FOR UPDATE OF s',[b.organization_id,id,strategyId])).rows[0];if(!s)throw new NotFoundException('Strategy not found');if(s.stopped_at)throw new ConflictException('This strategy is stopped');
   if(!(await db.query('SELECT o.job_id FROM app.strategy_occurrences o JOIN app.planning_requests r ON r.job_id=o.job_id WHERE o.strategy_id=$1 AND r.output_plan_id=$2',[strategyId,planId])).rowCount)throw new NotFoundException('Strategy campaign not found');
   const slots=(await db.query("SELECT c.id,c.revision FROM app.content_slots c WHERE c.plan_id=$1 AND c.format='static' AND c.state='content_needed' AND c.creative_version_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.strategy_image_requests r WHERE r.strategy_id=$2 AND r.slot_id=c.id) ORDER BY c.planned_at,c.id",[planId,strategyId])).rows;
   if(slots.length){const quote=await this.creatives.generationQuote(db,b.organization_id,id,planId);if(!quote.available||slots.some(slot=>{const q=quote.slots.find(q=>q.id===slot.id&&q.revision===slot.revision);return !q||q.credits>s.image_credits;}))throw new ConflictException('This campaign needs more generation capacity. Open the campaign to review its current quote before creating images.');}
   if(Number(s.allocated_credits)+slots.length*s.image_credits>s.credit_cap)throw new ConflictException('This campaign exceeds the strategy credit cap');
   const jobs:string[]=[];for(const slot of slots){const job=await this.creatives.generate(user,id,slot.id,{revision:slot.revision,max_cost_micros:s.image_credits*10000},`strategy-image:${strategyId}:${slot.id}`,{db,b,batchJobIds:jobs});jobs.push(job.id);await db.query('INSERT INTO app.strategy_image_requests(organization_id,brand_id,strategy_id,slot_id,job_id,credits) VALUES($1,$2,$3,$4,$5,$6)',[b.organization_id,id,strategyId,slot.id,job.id,s.image_credits]);}
   if(jobs.length)await db.query('UPDATE app.content_strategies SET allocated_credits=allocated_credits+$2 WHERE id=$1',[strategyId,jobs.length*s.image_credits]);
   return {jobs:(await db.query('SELECT r.slot_id,j.id,j.status,j.error_code FROM app.strategy_image_requests r JOIN app.jobs j ON j.id=r.job_id JOIN app.content_slots c ON c.id=r.slot_id WHERE r.strategy_id=$1 AND c.plan_id=$2',[strategyId,planId])).rows};
  });
 }
}
