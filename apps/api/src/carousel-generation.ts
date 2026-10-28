import {campaignCreativeContext,campaignDesignDirection} from './campaign-design.js';
import type {PoolClient} from 'pg';
import {normalizeCreativeSpec,creativeSourceSize,type CreativeSpec} from './campaign-formats.js';
import {withCampaignRefinement} from './campaign-refinement.js';
import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {creativeTextProvider,creativeTextModel} from './creative-planning.js';
import {approvedLearning} from './learning-context.js';
import {validateCarouselInput,type CarouselInput} from './carousel-planning.js';
export class CarouselGeneration {
 constructor(readonly canvas:Canvas,readonly rendererImage?:string){}
 submit(user:string,brand:string,body:unknown,key:unknown,scoped?:{db:PoolClient;b:{organization_id:string};batchJobIds?:string[]}){
  const v=object(body,['prompt','slide_count','channel','size','text_provider','reference_ids','campaign_plan_id','slot_id','slot_revision','creative_spec','max_cost_micros','planning_cost_micros']),provider=creativeTextProvider(v.text_provider);
  if(typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>4000||!Number.isInteger(v.slide_count)||Number(v.slide_count)<2||Number(v.slide_count)>10||!['linkedin','instagram','facebook'].includes(String(v.channel))||!['1024x1024','1536x1024','1024x1536'].includes(String(v.size))||typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)||v.reference_ids!==undefined&&(!Array.isArray(v.reference_ids)||v.reference_ids.length>3))throw new BadRequestException('Describe the carousel and choose 2–10 slides, channel and size');
  let spec:CreativeSpec|null=null;try{if(v.creative_spec!=null)spec=normalizeCreativeSpec(v.creative_spec,'carousel',String(v.channel));}catch{throw new BadRequestException('Choose a compatible carousel format');}
  if(spec&&(spec.slide_count!==v.slide_count||creativeSourceSize(spec)!==v.size))throw new BadRequestException('Match the carousel size and slide count to its specification');
  const slot=v.slot_id==null?null:uuid(String(v.slot_id));
  if((slot===null)!==(v.slot_revision==null)||slot&&(!Number.isSafeInteger(v.slot_revision)||Number(v.slot_revision)<1))throw new BadRequestException('Include the saved post revision');
  const total=v.max_cost_micros,planningBudget=v.planning_cost_micros;
  if((total===undefined)!==(planningBudget===undefined)||total!==undefined&&(!Number.isSafeInteger(total)||Number(total)<1||Number(total)>1000000000||!Number.isSafeInteger(planningBudget)||Number(planningBudget)<1||Number(total)-Number(planningBudget)<Number(v.slide_count)))throw new BadRequestException('Include sufficient total and planning capacity');
  const campaignPlan=v.campaign_plan_id===undefined?null:uuid(String(v.campaign_plan_id));
  const refs=(v.reference_ids??[]).map((id:unknown)=>uuid(String(id)));if(new Set(refs).size!==refs.length)throw new BadRequestException('Choose each reference once');
  if(!this.rendererImage||!/^sha256:[a-f0-9]{64}$/.test(this.rendererImage))throw new ConflictException('The final image renderer must be configured');
  const fingerprint=hash(canonicalJSON({user,...v,text_provider:provider,reference_ids:refs}));
  const execute=async(db:PoolClient,b:{organization_id:string})=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
   const prior=(await db.query('SELECT r.job_id AS id,r.request_hash,j.status FROM app.carousel_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.request_key=$1',[key])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This key belongs to another carousel');return {id:prior.id,status:prior.status};}
   if(slot){
    const saved=(await db.query('SELECT * FROM app.content_slots WHERE id=$1 AND organization_id=$2 AND brand_id=$3 FOR UPDATE',[slot,b.organization_id,brand])).rows[0];
    if(!saved)throw new NotFoundException('Campaign post not found');
    if(saved.format!=='carousel'||saved.channel!==v.channel||saved.revision!==v.slot_revision||['approved','cancelled'].includes(saved.state)||saved.approved_by||campaignPlan!==saved.plan_id||canonicalJSON(saved.creative_spec??null)!==canonicalJSON(spec))throw new ConflictException('This carousel post changed. Review it again before generating');
   }
   let direction=String(v.prompt);
   if(campaignPlan){const plan=(await db.query('SELECT strategy FROM app.content_plans WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[campaignPlan,b.organization_id,brand])).rows[0];if(!plan)throw new NotFoundException('Campaign not found');const campaign=plan.strategy?.campaign;if(campaign)direction+='\nSaved campaign direction (data): '+JSON.stringify({campaign:campaignCreativeContext(campaign),visual_style:campaignDesignDirection(campaign.design)});direction=withCampaignRefinement(direction,campaign?.refinement);if(direction.length>3800)throw new BadRequestException('Shorten the carousel brief to leave room for your campaign preferences');}
   if((await db.query("SELECT id FROM app.jobs WHERE kind IN ('creative.generate','carousel.generate') AND status IN ('queued','running','retrying','unknown') AND NOT (id=ANY($1::uuid[])) AND NOT EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.generation_job_id=app.jobs.id AND c.parent_job_id=ANY($1::uuid[])) LIMIT 1",[scoped?.batchJobIds??[]])).rowCount)throw new ConflictException('A creative request is active or needs reconciliation');
   const count=Number(v.slide_count);if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='creative.generate' AND created_at>now()-interval '1 day'")).rows[0].n+count>30)throw new ConflictException('Daily creative request limit reached');
   const media=Number((await db.query('SELECT COALESCE(sum(bytes),0) AS n FROM app.creative_media')).rows[0].n);if(media+count*20971520>536870912)throw new ConflictException('Creative storage limit reached');
   const exported=Number((await db.query("SELECT COALESCE((SELECT sum(bytes) FROM app.creative_exports),0)+(SELECT count(*)*20971520 FROM app.jobs WHERE kind='creative.export' AND status IN ('queued','running','retrying')) AS n")).rows[0].n);if(exported+count*20971520>536870912)throw new ConflictException('Export storage limit reached');
   if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='creative.export' AND created_at>now()-interval '1 day'")).rows[0].n+count>100)throw new ConflictException('Daily export limit reached');
   if((await db.query('SELECT count(*)::int AS n FROM app.carousel_projects')).rows[0].n>=100)throw new ConflictException('Carousel limit reached');
   if(refs.length&&(await db.query('SELECT id FROM app.brand_references WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL',[refs])).rowCount!==refs.length)throw new ConflictException('A reference is unavailable');
   const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions ORDER BY approved_at DESC,id LIMIT 1')).rows[0];if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new ConflictException('Approve this business’s brand knowledge first');
   const memory=await approvedLearning(db),input:CarouselInput={task:'carousel',brand:{id:brain.id,sha256:brain.sha256,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value})),learning:memory},prompt:direction,channel:v.channel as CarouselInput['channel'],slide_count:count};validateCarouselInput(input);
   const model=await creativeTextModel(db,b.organization_id,brand,provider),parent=randomUUID(),project=randomUUID();
   const thread=await this.canvas.createThread(user,brand,{title:String(v.prompt).slice(0,140)},`carousel:${parent}`,{db,b});
   await db.query('INSERT INTO app.carousel_projects(id,organization_id,brand_id,created_by) VALUES($1,$2,$3,$4)',[project,b.organization_id,brand,user]);
   await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'carousel.generate')",[parent,b.organization_id,brand,user]);
   await db.query('INSERT INTO app.carousel_requests(job_id,organization_id,brand_id,project_id,thread_id,input,input_sha256,text_provider,selected_text_model,memory_context,renderer_image,request_key,request_hash,creative_spec,max_cost_micros) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[parent,b.organization_id,brand,project,thread.id,JSON.stringify(input),hash(canonicalJSON(input)),provider,model,JSON.stringify(memory),this.rendererImage,key,fingerprint,spec?JSON.stringify(spec):null,planningBudget??null]);
   if(slot)await db.query('INSERT INTO app.content_slot_carousel_generations(job_id,organization_id,brand_id,slot_id,source_revision,creative_spec,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[parent,b.organization_id,brand,slot,v.slot_revision,spec?JSON.stringify(spec):null,user]);
   for(let position=0;position<count;position++){
    const generation=randomUUID(),exportJob=randomUUID(),slideProject=randomUUID(),prompt=`Carousel slide ${position+1} of ${count}: ${direction.slice(0,3800)}`;
    await db.query('INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[slideProject,b.organization_id,brand,thread.id,`Slide ${position+1}: ${String(v.prompt).slice(0,120)}`,user]);
    for(const [id,kind] of [[generation,'creative.generate'],[exportJob,'creative.export']])await db.query('INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,$5)',[id,b.organization_id,brand,user,kind]);
    await db.query("INSERT INTO app.creative_requests(job_id,organization_id,brand_id,thread_id,project_id,brain_id,prompt,format,channel,size,request_key,request_hash,text_provider,selected_text_model,memory_context,creative_spec,max_cost_micros) VALUES($1,$2,$3,$4,$5,$6,$7,'static',$8,$9,$10,$11,$12,$13,$14,$15,$16)",[generation,b.organization_id,brand,thread.id,slideProject,brain.id,prompt,v.channel,v.size,`carousel:${parent}:${position}`,hash(canonicalJSON({parent,position})),provider,model,JSON.stringify(memory),spec?JSON.stringify({...spec,slide_count:null}):null,total===undefined?null:Math.floor((Number(total)-Number(planningBudget))/count)]);
    for(const [index,ref]of refs.entries())await db.query('INSERT INTO app.creative_references(organization_id,brand_id,job_id,reference_id,position) VALUES($1,$2,$3,$4,$5)',[b.organization_id,brand,generation,ref,index]);
    await db.query('INSERT INTO app.carousel_children(organization_id,brand_id,parent_job_id,position,generation_job_id,export_job_id) VALUES($1,$2,$3,$4,$5,$6)',[b.organization_id,brand,parent,position,generation,exportJob]);
   }
   await db.query("INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'user',$6)",[randomUUID(),b.organization_id,brand,thread.id,parent,String(v.prompt)]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'carousel.generate')",[parent,b.organization_id,brand]);return {id:parent,status:'queued'};
  };
  return scoped?execute(scoped.db,scoped.b):this.canvas.scope(user,brand,true,execute);
 }
 read(user:string,brand:string){return this.canvas.scope(user,brand,false,async db=>({runs:(await db.query("SELECT j.id,j.status,j.error_code,j.cancel_requested,r.project_id,r.thread_id,r.output_version_id,r.input->>'prompt' AS prompt,r.input->>'slide_count' AS slide_count,r.plan->'plan' AS shared_plan,j.created_at FROM app.jobs j JOIN app.carousel_requests r ON r.job_id=j.id ORDER BY j.created_at DESC,j.id LIMIT 20")).rows,slides:(await db.query('SELECT c.parent_job_id,c.position,g.status AS generation_status,g.error_code,r.project_id,r.output_version_id,e.status AS export_status,ce.id AS export_id FROM app.carousel_children c JOIN app.jobs g ON g.id=c.generation_job_id JOIN app.creative_requests r ON r.job_id=g.id JOIN app.jobs e ON e.id=c.export_job_id LEFT JOIN app.creative_exports ce ON ce.job_id=e.id ORDER BY c.parent_job_id,c.position')).rows}));}
 cancel(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,true,async db=>{const row=(await db.query("SELECT j.id,j.status FROM app.jobs j JOIN app.carousel_requests r ON r.job_id=j.id WHERE j.id=$1 AND j.status IN ('queued','running','retrying') FOR UPDATE OF j",[id])).rows[0];if(!row)throw new NotFoundException('Active carousel generation not found');await db.query('UPDATE app.carousel_requests SET canceled=true WHERE job_id=$1',[id]);await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1 OR id IN (SELECT generation_job_id FROM app.carousel_children WHERE parent_job_id=$1) OR id IN (SELECT export_job_id FROM app.carousel_children WHERE parent_job_id=$1)',[id]);return {id,cancel_requested:true,status:row.status};});}
}
