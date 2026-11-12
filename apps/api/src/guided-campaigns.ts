import {GuidedVideos} from './guided-videos.js';
import {uploadedVideoProofSQL} from './video-references.js';
import {directionArtwork} from './business-research-direction.js';
import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Planning} from './planning.js';
import {SlotCreatives} from './slot-creatives.js';
import {object,uuid} from './workspaces.js';
import {hash,canonicalJSON} from './brand-brain.js';
import {campaignMonthDays} from './generation-plan.js';
import {allowanceMessage,allowanceShortfalls,type AllowanceKind} from './creative-budget.js';
import {recordSignal} from './learning-signals.js';
const SCHEDULE_SCAN_MS=60000,RELEASE_RETRY_MS=600000;
const formatCounts=(slots:readonly {format?:string}[]):Partial<Record<AllowanceKind,number>>=>({static:slots.filter(s=>s.format==='static').length,carousel:slots.filter(s=>s.format==='carousel').length});
export class GuidedCampaigns {
 private timer?:ReturnType<typeof setInterval>;
 private running=false;
 private scheduleScannedAt=0;
 private readonly releaseRetryAt=new Map<string,number>();
 constructor(readonly planning:Planning,readonly creatives:SlotCreatives,readonly channels:readonly string[],readonly videos?:GuidedVideos){}
 onModuleInit(){this.timer=setInterval(()=>{void this.runOnce().catch(()=>{});},5000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 read(user:string,brand:string){return this.planning.plans.scope(user,brand,false,async(db,b)=>{const allowance=(await db.query('SELECT app.content_allowances($1) AS value',[b.organization_id])).rows[0]?.value??null;const data={selected_platform:(await db.query('SELECT channels FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,brand])).rows[0]?.channels?.[0]??null,channels:this.channels.filter(c=>['instagram','facebook','linkedin'].includes(c)),campaigns:(await db.query(`SELECT g.*,EXISTS(SELECT 1 FROM app.content_slots s JOIN app.jobs failed ON failed.id IN (SELECT job_id FROM app.content_slot_generations WHERE slot_id=s.id UNION ALL SELECT job_id FROM app.content_slot_carousel_generations WHERE slot_id=s.id UNION ALL SELECT job_id FROM app.video_requests WHERE slot_id=s.id) WHERE s.plan_id=r.output_plan_id AND s.state='content_needed' AND (failed.status='unknown' OR (failed.status IN ('failed','rejected','canceled') AND NOT EXISTS(SELECT 1 FROM app.jobs newer JOIN (SELECT job_id,source_revision FROM app.content_slot_generations WHERE slot_id=s.id UNION ALL SELECT job_id,source_revision FROM app.content_slot_carousel_generations WHERE slot_id=s.id UNION ALL SELECT job_id,slot_revision AS source_revision FROM app.video_requests WHERE slot_id=s.id) attempt ON attempt.job_id=newer.id WHERE attempt.source_revision=s.revision AND newer.status IN ('queued','running','retrying','succeeded') AND newer.created_at>failed.created_at)))) AS generation_attention,j.status AS planning_status,j.error_code,r.output_plan_id,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision,'brief',s.brief,'channel',s.channel,'format',s.format,'planned_at',s.planned_at) ORDER BY s.planned_at,s.id) FROM app.content_slots s WHERE s.plan_id=r.output_plan_id),'[]'::jsonb) AS slots,(SELECT count(*)::int FROM app.content_slots s WHERE s.plan_id=r.output_plan_id) AS total_posts,(SELECT count(*)::int FROM app.content_slots s WHERE s.plan_id=r.output_plan_id AND s.format='video' AND s.video_version_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.video_requests vr WHERE vr.slot_id=s.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g.video_references) ref WHERE ref->>'id'=s.id::text)) AS videos_needing_reference,(SELECT count(*)::int FROM app.content_slots s WHERE s.plan_id=r.output_plan_id AND s.state IN ('draft_ready','pending_review','approved')) AS ready_posts FROM app.guided_campaigns g JOIN app.jobs j ON j.id=g.planning_job_id JOIN app.planning_requests r ON r.job_id=j.id WHERE g.organization_id=$1 AND g.brand_id=$2 ORDER BY g.created_at DESC LIMIT 30`,[b.organization_id,brand])).rows};
  // Say before approval, with exact counts, when this month's allowance cannot cover a plan.
  return {...data,allowance,video_generation_available:this.videos?.videos.enabled??false,campaigns:data.campaigns.map((c:{generation_started_at:unknown;slots:{format?:string}[]})=>({...c,allowance_shortfall:c.generation_started_at?null:allowanceMessage(allowanceShortfalls(allowance?.items,formatCounts(c.slots??[])))}))};});}
 create(user:string,brand:string,body:unknown,key:unknown){
  const v=object(body,['moodboard_id','starts_on','duration','channels','static_count','carousel_count','video_count','timezone']);
  const board=uuid(String(v.moodboard_id));
  const videos=v.video_count??0;
  if(!Number.isInteger(videos)||Number(videos)<0||Number(videos)>5)throw new BadRequestException('Choose up to five videos');
  const total=Number(v.static_count)+Number(v.carousel_count)+Number(videos);
  if(typeof key!=='string'||!/^[-A-Za-z0-9_.:]{8,100}$/.test(key))throw new BadRequestException('Include a request key');
  if(!['week','month'].includes(String(v.duration))||!Array.isArray(v.channels)||v.channels.length!==1||new Set(v.channels).size!==v.channels.length||v.channels.some(c=>!['instagram','facebook','linkedin'].includes(c)||!this.channels.includes(c)))throw new BadRequestException('Choose one available platform and a week or month');
  if(!Number.isInteger(v.static_count)||Number(v.static_count)<0||Number(v.static_count)>20||!Number.isInteger(v.carousel_count)||Number(v.carousel_count)<0||Number(v.carousel_count)>5||total<v.channels.length)throw new BadRequestException('Choose enough posts for your selected platforms, within your allowance');
  if(typeof v.starts_on!=='string'||typeof v.timezone!=='string'||v.timezone.length>100)throw new BadRequestException('Choose a start date and timezone');
  try{new Intl.DateTimeFormat('en',{timeZone:v.timezone});}catch{throw new BadRequestException('Choose a valid timezone');}
  let days:number;try{days=v.duration==='week'?7:campaignMonthDays(v.starts_on);}catch{throw new BadRequestException('Choose a valid start date');}
  if(total>days*2)throw new BadRequestException('Choose up to two posts per day, or select a month');
  const channels=v.channels as string[];
  const fingerprint=hash(canonicalJSON(v));
  return this.planning.plans.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${brand}`]);
   const prior=(await db.query('SELECT id,request_hash FROM app.guided_campaigns WHERE organization_id=$1 AND brand_id=$2 AND request_key=$3',[b.organization_id,brand,key])).rows[0];
   if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('That request belongs to another campaign');return {id:prior.id};}
   if((await db.query(`SELECT g.id FROM app.guided_campaigns g JOIN app.jobs j ON j.id=g.planning_job_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND g.generation_started_at IS NULL AND j.status NOT IN ('failed','rejected','canceled') LIMIT 1`,[b.organization_id,brand])).rowCount)throw new ConflictException('Your campaign is already being prepared. Open its saved progress.');
   const mood=(await db.query('SELECT * FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND approved_at IS NOT NULL',[b.organization_id,brand,board])).rows[0];
   if(!mood)throw new ConflictException('Approve your mood board first');
   const quota=(await db.query('SELECT app.content_allowances($1) AS value',[b.organization_id])).rows[0].value;
   const short=allowanceMessage(allowanceShortfalls(quota.items,{static:Number(v.static_count),carousel:Number(v.carousel_count),video:Number(videos)}));
    if(short)throw new ConflictException(short);
   const brief=(await db.query('SELECT brief FROM app.guided_business_briefs WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,brand])).rows[0].brief;
   await db.query(`INSERT INTO app.business_onboarding(organization_id,brand_id,step,goal,timezone,cadence,channels,must_avoid) VALUES($1,$2,3,$3,$4,3,$5,$6)
    ON CONFLICT(organization_id,brand_id) DO UPDATE SET step=3,goal=EXCLUDED.goal,timezone=EXCLUDED.timezone,channels=EXCLUDED.channels,must_avoid=EXCLUDED.must_avoid,revision=business_onboarding.revision+1,updated_at=now()`,[b.organization_id,brand,brief.goal,v.timezone,JSON.stringify(v.channels),brief.must_follow]);
   const mix:any[]=[];let position=0;
   for(const [format,count] of [['static',v.static_count],['carousel',v.carousel_count],['video',videos]] as const){
    for(let i=0;i<Number(count);i++){const channel=channels[position++%channels.length];let row=mix.find(r=>r.format===format&&r.channel===channel);if(!row){row={channel,format,count:0,creative_spec:format==='video'?{placement:channel==='linkedin'?'feed':'reel',aspect:channel==='linkedin'?'landscape':'vertical',slide_count:null}:{placement:'feed',aspect:'square',slide_count:format==='carousel'?3:null,artwork:directionArtwork(mood.direction)}};mix.push(row);}row.count++;}
   }
   const d=mood.direction;
   const theme=`Palette: ${d.palette.map((c:any)=>c.hex).join(', ')}. Fonts: ${d.heading_font}, ${d.body_font}. ${mood.feedback?`Customer feedback: ${mood.feedback.slice(0,650)}. `:''}Approved creative direction: ${d.imagery.slice(0,250)}. Voice: ${d.voice.slice(0,100)}. ${d.summary.slice(0,150)}`.slice(0,1200);
   const planningRequest={starts_on:v.starts_on,duration_days:days,brief:`Create a coherent monthly content plan. Use confirmed brand facts only.${mood.feedback?` Customer feedback on the approved mood board: ${mood.feedback}`:''} Content pillars: ${d.pillars.join('; ').slice(0,500)}`,content_mix:mix,campaign:{name:`${v.duration==='week'?'Weekly':'Monthly'} content`,theme,cta:'',target_url:'',channels:v.channels}};
   const job=await this.planning.submit(user,brand,planningRequest,`guided:${key}`,{db,b,budgetMicros:0,weeklyIncrease:0,single:true});
   const id=randomUUID();await db.query('INSERT INTO app.guided_campaigns(id,organization_id,brand_id,moodboard_id,planning_job_id,created_by,request_key,request_hash,planning_request) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,b.organization_id,brand,board,job.id,user,key,fingerprint,JSON.stringify(planningRequest)]);return {id};
  });
 }
 approvePlan(user:string,brand:string,id:string,body:unknown){
  id=uuid(id);const v=object(body,['slots','video_references']);
  const requestedVideos=v.video_references??[];
  if(!Array.isArray(requestedVideos)||requestedVideos.length>5)throw new BadRequestException('Choose up to five video starting images');
  if(!Array.isArray(v.slots)||!v.slots.length||v.slots.length>60)throw new BadRequestException('Review the saved plan before approving');
  const supplied=v.slots.map(raw=>{const s=object(raw,['id','revision']);if(!Number.isSafeInteger(s.revision)||Number(s.revision)<1)throw new BadRequestException('Invalid post revision');return {id:uuid(String(s.id)),revision:Number(s.revision)};}).sort((a,b)=>a.id.localeCompare(b.id));
  return this.planning.plans.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided-generation:${id}`]);
   const row=(await db.query(`SELECT g.*,r.output_plan_id FROM app.guided_campaigns g JOIN app.planning_requests r ON r.job_id=g.planning_job_id JOIN app.jobs j ON j.id=g.planning_job_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND g.id=$3 AND j.status='succeeded' FOR UPDATE OF g`,[b.organization_id,brand,id])).rows[0];
   if(!row)throw new NotFoundException('Monthly plan ready for review not found');
   if(row.generation_started_at)return {id};
   const saved=(await db.query('SELECT id,revision,format FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND plan_id=$3 ORDER BY id FOR UPDATE',[b.organization_id,brand,row.output_plan_id])).rows as {id:string;revision:number;format:string}[];
   const slots=saved.map(({id,revision})=>({id,revision}));
   if(canonicalJSON(slots)!==canonicalJSON(supplied))throw new ConflictException('Your plan changed. Review the latest topics and dates before approving.');
   // Refuse approval with exact counts rather than failing part-way through generation.
   const short=allowanceMessage(allowanceShortfalls((await db.query('SELECT app.content_allowances($1) AS value',[b.organization_id])).rows[0]?.value?.items,{...formatCounts(saved),video:requestedVideos.length}));
   if(short)throw new ConflictException(short);
   const videoReferences:{id:string;revision:number;reference:Record<string,unknown>}[]=[];
   for(const raw of requestedVideos){
    const selected=object(raw,['id','reference']);const slotId=uuid(String(selected.id));
    if(videoReferences.some(item=>item.id===slotId))throw new BadRequestException('Choose each video once');
    const slot=(await db.query("SELECT id,revision FROM app.content_slots WHERE plan_id=$1 AND id=$2 AND format='video'",[row.output_plan_id,slotId])).rows[0];
    if(!slot)throw new BadRequestException('Choose a video from this calendar');
    const ref=object(selected.reference,['brand_reference_id','source_sha256','confirmed']);
    const proof=(await db.query(uploadedVideoProofSQL,[uuid(String(ref.brand_reference_id))])).rows[0];
    if(ref.confirmed!==true||!proof||proof.revoked_at||proof.crop||proof.width<64||proof.height<64||proof.sha256!==ref.source_sha256)throw new ConflictException('Choose a current approved, uncropped starting image for your video');
    if(!(await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[b.organization_id,brand])).rows[0].allowed)throw new ConflictException('A business owner or admin must approve video generation');
    videoReferences.push({...slot,reference:ref});
   }
   await db.query('UPDATE app.guided_campaigns SET video_references=$2,video_error=NULL WHERE id=$1',[id,JSON.stringify(videoReferences)]);
   await db.query('UPDATE app.guided_campaigns SET plan_approved_at=now(),plan_approved_by=$2,approved_slots=$3,last_error=NULL WHERE id=$1',[id,user,JSON.stringify(slots)]);
   // A repeated approval of the same reviewed plan is the same decision, not a new one.
   if(!row.plan_approved_at)await recordSignal(db,{organizationId:b.organization_id,brandId:brand,actorId:user},{kind:'approved',subject_kind:'plan',subject_id:id});
   return {id};
  });
 }
 async runOnce(){
  if(this.running)return;this.running=true;
  try{const candidates=(await this.planning.plans.businesses.database.pool.query('SELECT * FROM app.pending_guided_campaigns()')).rows;
   for(const candidate of candidates){try{await this.advance(candidate.created_by,candidate.brand_id,candidate.id);}catch{/* The saved campaign exposes a safe error; no external request is blindly repeated. */}}
   if(this.videos){const queued=(await this.planning.plans.businesses.database.pool.query('SELECT * FROM app.pending_monthly_videos()')).rows;for(const item of queued){try{await this.videos.advance(item.approved_by,item.brand_id,item.id);}catch{/* Access is rechecked on every attempt. */}}}
   await this.releaseScheduled();
  }finally{this.running=false;}
 }
 /** Start posts that were scheduled for a later day to stay inside the daily image cap.
  * Access is rechecked for the original requester; a failed release waits before retrying. */
 private async releaseScheduled(){
  const now=Date.now();
  if(now-this.scheduleScannedAt<SCHEDULE_SCAN_MS)return;
  this.scheduleScannedAt=now;
  const due=(await this.planning.plans.businesses.database.pool.query('SELECT * FROM app.pending_scheduled_generation()')).rows as {brand_id:string;plan_id:string;requested_by:string}[];
  for(const item of due){
   const key=`${item.brand_id}:${item.plan_id}`;
   if((this.releaseRetryAt.get(key)??0)>now)continue;
   try{await this.creatives.releaseScheduled(item.requested_by,item.brand_id,item.plan_id);this.releaseRetryAt.delete(key);}
   catch{this.releaseRetryAt.set(key,now+RELEASE_RETRY_MS);/* The posts stay scheduled and visible; nothing is charged. */}
  }
 }
 async advance(user:string,brand:string,id:string){
  try{
  const state=await this.planning.plans.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided-generation:${id}`]);
   const row=(await db.query(`SELECT g.*,r.output_plan_id FROM app.guided_campaigns g JOIN app.planning_requests r ON r.job_id=g.planning_job_id JOIN app.jobs j ON j.id=r.job_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND g.id=$3 AND j.status='succeeded'`,[b.organization_id,brand,id])).rows[0];
   if(!row||!row.plan_approved_at||row.generation_started_at||row.last_error)return null;
   const committed=(await db.query('SELECT 1 FROM app.campaign_image_batches WHERE organization_id=$1 AND brand_id=$2 AND request_key=$3',[b.organization_id,brand,`guided-campaign:${id}`])).rowCount;
   // Replay a committed batch unchanged if the response was lost. Before submission,
   // edits invalidate approval and any cached request so the next review can recover.
   const slots=(await db.query('SELECT id,revision FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND plan_id=$3 ORDER BY id',[b.organization_id,brand,row.output_plan_id])).rows;
   if(!committed&&canonicalJSON(slots)!==canonicalJSON(row.approved_slots)){await db.query('UPDATE app.guided_campaigns SET plan_approved_at=NULL,plan_approved_by=NULL,approved_slots=NULL,generation_request=NULL,attempted_at=NULL WHERE id=$1',[id]);return null;}
   if(row.generation_request){await db.query('UPDATE app.guided_campaigns SET attempted_at=now() WHERE id=$1',[id]);return {row,request:row.generation_request};}
   const quote=await this.creatives.generationQuote(db,b.organization_id,brand,row.output_plan_id);
   if(!quote.available||!slots.length)throw new ConflictException('Campaign generation setup needs attention');
   const request={slots,automatic:true,credit_cap:Math.max(1,quote.slots.reduce((n:number,s:any)=>n+s.credits,0))};
   await db.query('UPDATE app.guided_campaigns SET attempted_at=now(),generation_request=$2 WHERE id=$1',[id,JSON.stringify(request)]);
   return {row,request};
  });
  if(!state)return;
   await this.creatives.generateBatch(user,brand,state.row.output_plan_id,state.request,`guided-campaign:${id}`);
   await this.planning.plans.scope(user,brand,true,db=>db.query('UPDATE app.guided_campaigns SET generation_started_at=COALESCE(generation_started_at,now()),last_error=NULL WHERE id=$1',[id]));
  }catch(e){await this.planning.plans.scope(user,brand,true,db=>db.query('UPDATE app.guided_campaigns SET last_error=$2 WHERE id=$1',[id,e instanceof ConflictException?e.message:'Campaign generation could not start. Your plan is saved.']));throw e;}
 }
 retry(user:string,brand:string,id:string){id=uuid(id);return this.planning.plans.scope(user,brand,true,async(db,b)=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${brand}`]);
  const row=(await db.query(`SELECT g.*,j.status FROM app.guided_campaigns g JOIN app.jobs j ON j.id=g.planning_job_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND g.id=$3 FOR UPDATE OF g`,[b.organization_id,brand,id])).rows[0];
  if(!row)throw new NotFoundException('Content plan not found');
  if(row.generation_started_at){await db.query('UPDATE app.guided_campaigns SET video_error=NULL WHERE id=$1',[id]);return {id};}
  if(['failed','rejected','canceled'].includes(row.status)){
   const job=await this.planning.submit(user,brand,row.planning_request,`guided-retry:${row.planning_job_id}`,{db,b,budgetMicros:0,weeklyIncrease:0,single:true});
   await db.query('UPDATE app.guided_campaigns SET planning_job_id=$2,last_error=NULL,attempted_at=NULL,generation_request=NULL WHERE id=$1',[id,job.id]);
   await recordSignal(db,{organizationId:b.organization_id,brandId:brand,actorId:user},{kind:'retried',subject_kind:'plan',subject_id:id,reason:'Asked for the monthly plan again after it failed'});
  }else if(row.status==='succeeded')await db.query('UPDATE app.guided_campaigns SET last_error=NULL,attempted_at=NULL WHERE id=$1',[id]);
  else if(row.status==='unknown')throw new ConflictException('We are checking the previous request before retrying');
  return {id};
 });}
}
