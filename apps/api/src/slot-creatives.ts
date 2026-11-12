import {requireMonthlyPlanApproval,approvedDirection,directionPromptContext,type ApprovedDirection} from './monthly-plan-approval.js';
import {imagePlanningRates} from './creative-planning.js';
import {normalizeCreativeSpec,creativeSourceSize} from './campaign-formats.js';
import type {CarouselGeneration} from './carousel-generation.js';
import {imageGenerationCapacity,planningGenerationCapacity,scheduleBatch,allowanceShortfalls,allowanceMessage,type AllowanceKind} from './creative-budget.js';
import {campaignRefinementDirection} from './campaign-refinement.js';
import type {PoolClient} from 'pg';
import {campaignDesignDirection,campaignCreativeContext,CAMPAIGN_CREATIVE_PREFIX} from './campaign-design.js';
import {creativeTextProvider} from "./creative-planning.js";
import {recordSignal} from './learning-signals.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ContentPlan } from "./content-plan.js";
import { Canvas } from "./canvas.js";
import { canonicalJSON, hash } from "./brand-brain.js";
import { object, uuid } from "./workspaces.js";
export class SlotCreatives {
  constructor(
    readonly plans: ContentPlan,
    readonly canvas: Canvas,
    readonly carousels?: CarouselGeneration,
  ) {}
  generate(
    user: string,
    id: string,
    slotId: string,
    body: unknown,
    key: unknown,
    scoped?: {db:PoolClient;b:{organization_id:string};batchJobIds:string[];direction?:ApprovedDirection|null},
  ) {
    slotId = uuid(slotId);
    const v = object(body, ["revision", "feedback", "size", "reset_approval", "text_provider", "reference_ids", "max_cost_micros"]);
    if (
      !Number.isSafeInteger(v.revision) ||
      Number(v.revision) < 1 ||
      Number(v.revision) >= 2147483647 ||
      typeof key !== "string" ||
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)
    )
      throw new BadRequestException(
        "Include the saved revision and request key",
      );
    if(v.max_cost_micros!==undefined&&(!Number.isSafeInteger(v.max_cost_micros)||Number(v.max_cost_micros)<1||Number(v.max_cost_micros)>1000000000))throw new BadRequestException("Use a positive request budget");
    if(v.reference_ids!==undefined&&(!Array.isArray(v.reference_ids)||v.reference_ids.length>3))throw new BadRequestException("Choose up to three approved references");
    const referenceIds=(v.reference_ids??[]).map((r:unknown)=>uuid(String(r)));
    if(new Set(referenceIds).size!==referenceIds.length)throw new BadRequestException("Choose each reference once");
    const textProvider=creativeTextProvider(v.text_provider);
    const feedback = v.feedback ?? "";
    if (
      typeof feedback !== "string" ||
      feedback.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(feedback) ||
      (v.size !== undefined &&
        !["1024x1024", "1536x1024", "1024x1536"].includes(String(v.size))) ||
      (v.reset_approval !== undefined && typeof v.reset_approval !== "boolean")
    )
      throw new BadRequestException(
        "Check the feedback, image size and approval confirmation",
      );
    const sha = hash(
      canonicalJSON({
        user,
        slotId,
        revision: v.revision,
        feedback,
        size: v.size ?? null,
        reset_approval: v.reset_approval ?? false,
        ...(v.max_cost_micros!==undefined?{max_cost_micros:v.max_cost_micros}:{}),
        ...(v.reference_ids!==undefined?{reference_ids:referenceIds}:{}),
        ...(textProvider==='gemini'?{text_provider:textProvider}:{}),
      }),
    );
    const action=async (db:PoolClient, b:{organization_id:string}) => {
      const prior = (
        await db.query(
          "SELECT g.request_hash,j.id,j.status,r.thread_id FROM app.content_slot_generations g JOIN app.jobs j ON j.id=g.job_id JOIN app.creative_requests r ON r.job_id=j.id WHERE g.organization_id=$1 AND g.brand_id=$2 AND g.request_key=$3",
          [b.organization_id, id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== sha)
          throw new ConflictException(
            "That request key belongs to another creative request",
          );
        return {
          id: prior.id,
          status: prior.status,
          thread_id: prior.thread_id,
        };
      }
      const s = (
        await db.query(
          "SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [b.organization_id, id, slotId],
        )
      ).rows[0];
      if (!s) throw new NotFoundException("Content slot not found");
      await requireMonthlyPlanApproval(db,b.organization_id,id,s);
      if (s.format === "carousel") throw new BadRequestException("Edit carousel slides in Canvas and attach the revised carousel");
      if (s.format === "video") throw new BadRequestException("Revise videos in Canvas and approve the new prompt before generation");
      if (s.revision !== v.revision)
        throw new ConflictException(
          "This post changed. Reload before creating",
        );
      if (s.state === "cancelled")
        throw new ConflictException("This content slot was cancelled");
      if (s.state === "approved" && v.reset_approval !== true)
        throw new ConflictException(
          "Confirm that revising this approved post requires a new review",
        );
      const note =
        (
          await db.query(
            "SELECT feedback FROM app.content_slot_events WHERE slot_id=$1 AND action IN ('changes_requested','rejected') ORDER BY revision DESC LIMIT 1",
            [slotId],
          )
        ).rows[0]?.feedback ?? "";
      const selectedReferences=v.reference_ids===undefined?(s.reference_ids??[]):referenceIds;
      const campaign = (await db.query('SELECT strategy FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,s.plan_id])).rows[0]?.strategy?.campaign;
      const spec=s.creative_spec==null?null:normalizeCreativeSpec(s.creative_spec,s.format,s.channel);
      const request = {
          brief: s.brief,
          ...(spec?{creative_spec:spec}:{}),
          campaign_context: campaignCreativeContext(campaign),
          campaign_design: campaign?.design,
          design_direction: campaignDesignDirection(campaign?.design),
          campaign_preferences: campaignRefinementDirection(campaign?.refinement),
          pillar: s.pillar,
          hook: s.hook,
          cta: s.cta,
          review_feedback: ["changes_requested", "rejected"].includes(s.state)
            ? note
            : "",
          user_feedback: feedback,
        };
      // The approved mood board and saved creative brief guide every asset, below
      // approved brand facts. They shrink to fit rather than failing a long brief.
      const direction = scoped?.direction!==undefined ? scoped.direction : await approvedDirection(db,b.organization_id,id);
      const approved = directionPromptContext(direction,4000-CAMPAIGN_CREATIVE_PREFIX.length-JSON.stringify(request).length-'"approved_direction":,'.length);
      const prompt = CAMPAIGN_CREATIVE_PREFIX + JSON.stringify(approved?{...request,approved_direction:approved}:request);
      if (prompt.length > 4000)
        throw new BadRequestException(
          "Shorten the brief or feedback before creating this image",
        );
      let thread: string,
        size = String(spec?creativeSourceSize(spec):(v.size ?? "1024x1024"));
      if(spec&&v.size!==undefined&&v.size!==size)throw new BadRequestException("Keep the saved post aspect when generating");
      if (s.creative_version_id) {
        const current = (
          await db.query(
            "SELECT p.thread_id,m.width,m.height FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1",
            [s.creative_version_id],
          )
        ).rows[0];
        if (!current) throw new NotFoundException("Creative version not found");
        thread = current.thread_id;
        const original = `${current.width}x${current.height}`;
        if (!spec && v.size !== undefined && size !== original)
          throw new BadRequestException(
            "Keep the current image dimensions when revising",
          );
        if(!spec)size = original;
      } else {
        const t = await this.canvas.createThread(
          user,
          id,
          { title: s.brief.slice(0, 140) },
          `slot-thread:${sha}`,
          { db, b },
        );
        thread = t.id;
      }
      const result = await this.canvas.submit(
        user,
        id,
        thread,
        {
          prompt,
          format: s.format,
          channel: s.channel,
          size,
          ...(spec?{creative_spec:spec}:{}),
          parent_version_id: s.creative_version_id,
          text_provider:textProvider,
          ...(v.max_cost_micros!==undefined?{max_cost_micros:v.max_cost_micros}:{}),
          ...(selectedReferences.length?{reference_ids:selectedReferences}:{}),
        },
        `slot-job:${sha}`,
        { db, b, batchJobIds:scoped?.batchJobIds, recordSignal:false },
      );
      const changed = (
        await db.query(
          "UPDATE app.content_slots SET state=$2,revision=revision+1,approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=$1 RETURNING *",
          [slotId, s.creative_version_id ? "draft_ready" : "content_needed"],
        )
      ).rows[0];
      await this.plans.event(
        db,
        user,
        changed,
        "generation_requested",
        feedback,
      );
      await db.query(
        "INSERT INTO app.content_slot_generations(job_id,organization_id,brand_id,slot_id,source_revision,feedback,request_key,request_hash,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          result.id,
          b.organization_id,
          id,
          slotId,
          changed.revision,
          feedback,
          key,
          sha,
          user,
        ],
      );
      // Asking for a new image, or giving direction for one, says the previous result was not right yet.
      if (s.creative_version_id || feedback)
        await recordSignal(db,{organizationId:b.organization_id,brandId:id,actorId:user},{kind:"regenerated",slot_id:slotId,creative_version_id:s.creative_version_id??null,version_kind:s.creative_version_id?"creative":null,reason:feedback,context:{format:s.format,channel:s.channel,pillar:s.pillar}});
      return { ...result, thread_id: thread };
    };
    return scoped?action(scoped.db,scoped.b):this.plans.scope(user,id,true,action);
  }
  async generationQuote(db:PoolClient,org:string,id:string,planId:string){
    const grant=(await db.query('SELECT max_image_request_micros,input_micros_per_token,output_micros_per_token FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[org,id])).rows[0];
    const rows=(await db.query("SELECT id,revision,format,creative_spec,cardinality(reference_ids) AS references FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND plan_id=$3 AND format IN ('static','carousel','video') AND state='content_needed' AND creative_version_id IS NULL AND video_version_id IS NULL AND carousel_version_id IS NULL ORDER BY planned_at,id",[org,id,planId])).rows;
    if(!grant&&rows.some(s=>s.format!=='video'))return {available:false,slots:[] as {id:string;revision:number;credits:number;planning_credits?:number}[]};
    return {available:true,slots:rows.map((s):{id:string;revision:number;credits:number;planning_credits?:number}=>{
      if(s.format==='video')return {id:s.id,revision:s.revision,credits:0};
      const image=imageGenerationCapacity({...grant,...imagePlanningRates(402048)},s.references).credits;
      if(s.format==='carousel'){
        const count=s.creative_spec?.slide_count;
        if(!Number.isInteger(count)||count<2||count>10)throw new ConflictException('Choose the carousel slide count before continuing');
        const planning=planningGenerationCapacity(imagePlanningRates(402048));
        return {id:s.id,revision:s.revision,credits:planning+count*image,planning_credits:planning};
      }
      return {id:s.id,revision:s.revision,credits:image};
    })};
  }
  private async batchJobs(db:PoolClient,org:string,id:string,planId:string,key?:string){
    return (await db.query(`SELECT DISTINCT ON (slot_id) * FROM (
      SELECT g.slot_id,j.id,CASE WHEN j.status='succeeded' AND g.attachment_status='needs_attachment' THEN 'needs_attachment' ELSE j.status END AS status,j.error_code,g.created_at,NULL::timestamptz AS scheduled_for FROM app.content_slot_generations g JOIN app.jobs j ON j.id=g.job_id JOIN app.content_slots s ON s.id=g.slot_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND s.plan_id=$3 AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM app.campaign_image_batches b WHERE b.organization_id=$1 AND b.brand_id=$2 AND b.request_key=$4 AND j.id=ANY(b.job_ids)))
      UNION ALL
      SELECT i.slot_id,COALESCE(j.id,v.id,i.slot_id) AS id,COALESCE(CASE WHEN j.status='succeeded' AND COALESCE(sg.attachment_status,cg.attachment_status)='needs_attachment' THEN 'needs_attachment' ELSE j.status END,CASE WHEN v.status='succeeded' AND s.video_version_id IS DISTINCT FROM v.output_version_id THEN 'needs_attachment' ELSE v.status END,CASE WHEN s.revision<>i.source_revision AND i.job_id IS NULL THEN 'review_changed' ELSE i.state END) AS status,COALESCE(j.error_code,v.error_code) AS error_code,b.created_at,i.scheduled_for FROM app.campaign_batch_items i JOIN app.campaign_image_batches b ON b.organization_id=i.organization_id AND b.brand_id=i.brand_id AND b.request_key=i.request_key JOIN app.content_slots s ON s.id=i.slot_id LEFT JOIN app.jobs j ON j.id=i.job_id LEFT JOIN app.content_slot_generations sg ON sg.job_id=i.job_id LEFT JOIN app.content_slot_carousel_generations cg ON cg.job_id=i.job_id LEFT JOIN LATERAL (SELECT j.id,j.status,j.error_code,r.output_version_id FROM app.video_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.slot_id=i.slot_id AND i.format='video' AND r.slot_revision>=i.source_revision ORDER BY j.created_at DESC LIMIT 1) v ON true WHERE i.organization_id=$1 AND i.brand_id=$2 AND b.plan_id=$3 AND ($4::text IS NULL OR i.request_key=$4)
      ) attempts ORDER BY slot_id,created_at DESC,id DESC`,[org,id,planId,key??null])).rows;
  }
  /** `release` is server-only: it resumes posts that were scheduled for a later day
   * with the budgets approved in their original batch. */
  generateBatch(user:string,id:string,planId:string,body:unknown,key:unknown,release?:{budgets:Map<string,{max:number|null;planning:number|null}>}){
    planId=uuid(planId);
    const v=object(body,['slots','credit_cap','automatic','retry_failed']);
    if(v.automatic!==undefined&&typeof v.automatic!=='boolean')throw new BadRequestException('Invalid automatic generation setting');
    if(v.retry_failed!==undefined&&typeof v.retry_failed!=='boolean')throw new BadRequestException('Invalid retry setting');
    if(v.retry_failed&&v.automatic)throw new BadRequestException('Retry failed posts with an explicit request, not automatically');
    if(v.automatic&&v.credit_cap===undefined)throw new BadRequestException('Automatic creation requires the current generation credit cap');
    if(v.retry_failed&&v.credit_cap===undefined)throw new BadRequestException('Retrying failed posts requires the current generation credit cap');
    if(v.credit_cap!==undefined&&(!Number.isSafeInteger(v.credit_cap)||Number(v.credit_cap)<1||Number(v.credit_cap)>100000))throw new BadRequestException('Choose a whole-number generation credit cap');
    if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key)||!Array.isArray(v.slots)||v.slots.length<1||v.slots.length>90)throw new BadRequestException('Choose between 1 and 90 saved posts');
    const slots=v.slots.map((value:unknown)=>{const s=object(value,['id','revision']);if(!Number.isSafeInteger(s.revision)||Number(s.revision)<1)throw new BadRequestException('Include each saved post revision');return {id:uuid(String(s.id)),revision:Number(s.revision)};});
    if(new Set(slots.map(s=>s.id)).size!==slots.length)throw new BadRequestException('Choose each post once');
    const sha=hash(canonicalJSON({...(!v.automatic?{user}:{}),planId,slots,...(v.automatic?{automatic:true}:{}),...(v.retry_failed?{retry_failed:true}:{}),...(v.credit_cap!==undefined?{credit_cap:v.credit_cap}:{})}));
    return this.plans.scope(user,id,true,async(db,b)=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`campaign-batch:${id}:${key}`]);
      const prior=(await db.query('SELECT request_hash FROM app.campaign_image_batches WHERE organization_id=$1 AND brand_id=$2 AND request_key=$3',[b.organization_id,id,key])).rows[0];
      if(prior){if(prior.request_hash!==sha)throw new ConflictException('That request key belongs to another campaign request');return {jobs:await this.batchJobs(db,b.organization_id,id,planId,key)};}
      const previous=await this.batchJobs(db,b.organization_id,id,planId);
      const last=(slot:string)=>String(previous.find(j=>j.slot_id===slot)?.status??'');
      if(release){if(slots.some(s=>last(s.id)!=='scheduled'))throw new ConflictException('A scheduled post changed. Check its saved progress.');}
      else if(v.retry_failed){
        // An uncertain provider outcome may still be charged: it is released only through Stop waiting.
        if(slots.some(s=>last(s.id)==='unknown'))throw new ConflictException('A selected post is still waiting on the provider. Use Stop waiting on that post before retrying.');
        if(slots.some(s=>!['failed','rejected','canceled'].includes(last(s.id))))throw new ConflictException('Only posts whose last attempt failed or was stopped can be retried. Refresh your campaign.');
      }
      else if(v.automatic){if(previous.some(j=>slots.some(s=>s.id===j.slot_id)))throw new ConflictException('A selected image already has a generation attempt. Check its saved progress before retrying.');}
      else if(slots.some(s=>last(s.id)==='scheduled'))throw new ConflictException('A selected post is already scheduled or in progress. Check its saved progress.');
      const saved=(await db.query('SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND plan_id=$3 AND id=ANY($4::uuid[])',[b.organization_id,id,planId,slots.map(s=>s.id)])).rows;
      if(saved.length!==slots.length)throw new NotFoundException('Campaign posts not found');
      for(const slot of saved)await requireMonthlyPlanApproval(db,b.organization_id,id,slot);
      for(const slot of slots){const s=saved.find(s=>s.id===slot.id);if(s.revision!==slot.revision||!['static','carousel','video'].includes(s.format)||s.state!=='content_needed'||s.creative_version_id||s.video_version_id||s.carousel_version_id)throw new ConflictException('A selected post changed or already has content. Refresh your campaign.');}
      if(!release&&saved.some(s=>s.format!=='static')&&v.credit_cap===undefined)throw new BadRequestException('Review the generation credit cap before continuing');
      if(v.automatic&&saved.some(s=>s.format==='video')&&!(await db.query(`SELECT g.id FROM app.guided_campaigns g JOIN app.planning_requests r ON r.job_id=g.planning_job_id WHERE g.organization_id=$1 AND g.brand_id=$2 AND r.output_plan_id=$3 AND g.plan_approved_at IS NOT NULL`,[b.organization_id,id,planId])).rowCount)throw new BadRequestException('Approve the monthly calendar before preparing video posts');
      const quote=await this.generationQuote(db,b.organization_id,id,planId);
      const selected=slots.map(s=>quote.slots.find(q=>q.id===s.id&&q.revision===s.revision));
      if(v.credit_cap!==undefined){if(!quote.available)throw new ConflictException('Generation is not configured for this brand');if(selected.some(q=>!q))throw new ConflictException('The reviewed posts changed. Review them again.');const minimum=selected.reduce((n,q)=>n+q!.credits,0);if(Number(v.credit_cap)<minimum)throw new ConflictException(`Generation requires a capacity of at least ${minimum} credits. Refresh the quote before continuing.`);}
      // Say exactly what the monthly allowance cannot cover before anything is queued,
      // instead of letting the reservation trigger roll the whole batch back at commit.
      const wanted:Partial<Record<AllowanceKind,number>>={static:saved.filter(s=>s.format==='static').length,carousel:saved.filter(s=>s.format==='carousel').length};
      const quota=(await db.query('SELECT app.content_allowances($1) AS value',[b.organization_id])).rows[0]?.value;
      const short=allowanceMessage(allowanceShortfalls(quota?.items,wanted));
      if(short)throw new ConflictException(short);
      // Reserve the whole batch against the daily caps once. Posts that do not fit
      // today wait for a following day; nothing is rejected or rolled back.
      const usage=(await db.query("SELECT (SELECT count(*)::int FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='creative.generate' AND created_at>now()-interval '1 day') AS images,(SELECT count(*)::int FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='creative.export' AND created_at>now()-interval '1 day') AS exports",[b.organization_id,id])).rows[0];
      const byDate=[...saved].sort((a,c)=>String(a.planned_at??'').localeCompare(String(c.planned_at??''))||String(a.id).localeCompare(String(c.id)));
      let placements;
      try{placements=scheduleBatch(byDate.map(s=>{const slides=s.format==='carousel'?Number(s.creative_spec?.slide_count):0;return {id:String(s.id),images:s.format==='static'?1:slides,exports:slides};}),{images:Number(usage?.images??0),exports:Number(usage?.exports??0)});}
      catch{throw new ConflictException('Choose the carousel slide count before continuing');}
      const waitDays=new Map(placements.map(p=>[p.id,p.day]));
      const direction=await approvedDirection(db,b.organization_id,id);
      const jobIds:string[]=[],items:{slot:any;job:string|null;scheduled:Date|null;max:number|null;planning:number|null}[]=[];
      const paid=selected.filter(q=>q&&q.credits>0).length,minimum=selected.reduce((n,q)=>n+(q?.credits??0),0),extra=paid?Math.floor((Number(v.credit_cap??minimum)-minimum)/paid):0;
      for(const slot of slots){const s=saved.find(s=>s.id===slot.id),q=selected.find(q=>q?.id===s.id),spec=s.creative_spec==null?null:normalizeCreativeSpec(s.creative_spec,s.format,s.channel);
        if(s.format==='video'){items.push({slot:s,job:null,scheduled:null,max:null,planning:null});continue;}
        const budget=release?.budgets.get(slot.id);
        const maxCost=release?budget?.max??undefined:v.credit_cap===undefined?undefined:(q!.credits+extra)*10000;
        const planningCost=release?budget?.planning??undefined:q?.planning_credits===undefined?undefined:q.planning_credits*10000;
        const wait=waitDays.get(slot.id)??0;
        // Five minutes past the rolling day, so yesterday's images have left the window.
        if(wait>0){items.push({slot:s,job:null,scheduled:new Date(Date.now()+wait*86400000+300000),max:maxCost??null,planning:planningCost??null});continue;}
        const requestKey=`campaign-image:${hash(`${key}:${slot.id}`)}`;
        const result=s.format==='static'?await this.generate(user,id,slot.id,{revision:slot.revision,...(maxCost!==undefined?{max_cost_micros:maxCost}:{})},requestKey,{db,b,batchJobIds:jobIds,direction}):await (async()=>{
          if(!this.carousels||!spec)throw new ConflictException('Carousel generation is unavailable');
          return this.carousels.submit(user,id,{prompt:s.brief,channel:s.channel,size:creativeSourceSize(spec),slide_count:spec.slide_count,creative_spec:spec,slot_id:s.id,slot_revision:s.revision,campaign_plan_id:planId,reference_ids:s.reference_ids??[],max_cost_micros:maxCost,planning_cost_micros:planningCost},requestKey,{db,b,batchJobIds:jobIds,direction});
        })();jobIds.push(result.id);items.push({slot:s,job:result.id,scheduled:null,max:null,planning:null});
      }
      const reviewed=slots.map(slot=>{const spec=saved.find(s=>s.id===slot.id).creative_spec;return {...slot,...(spec?{creative_spec:spec}:{})};});
      await db.query('INSERT INTO app.campaign_image_batches(organization_id,brand_id,plan_id,request_key,request_hash,job_ids,requested_by,reviewed_slots,credit_cap) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[b.organization_id,id,planId,key,sha,jobIds,user,JSON.stringify(reviewed),v.credit_cap??null]);
      for(const item of items)await db.query('INSERT INTO app.campaign_batch_items(organization_id,brand_id,request_key,slot_id,source_revision,creative_spec,format,job_id,state,scheduled_for,max_cost_micros,planning_cost_micros) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[b.organization_id,id,key,item.slot.id,item.slot.revision,item.slot.creative_spec==null?null:JSON.stringify(item.slot.creative_spec),item.slot.format,item.job,item.job?'queued':item.scheduled?'scheduled':'awaiting_approval',item.scheduled?item.scheduled.toISOString():null,item.scheduled?item.max:null,item.scheduled?item.planning:null]);
      // A retry of failed posts is a decision too: the customer still wants these posts as planned.
      if(v.retry_failed)for(const s of saved)await recordSignal(db,{organizationId:b.organization_id,brandId:id,actorId:user},{kind:'retried',slot_id:s.id,reason:'Retried after generation failed',context:{format:s.format,channel:s.channel,pillar:s.pillar}});
      return {jobs:await this.batchJobs(db,b.organization_id,id,planId,key)};
    });
  }
  /** Start posts whose scheduled day has arrived. The key is derived from the waiting
   * items, so a repeated scan replays the same batch instead of queuing twice. */
  async releaseScheduled(user:string,id:string,planId:string):Promise<{released:number}>{
    planId=uuid(planId);
    const due=await this.plans.scope(user,id,false,async(db,b)=>(await db.query(`SELECT i.slot_id,i.source_revision,i.max_cost_micros,i.planning_cost_micros,i.request_key
      FROM app.campaign_batch_items i JOIN app.campaign_image_batches b ON b.organization_id=i.organization_id AND b.brand_id=i.brand_id AND b.request_key=i.request_key JOIN app.content_slots s ON s.id=i.slot_id
      WHERE i.organization_id=$1 AND i.brand_id=$2 AND b.plan_id=$3 AND i.state='scheduled' AND i.scheduled_for<=now() AND s.revision=i.source_revision AND s.state='content_needed'
      AND s.creative_version_id IS NULL AND s.carousel_version_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM app.campaign_batch_items n JOIN app.campaign_image_batches nb ON nb.organization_id=n.organization_id AND nb.brand_id=n.brand_id AND nb.request_key=n.request_key WHERE n.slot_id=i.slot_id AND nb.created_at>b.created_at)
      ORDER BY s.planned_at,s.id`,[b.organization_id,id,planId])).rows as {slot_id:string;source_revision:number;max_cost_micros:string|null;planning_cost_micros:string|null;request_key:string}[]);
    if(!due.length)return {released:0};
    const budgets=new Map(due.map(d=>[d.slot_id,{max:d.max_cost_micros==null?null:Number(d.max_cost_micros),planning:d.planning_cost_micros==null?null:Number(d.planning_cost_micros)}]));
    await this.generateBatch(user,id,planId,{slots:due.map(d=>({id:d.slot_id,revision:d.source_revision}))},`scheduled:${hash(canonicalJSON(due.map(d=>[d.request_key,d.slot_id])))}`,{budgets});
    return {released:due.length};
  }
  batchStatus(user:string,id:string,planId:string){
    planId=uuid(planId);
    return this.plans.scope(user,id,false,async(db,b)=>{
      if(!(await db.query('SELECT id FROM app.content_plans WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,planId])).rowCount)throw new NotFoundException('Campaign not found');
      const batch=(await db.query('SELECT request_key,job_ids,reviewed_slots,credit_cap FROM app.campaign_image_batches WHERE organization_id=$1 AND brand_id=$2 AND plan_id=$3 ORDER BY created_at DESC,request_key LIMIT 1',[b.organization_id,id,planId])).rows[0];
      const allowance=(await db.query('SELECT app.content_allowances($1) AS value',[b.organization_id])).rows[0]?.value??null;
      return {quote:await this.generationQuote(db,b.organization_id,id,planId),allowance,...(batch?{request_key:batch.request_key,reviewed_slots:batch.reviewed_slots,credit_cap:batch.credit_cap}:{}),jobs:await this.batchJobs(db,b.organization_id,id,planId)};
    });
  }
  detail(user: string, id: string, slotId: string) {
    slotId = uuid(slotId);
    return this.plans.scope(user, id, false, async (db, b) => {
      const slot = (
        await db.query(
          `SELECT s.*,p.title AS plan_title,p.timezone,p.objective,p.starts_on::text,v.design,COALESCE(v.caption,vv.caption,cv.caption) AS caption,v.skill_manifest,v.media_id,COALESCE(v.project_id,vv.project_id,cv.project_id) AS project_id,COALESCE(c.thread_id,vp.thread_id) AS thread_id,COALESCE(c.latest_version_id,vp.latest_version_id,cp.latest_version_id) AS latest_version_id,cv.status AS carousel_status,(CASE WHEN s.format='carousel' THEN cp.latest_version_id<>cv.id WHEN s.format='video' THEN vp.latest_version_id<>vv.id ELSE c.latest_version_id<>v.id END) AS has_newer_version
   FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id LEFT JOIN app.creative_versions v ON v.id=s.creative_version_id LEFT JOIN app.creative_projects c ON c.id=v.project_id LEFT JOIN app.video_versions vv ON vv.id=s.video_version_id LEFT JOIN app.video_projects vp ON vp.id=vv.project_id LEFT JOIN app.carousel_versions cv ON cv.id=s.carousel_version_id LEFT JOIN app.carousel_projects cp ON cp.id=cv.project_id
   WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.id=$3`,
          [b.organization_id, id, slotId],
        )
      ).rows[0];
      if (!slot) throw new NotFoundException("Content slot not found");
      if(slot.format==='carousel'&&slot.carousel_version_id){try{await this.plans.carousel(db,b.organization_id,id,slot.carousel_version_id,slot.channel);}catch(e){if(e instanceof ConflictException||e instanceof NotFoundException)slot.has_newer_version=true;else throw e;}}
      const events = (
        await db.query(
          "SELECT revision,action,actor_id,creative_version_id,creative_sha256,video_version_id,video_sha256,carousel_version_id,carousel_sha256,feedback,snapshot,created_at FROM app.content_slot_events WHERE slot_id=$1 ORDER BY revision",
          [slotId],
        )
      ).rows;
      const generations = (
        await db.query(
          "SELECT g.job_id,g.source_revision,g.attachment_status,g.attached_version_id,g.feedback,j.status,j.error_code,j.cancel_requested,r.thread_id,r.project_id,r.output_version_id FROM app.content_slot_generations g JOIN app.jobs j ON j.id=g.job_id JOIN app.creative_requests r ON r.job_id=j.id WHERE g.slot_id=$1 ORDER BY g.created_at DESC,g.job_id",
          [slotId],
        )
      ).rows;
      const videos=(await db.query('SELECT r.job_id,r.slot_revision,r.project_id,r.output_version_id,p.thread_id,j.status,j.error_code,j.cancel_requested FROM app.video_requests r JOIN app.video_projects p ON p.id=r.project_id JOIN app.jobs j ON j.id=r.job_id WHERE r.slot_id=$1 ORDER BY j.created_at DESC',[slotId])).rows;
      const carousel_runs=(await db.query(`SELECT j.id,j.status,j.error_code,j.cancel_requested,r.project_id,r.output_version_id,r.input->>'slide_count' AS slide_count FROM app.content_slot_carousel_generations g JOIN app.carousel_requests r ON r.job_id=g.job_id JOIN app.jobs j ON j.id=r.job_id WHERE g.slot_id=$1 ORDER BY j.created_at DESC,j.id`,[slotId])).rows;
      const carousel_slides=(await db.query(`SELECT c.parent_job_id,c.position,g.status AS generation_status,e.status AS export_status,r.project_id,r.output_version_id FROM app.content_slot_carousel_generations link JOIN app.carousel_children c ON c.parent_job_id=link.job_id JOIN app.creative_requests r ON r.job_id=c.generation_job_id JOIN app.jobs g ON g.id=c.generation_job_id JOIN app.jobs e ON e.id=c.export_job_id WHERE link.slot_id=$1 ORDER BY c.position`,[slotId])).rows;
      return { slot, events, generations, videos, carousel_runs, carousel_slides };
    });
  }
}
