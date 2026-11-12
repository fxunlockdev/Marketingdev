import {acceptsModel} from './model-policy.js';
import {pregeneratePreviews} from './preview-pregeneration.js';
import {packForJob,promptKnowledge,recordPost,type StoredKnowledge} from './knowledge-production.js';
import {logActivityFailure} from './activity-log.js';
import {StockAssets,tooCloseToStock,STOCK_TOO_CLOSE_DISTANCE,type StockReference} from './stock-assets.js';
import {StockError} from './vecteezy-client.js';
import {imagePlanningRates} from './creative-planning.js';
import {inImageCopy} from './image-typography.js';
import {imageCallPlan,type BrandReference} from './image-render.js';
import {ImageQa,QA_UNAVAILABLE,qaExpectation,qaPreview,qaReport,qaRetryNotes,settleVerdict,nearStockCopy,type QaAttempt,type QaExpectation,type QaReport,type StockSourceCheck,type StockSourceReport} from './image-qa.js';
import {normalizeCreativeSpec} from "./campaign-formats.js";
import {creativeMediaUsed,creativeStorageFits} from "./creative-storage.js";
import {approvedBrandFont} from './brand-typography.js';
import {savedCampaignFont} from './campaign-design.js';
import {exceedsAllowance,monthlyBudgetExceeded} from "./spending-allowance.js";
import {validateCarouselResult,carouselSlideBrief} from './carousel-planning.js';
import {assertLearningCurrent} from './learning-context.js';
import {GeminiPlanner} from "./gemini-planner.js";
import {ApiError as GeminiAPIError} from "@google/genai";
import type {PlannerRequest} from "./creative-contracts.js";
import {referenceColumns,referenceJoins} from './brand-references.js';
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { AssetJobs, type JobScope } from "./jobs.js";
import { SkillRuntime } from "./skill-runtime.js";
import { CreativeProvider } from "./creative-provider.js";
import {
  CreativeError,
  validateSkillResult,
  type CreativeInput,
} from "./creative-contracts.js";
import { canonicalJSON, hash } from "./brand-brain.js";
import { digest } from "./object-store.js";
import { createDesign, reviseDesign } from "./creative-design.js";
const terminal = new Set([
  "succeeded",
  "failed",
  "rejected",
  "canceled",
  "unknown",
]);
/** Why an optional step (quality check, its regeneration) could not run, or null when the job itself must stop.
 * Losing access still stops the job; a spent budget or provider fault only costs the optional step. */
function optionalFailure(error:unknown):string|null{
  if(monthlyBudgetExceeded(error))return 'MONTHLY_GENERATION_BUDGET_EXHAUSTED';
  return error instanceof CreativeError&&error.code!=='CREATIVE_ACCESS_REVOKED'?error.code:null;
}
export class CreativeJobs {
  constructor(
    readonly jobs: AssetJobs,
    readonly runtime: SkillRuntime,
    readonly provider: CreativeProvider,
    readonly gemini:GeminiPlanner=new GeminiPlanner(),
    readonly stock?:StockAssets,
    /** Vision check after each image. Absent: images are stored unchecked, as before. */
    readonly qa?:ImageQa,
  ) {}
  planner(provider:string){if(provider!=="openai"&&provider!=="gemini")throw new CreativeError("CREATIVE_CONFIG_CHANGED");return provider==="gemini"?this.gemini:this.provider;}
  async plannerGrant(db:any,j:any,provider:string){
    const sql=provider==="gemini"?"SELECT * FROM app.gemini_creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()":"SELECT * FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()";
    return (await db.query(sql,[j.organization_id,j.brand_id])).rows[0];
  }
  async planCall(scope:JobScope,message:PlannerRequest,request:any,maxOutputTokens:4000|16000=4000){
    const provider=this.planner(request.text_provider),model=request.selected_text_model;
    if(!model)throw new CreativeError("CREATIVE_STAGING_APPROVAL_REQUIRED");
    if(!provider.configured)throw new CreativeError("CREATIVE_PROVIDER_NOT_CONFIGURED");
    // Steps 4 and 5 are trusted stock planning; images arriving on a sandbox step (1-3) are dropped.
    const providerMessage=message.step===4||message.step===5?{...message,step:1}:{...message,images:undefined};
    const wire=provider.plannerRequest(providerMessage,model,maxOutputTokens);
    return this.call(scope,`plan:${message.step}`,model,wire.sha256,g=>{const rates=acceptsModel('brief',model)?imagePlanningRates(wire.maxInputTokens):g;return wire.maxInputTokens*Number(rates.input_micros_per_token)+wire.maxOutputTokens*Number(rates.output_micros_per_token);},()=>provider.plan(providerMessage,model,maxOutputTokens),request.text_provider);
  }
  finish(db: any, j: any, status: string, code: string | null = null) {
    return db
      .query(
        "UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1",
        [j.id, status, code],
      )
      .then(() => status);
  }
  async call(
    scope: JobScope,
    step: string,
    model: string,
    inputHash: string,
    cost: (grant: any) => number,
    action: () => Promise<any>,
    providerName="openai",
    // Optional calls (quality check, its one regeneration) never leave a request uncertain:
    // a failure is recorded as rejected and the caller carries on with what it has.
    options:{optional?:boolean}={},
  ) {
    const imageStep=step==='image'||step==='image:retry',qaStep=step.startsWith('qa:');
    const prepared = await this.jobs.transaction(scope, async (db, j) => {
      if (!(await this.jobs.permitted(db, j)))
        throw new CreativeError("CREATIVE_ACCESS_REVOKED");
      const memorySQL=j.kind==='carousel.generate'?'SELECT memory_context FROM app.carousel_requests WHERE job_id=$1':j.kind==='creative.video'?'SELECT memory_context FROM app.video_requests WHERE job_id=$1':'SELECT memory_context FROM app.creative_requests WHERE job_id=$1';
      await assertLearningCurrent(db,(await db.query(memorySQL,[j.id])).rows[0]?.memory_context);
      const carousel=(await db.query('SELECT r.canceled FROM app.carousel_children c JOIN app.carousel_requests r ON r.job_id=c.parent_job_id WHERE c.generation_job_id=$1',[j.id])).rows[0];if(carousel?.canceled)throw new CreativeError('CREATIVE_ACCESS_REVOKED');
      if(imageStep||qaStep){if(providerName!=='openai')throw new CreativeError('CREATIVE_CONFIG_CHANGED');}
      else {
        const sql=j.kind==='carousel.generate'?'SELECT text_provider,selected_text_model FROM app.carousel_requests WHERE job_id=$1':j.kind==='creative.video'?'SELECT text_provider,selected_text_model FROM app.video_requests WHERE job_id=$1':'SELECT text_provider,selected_text_model FROM app.creative_requests WHERE job_id=$1';
        const bound=(await db.query(sql,[j.id])).rows[0];
        if(!bound||bound.text_provider!==providerName||bound.selected_text_model!==model)throw new CreativeError('CREATIVE_CONFIG_CHANGED');
      }
      const previous = (
        await db.query(
          "SELECT * FROM app.creative_calls WHERE job_id=$1 AND step=$2",
          [j.id, step],
        )
      ).rows[0];
      if (previous) {
        if (previous.provider!==providerName || previous.model !== model || previous.input_sha256 !== inputHash)
          return { blocked: "CREATIVE_REPLAY_MISMATCH" };
        if (previous.status === "succeeded") return { cached: previous.result };
        if (options.optional) {
          if (previous.status === "submitted")
            await db.query(
              "UPDATE app.creative_calls SET status='rejected' WHERE job_id=$1 AND step=$2",
              [j.id, step],
            );
          return { blocked: QA_UNAVAILABLE };
        }
        if (previous.status === "submitted")
          await db.query(
            "UPDATE app.creative_calls SET status='unknown' WHERE job_id=$1 AND step=$2",
            [j.id, step],
          );
        return {
          blocked:
            previous.status === "rejected"
              ? "CREATIVE_PROVIDER_REJECTED"
              : "CREATIVE_SUBMISSION_UNKNOWN",
        };
      }
      if(providerName!=='openai')throw new CreativeError('CREATIVE_GPT_REQUIRED');
      if((await db.query('SELECT 1 FROM app.creative_references c JOIN app.brand_references r ON r.id=c.reference_id WHERE c.job_id=$1 AND r.revoked_at IS NOT NULL',[j.id])).rowCount)throw new CreativeError('CREATIVE_REFERENCE_REVOKED');
      const grant=await this.plannerGrant(db,j,providerName);
      if (!grant) throw new CreativeError("CREATIVE_STAGING_APPROVAL_REQUIRED");
      if (qaStep ? !acceptsModel('check',model) : !(!imageStep && ["creative.generate","carousel.generate"].includes(j.kind) && acceptsModel('brief',model)) && model !== (imageStep ? grant.image_model : grant.text_model))
        throw new CreativeError("CREATIVE_CONFIG_CHANGED");
      const reserved = Math.ceil(cost(grant)),
        used = Number(
          (
            await db.query(
              "SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.creative_calls WHERE organization_id=$1 AND brand_id=$2 AND provider=$3",
              [j.organization_id, j.brand_id,providerName],
            )
          ).rows[0].n,
        );
      if (
        !Number.isSafeInteger(reserved) ||
        reserved <= 0 ||
        exceedsAllowance(used + reserved,grant.budget_micros)
      )
        throw new CreativeError("CREATIVE_BUDGET_EXHAUSTED");
      if(j.kind==='creative.generate'||j.kind==='carousel.generate'){
        const limit=(await db.query(j.kind==='carousel.generate'?'SELECT max_cost_micros FROM app.carousel_requests WHERE job_id=$1':'SELECT max_cost_micros FROM app.creative_requests WHERE job_id=$1',[j.id])).rows[0]?.max_cost_micros;
        if(limit!==null&&limit!==undefined){
          const spent=Number((await db.query('SELECT COALESCE(sum(reserved_micros),0) AS n FROM app.creative_calls WHERE job_id=$1',[j.id])).rows[0].n);
          // Do not pay for planning when the request cannot also afford its image.
          // Existing image reservations are already included in spent on replay.
          let remainingImage=0;
          if(j.kind==='creative.generate'&&!imageStep&&!qaStep&&!(await db.query("SELECT 1 FROM app.creative_calls WHERE job_id=$1 AND step='image'",[j.id])).rowCount){
            const count=Number((await db.query('SELECT count(*)::int AS n FROM app.creative_references WHERE job_id=$1',[j.id])).rows[0].n);
            remainingImage=Number(grant.max_image_request_micros)*(1+count+(this.stock?1:0));
          }
          if(!Number.isSafeInteger(spent)||!Number.isSafeInteger(remainingImage)||remainingImage<0||spent+reserved+remainingImage>Number(limit))throw new CreativeError('CREATIVE_REQUEST_BUDGET_EXHAUSTED');
        }
      }
      await db.query(
        "INSERT INTO app.creative_calls(job_id,step,organization_id,brand_id,model,input_sha256,reserved_micros,status,provider) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8)",
        [j.id, step, j.organization_id, j.brand_id, model, inputHash, reserved,providerName],
      );
      return { submit: true };
    });
    if ("cached" in prepared) return prepared.cached;
    if ("blocked" in prepared) throw new CreativeError(prepared.blocked!);
    let result;
    try {
      result = await action();
    } catch (error) {
      if(error instanceof StockError)error=new CreativeError(error.code);
      if(monthlyBudgetExceeded(error))error=new CreativeError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
      const known =
        error instanceof CreativeError ||
        ((error instanceof OpenAI.APIError || error instanceof GeminiAPIError) &&
          [400, 401, 403, 404, 422, 429].includes(error.status ?? 0));
      await this.jobs.transaction(scope, async (db, j) => {
        await db.query(
          "UPDATE app.creative_calls SET status=$3 WHERE job_id=$1 AND step=$2",
          [j.id, step, known || options.optional ? "rejected" : "unknown"],
        );
      });
      throw new CreativeError(
        known
          ? error instanceof CreativeError
            ? error.code
            : "CREATIVE_PROVIDER_REJECTED"
          : "CREATIVE_SUBMISSION_UNKNOWN",
      );
    }
    // A DB failure after provider success remains submitted/unknown on retry. Never
    // repeat a paid call merely because its local result could not be committed.
    await this.jobs.transaction(scope, async (db, j) => {
      await db.query(
        "UPDATE app.creative_calls SET status='succeeded',result=$3 WHERE job_id=$1 AND step=$2",
        [j.id, step, JSON.stringify(result)],
      );
    });
    return result;
  }
  /** One vision check of a stored image. Any failure of the check itself is 'unavailable', never a failed creative. */
  private async qaAttempt(scope:JobScope,step:'qa:1'|'qa:2',media:{object_key:string;sha256:string},expectation:QaExpectation):Promise<QaAttempt>{
    const qa=this.qa!;
    try{
      const bytes=await this.jobs.store.read(media.object_key);
      if(digest(bytes)!==media.sha256)throw new CreativeError(QA_UNAVAILABLE);
      const wire=qa.request(await qaPreview(bytes),expectation);
      const finding=await this.call(scope,step,wire.model,wire.sha256,()=>qa.reservation(wire),()=>qa.check(wire),"openai",{optional:true});
      return {step,media_sha256:media.sha256,status:'checked',finding};
    }catch(error){
      const reason=optionalFailure(error);
      if(!reason)throw error;
      return {step,media_sha256:media.sha256,status:'unavailable',reason};
    }
  }
  /** Local comparison of a stored output with its stock photo. A read or decode failure is recorded, never fatal. */
  private async stockCheck(step:'qa:1'|'qa:2',media:{object_key:string;sha256:string},stock:Buffer):Promise<StockSourceCheck>{
    try{
      const bytes=await this.jobs.store.read(media.object_key);
      if(digest(bytes)!==media.sha256)return {step,media_sha256:media.sha256,status:'unavailable'};
      const {distance,tooClose}=await tooCloseToStock(stock,bytes);
      return {step,media_sha256:media.sha256,status:'checked',distance,too_close:tooClose};
    }catch{
      return {step,media_sha256:media.sha256,status:'unavailable'};
    }
  }
  /** Check the image; on 'retry', or when it is a near copy of its stock photo, regenerate exactly once
   * with the notes. Never loops: a second failure is flagged for a person. */
  private async inspected<M extends {object_key:string;sha256:string}>(scope:JobScope,first:M,expectation:QaExpectation,regenerate:(notes:string)=>Promise<M>,stockPhoto?:Buffer):Promise<{image:M;qa:QaReport|null}>{
    if(!this.qa?.configured)return {image:first,qa:null};
    const model=this.qa.model,initial=await this.qaAttempt(scope,'qa:1',first,expectation);
    const firstStock:StockSourceReport|undefined=stockPhoto?{threshold:STOCK_TOO_CLOSE_DISTANCE,checks:[await this.stockCheck('qa:1',first,stockPhoto)]}:undefined;
    const visionRetry=initial.status==='checked'&&settleVerdict(initial.finding,expectation)==='retry',copied=nearStockCopy(firstStock);
    if(!visionRetry&&!copied)return {image:first,qa:qaReport(model,expectation,[initial],false,undefined,firstStock)};
    let second:M;
    try{second=await regenerate(qaRetryNotes(visionRetry&&initial.status==='checked'?initial.finding:null,expectation,copied));}
    catch(error){
      const reason=optionalFailure(error);
      if(!reason)throw error;
      return {image:first,qa:qaReport(model,expectation,[initial],false,reason,firstStock)};
    }
    const retried=await this.qaAttempt(scope,'qa:2',second,expectation);
    const secondStock=stockPhoto&&firstStock?{...firstStock,checks:[...firstStock.checks,await this.stockCheck('qa:2',second,stockPhoto)]}:undefined;
    return {image:second,qa:qaReport(model,expectation,[initial,retried],true,undefined,secondStock)};
  }
  /** The stored pack, or a new one saved before any planner call. A job that already called a model before
   * packs existed keeps its original input, so its recorded calls still match. */
  private async knowledgeContext(db:any,j:any,request:any):Promise<StoredKnowledge>{
    if(request.knowledge_context)return request.knowledge_context as StoredKnowledge;
    const started=(await db.query("SELECT 1 FROM app.creative_calls WHERE job_id=$1 LIMIT 1",[j.id])).rowCount;
    const slide=(await db.query('SELECT 1 FROM app.carousel_children WHERE generation_job_id=$1',[j.id])).rowCount;
    const stored:StoredKnowledge=started?{status:'skipped',reason:'KNOWLEDGE_JOB_ALREADY_STARTED'}:await packForJob(db,{organizationId:j.organization_id,brandId:j.brand_id},slide?'carousel':'creative',request.prompt);
    await db.query('UPDATE app.creative_requests SET knowledge_context=$2 WHERE job_id=$1',[j.id,JSON.stringify(stored)]);
    return stored;
  }
  /** Production record for the graph: a post node and used_in edges. Optional, never fails the creative. */
  private async recordKnowledge(scope:JobScope,versionId:string,label:string,knowledge:StoredKnowledge):Promise<void>{
    if(knowledge.status!=='ready')return;
    try{
      await this.jobs.transaction(scope,db=>recordPost(db,scope,{key:`creative ${versionId}`,label,jobId:scope.jobId,properties:{creative_version_id:versionId}},knowledge.used_node_ids));
    }catch(error){logActivityFailure('KnowledgeRecord',scope,error);}
  }
  async run(scope: JobScope) {
    try {
      const prepared = await this.jobs.transaction(scope, async (db, j) => {
        if (j.kind !== "creative.generate") throw new Error("JOB_KIND_DENIED");
        if (terminal.has(j.status)) return null;
        if (!(await this.jobs.permitted(db, j))) {
          await this.finish(db, j, "canceled", "CREATIVE_ACCESS_REVOKED");
          return null;
        }
        if (!this.runtime.configured)
          throw new CreativeError("SKILL_RUNTIME_NOT_CONFIGURED");
        if (!this.provider.configured)
          throw new CreativeError("CREATIVE_PROVIDER_NOT_CONFIGURED");
        const request = (
          await db.query(
            "SELECT * FROM app.creative_requests WHERE job_id=$1",
            [j.id],
          )
        ).rows[0];
        if(request.image_provider==='higgsfield')throw new CreativeError("HIGGSFIELD_IMAGES_NOT_CONFIGURED");
        const link = (
          await db.query(
            "SELECT g.source_revision,s.revision,s.state,s.creative_version_id FROM app.content_slot_generations g JOIN app.content_slots s ON s.id=g.slot_id WHERE g.job_id=$1",
            [j.id],
          )
        ).rows[0];
        if (
          link &&
          (link.source_revision !== link.revision ||
            ["approved", "cancelled"].includes(link.state) ||
            link.creative_version_id !== request.parent_version_id) &&
          !(
            await db.query(
              "SELECT 1 FROM app.creative_calls WHERE job_id=$1 LIMIT 1",
              [j.id],
            )
          ).rowCount
        )
          throw new CreativeError("CREATIVE_SLOT_CHANGED");
        const brain = (
          await db.query(
            "SELECT id,sha256,snapshot FROM app.brand_brain_versions WHERE id=$1",
            [request.brain_id],
          )
        ).rows[0];
        if (!brain || hash(canonicalJSON(brain.snapshot)) !== brain.sha256)
          throw new CreativeError("CREATIVE_BRAND_INTEGRITY_FAILED");
        const grant = (
          await db.query(
            "SELECT * FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2",
            [j.organization_id, j.brand_id],
          )
        ).rows[0];
        if (!grant)
          throw new CreativeError("CREATIVE_STAGING_APPROVAL_REQUIRED");
        const parent = request.parent_version_id
          ? (
              await db.query(
                "SELECT v.*,m.object_key,m.sha256 AS media_sha256,m.bytes AS media_bytes FROM app.creative_versions v JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1",
                [request.parent_version_id],
              )
            ).rows[0]
          : null;
        // Same 30-day, archive-aware window as Canvas and carousels, so a request accepted there is not refused here.
        if (!creativeStorageFits(await creativeMediaUsed(db, j.organization_id, j.brand_id)))
          throw new CreativeError("CREATIVE_STORAGE_LIMIT");
        await db.query(
          "UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",
          [j.id],
        );
        const knowledge=await this.knowledgeContext(db,j,request);
        const input: CreativeInput = {
          brand: {
            learning:request.memory_context,
            ...(promptKnowledge(knowledge)?{knowledge:promptKnowledge(knowledge)}:{}),
            id: brain.id,
            sha256: brain.sha256,
            facts: brain.snapshot.facts.map((f: any) => ({
              id: f.id,
              field: f.field,
              value: f.value,
            })),
          },
          prompt: request.prompt,
          format: request.format,
          channel: request.channel,
          parent: parent
            ? {
                caption: parent.caption,
                // Designed type lives in the picture, not in a layer; keep it known to the planner.
                headline:
                  parent.skill_manifest?.in_image_text?.headline ??
                  parent.design.layers.find((l: any) => l.id === "headline")
                    ?.text ?? "",
                body:
                  parent.design.layers.find((l: any) => l.id === "body")
                    ?.text ?? "",
                cta:
                  parent.design.layers.find((l: any) => l.id === "cta")?.text ??
                  "",
              }
            : null,
        };
        const references=(await db.query(`SELECT ${referenceColumns},c.position FROM app.creative_references c JOIN app.brand_references r ON r.id=c.reference_id ${referenceJoins} WHERE c.job_id=$1 ORDER BY c.position`,[j.id])).rows;
        // Only a mood board locked before this request was made: the prompt must be identical on replay.
        const moodboard=(await db.query('SELECT m.direction,m.feedback FROM app.guided_moodboards m WHERE m.organization_id=$1 AND m.brand_id=$2 AND m.approved_at IS NOT NULL AND m.approved_at<=(SELECT created_at FROM app.jobs WHERE id=$3) ORDER BY m.approved_at DESC LIMIT 1',[j.organization_id,j.brand_id,j.id])).rows[0]??null;
        return { request, grant, parent, input, references, moodboard, knowledge, actor: j.requested_by };
      });
      if (!prepared) return "finished";
      const { request, grant, input, parent, references, moodboard, knowledge } = prepared;
      const brandReferences:BrandReference[]=[];
      for(const r of references){
        if(!r.object_key||!r.sha256)throw new CreativeError('CREATIVE_REFERENCE_INVALID');
        const bytes=await this.jobs.store.read(r.object_key,6*1024*1024);
        if(bytes.length!==r.bytes||digest(bytes)!==r.sha256)throw new CreativeError('CREATIVE_REFERENCE_INVALID');
        brandReferences.push({id:r.id,visual_id:r.visual_id,kind:r.kind,label:r.label,crop:r.crop??null,source_sha256:r.sha256,bytes,width:r.width,height:r.height});
      }
      const carousel=await this.jobs.transaction(scope,async(db,j)=>(await db.query('SELECT r.job_id,r.input,r.input_sha256,r.plan,r.canceled,c.position FROM app.carousel_children c JOIN app.carousel_requests r ON r.job_id=c.parent_job_id WHERE c.generation_job_id=$1',[j.id])).rows[0]);
      let plan = request.plan;
      if(carousel){
        if(carousel.canceled)throw new CreativeError('CREATIVE_ACCESS_REVOKED');
        if(!carousel.plan||hash(canonicalJSON(carousel.input))!==carousel.input_sha256||carousel.input.brand.id!==input.brand.id||carousel.input.brand.sha256!==input.brand.sha256)throw new CreativeError('CAROUSEL_PLAN_UNAVAILABLE');
        const shared=validateCarouselResult(carousel.plan,carousel.input),derived={type:'result',version:shared.version,brief:carouselSlideBrief(shared.plan,carousel.position),skills:shared.skills,reads:shared.reads,model_calls:shared.model_calls,helpers_executed:false};
        if(plan&&canonicalJSON(plan)!==canonicalJSON(derived))throw new CreativeError('CAROUSEL_PLAN_CHANGED');plan=derived;
      }
      if (!plan) {
        plan = await this.runtime.plan(input,message=>this.planCall(scope,message,request));
        await this.jobs.transaction(scope, async (db, j) => {
          if (!(await this.jobs.permitted(db, j)))
            throw new CreativeError("CREATIVE_ACCESS_REVOKED");
          await db.query(
            "UPDATE app.creative_requests SET plan=$2 WHERE job_id=$1",
            [j.id, JSON.stringify(plan)],
          );
        });
      }
      if(!carousel)plan = validateSkillResult(plan, input);
      let stockPhoto:Buffer|undefined,stockChoice:StockReference|null=null;
      if(this.stock){
        const dimensions=String(request.size).split('x').map(Number);
        const orientation=dimensions[0]===dimensions[1]?'square':dimensions[0]>dimensions[1]?'horizontal':'vertical';
        // Stock is optional: a skipped or failed stock step is recorded and the creative goes ahead without it.
        const stock=await this.stock.reference(scope,input,{imagePrompt:plan.brief.image_prompt,orientation,edit:!!parent,brandReferences:references.length,layoutArchetype:(plan.brief as {art_direction?:{layout_archetype?:unknown}}).art_direction?.layout_archetype,artDirection:(plan.brief as {art_direction?:unknown}).art_direction,carouselPosition:carousel?.position??null,vision:(this.planner(request.text_provider) as {acceptsImages?:boolean}).acceptsImages===true},message=>this.planCall(scope,message,request));
        if(stock){stockPhoto=stock.photo;stockChoice=stock;}
      }
      let reference: Buffer | undefined;
      if (parent) {
        reference = await this.jobs.store.read(parent.object_key);
        if (
          reference.length !== parent.media_bytes ||
          digest(reference) !== parent.media_sha256
        )
          throw new CreativeError("CREATIVE_REFERENCE_INVALID");
      }
      const artwork=request.creative_spec?.artwork;
      // The placement's true size. An edit of a 2:3 portrait made before 4:5 keeps its size, so its saved layers still fit.
      const placement=request.creative_spec?normalizeCreativeSpec(request.creative_spec,request.format,request.channel):null;
      const call=await imageCallPlan({brief:plan.brief,facts:input.brand.facts,prompt:request.prompt,references:brandReferences,stock:stockChoice,moodboard,placement,requestSize:request.size,model:grant.image_model,quality:grant.quality,artwork,
        parent:parent&&reference?{bytes:reference,design:parent.design,text:{hasOverlayText:parent.design.layers.some((l:any)=>String(l.text??'').trim()),textMode:parent.skill_manifest?.text_mode}}:null});
      const {identity,textMode,manifest:referenceManifest,references:referenceImages,prompt:basePrompt}=call;
      const render=async(step:'image'|'image:retry',prompt:string)=>{
      const wire = this.provider.imageRequest(
        grant.image_model,
        prompt,
        call.size,
        grant.quality,
        hash(`${scope.organizationId}:${prepared.actor}`),
      );
      return this.call(
        scope,
        step,
        grant.image_model,
        hash(
          canonicalJSON({ wire, parent_sha256: parent?.media_sha256 ?? null,...(referenceManifest.length?{references:referenceManifest}:{}) }),
        ),
        (g) => {
          if (g.quality !== grant.quality)
            throw new CreativeError("CREATIVE_CONFIG_CHANGED");
          return Number(g.max_image_request_micros)*(1+referenceImages.length);
        },
        async () => {
          if(this.stock&&referenceManifest.some(r=>String(r.kind).startsWith('stock_')))await this.stock.authorize(scope);
          const output=await call.render(this.provider,wire.safety_identifier,prompt);
          // Keep provider output for provenance; the stored creative fills the placement edge to edge.
          if(output.source)await this.jobs.store.persist(`creative/${scope.organizationId}/${scope.brandId}/${scope.jobId}/${output.source.sha256}`,output.source.bytes,"image/png",output.source.sha256);
          const framing=output.framing;
          const objectKey = `creative/${scope.organizationId}/${scope.brandId}/${scope.jobId}/${output.sha256}`;
          await this.jobs.store.persist(
            objectKey,
            output.bytes,
            "image/png",
            output.sha256,
          );
          await pregeneratePreviews(this.jobs.store.previews,scope,objectKey,output.sha256,output.bytes);
          const media = {
            id: randomUUID(),
            object_key: objectKey,
            sha256: output.sha256,
            bytes: output.bytes.length,
            width: output.width,
            height: output.height,
            usage: output.usage,
            created: output.created,
            framing,
          };
          await this.jobs.transaction(scope, async (db, j) => {
            await db.query(
              "INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                media.id,
                j.organization_id,
                j.brand_id,
                j.id,
                objectKey,
                media.sha256,
                media.bytes,
                media.width,
                media.height,
              ],
            );
          });
          return media;
        },
        "openai",
        {optional:step==='image:retry'},
      );
      };
      const first=await render('image',basePrompt);
      const {image,qa}=await this.inspected(scope,first,qaExpectation(plan.brief,textMode,identity),notes=>render('image:retry',basePrompt+notes),stockPhoto);
      let savedVersion:string|undefined;
      const status=await this.jobs.transaction(scope, async (db, j) => {
        if (terminal.has(j.status)) return j.status;
        if (!(await this.jobs.permitted(db, j)))
          return this.finish(db, j, "canceled", "CREATIVE_ACCESS_REVOKED");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `canvas:${j.brand_id}`,
        ]);
        const link = (
          await db.query(
            "SELECT * FROM app.content_slot_generations WHERE job_id=$1",
            [j.id],
          )
        ).rows[0];
        if (link)
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`plan:${j.brand_id}`],
          );
        const project = (
          await db.query(
            "SELECT latest_version_id FROM app.creative_projects WHERE id=$1 FOR UPDATE",
            [request.project_id],
          )
        ).rows[0];
        if (project.latest_version_id !== request.parent_version_id)
          return this.finish(db, j, "rejected", "CREATIVE_VERSION_CHANGED");
        const campaignFont = (link ? savedCampaignFont(request.prompt) : undefined) ?? approvedBrandFont(input.brand.facts);
        const version = randomUUID(),
          design = parent
            ? reviseDesign(parent.design, image.id, plan.brief, artwork, campaignFont, plan.brief.art_direction?textMode:undefined)
            : createDesign(image.id, image.width, image.height, plan.brief, campaignFont, artwork, plan.brief.art_direction?textMode:undefined),
          sha = hash(
            canonicalJSON({
              design,
              caption: plan.brief.caption,
              brain_id: request.brain_id,
            }),
          );
        const reserved = Number(
          (
            await db.query(
              "SELECT sum(reserved_micros) AS n FROM app.creative_calls WHERE job_id=$1",
              [j.id],
            )
          ).rows[0].n,
        );
        const manifest = {
          ...(request.creative_spec?{creative_spec:request.creative_spec,framing:image.framing??null}:{}),
          ...(carousel?{carousel:{job_id:carousel.job_id,position:carousel.position,plan_sha256:hash(canonicalJSON(carousel.plan))}}:{}),
          ...(referenceManifest.length?{references:referenceManifest}:{}),
          ...(plan.brief.art_direction?{art_direction:plan.brief.art_direction,text_mode:textMode,...(textMode==='in_image'?{in_image_text:inImageCopy(plan.brief)}:{})}:{}),
          skills: plan.skills,
          reads: plan.reads,
          runtime: plan.version,
          model_calls: plan.model_calls,
          warnings: plan.brief.warnings,
          fact_ids: plan.brief.fact_ids,
          text_provider:request.text_provider,
          text_model: request.selected_text_model,
          learning:request.memory_context,
          knowledge:knowledge.status==='ready'?{used_node_ids:knowledge.used_node_ids,used_edge_ids:knowledge.used_edge_ids,bytes:knowledge.bytes,truncated:knowledge.prompt.truncated}:{status:knowledge.status,reason:knowledge.reason},
          image_model: grant.image_model,
          reserved_cost_micros: reserved,
        };
        await db.query(
          "INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,parent_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by,qa) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            version,
            j.organization_id,
            j.brand_id,
            request.project_id,
            request.parent_version_id,
            request.brain_id,
            j.id,
            image.id,
            JSON.stringify(design),
            plan.brief.caption,
            JSON.stringify(manifest),
            sha,
            j.requested_by,
            qa ? JSON.stringify(qa) : null,
          ],
        );
        await db.query(
          "UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1",
          [request.project_id, version],
        );
        await db.query(
          "UPDATE app.creative_requests SET output_version_id=$2 WHERE job_id=$1",
          [j.id, version],
        );
        await db.query(
          "INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'assistant',$6)",
          [
            randomUUID(),
            j.organization_id,
            j.brand_id,
            request.thread_id,
            j.id,
            plan.brief.caption,
          ],
        );
        if (link) {
          const attached = (
            await db.query(
              `UPDATE app.content_slots SET creative_version_id=$2,creative_sha256=$3,revision=revision+1,state='draft_ready',updated_at=now()
            WHERE id=$1 AND revision=$4 AND state NOT IN ('approved','cancelled') AND approved_by IS NULL AND creative_version_id IS NOT DISTINCT FROM $5::uuid AND creative_spec IS NOT DISTINCT FROM $6::jsonb RETURNING *`,
              [
                link.slot_id,
                version,
                sha,
                link.source_revision,
                request.parent_version_id,
                request.creative_spec?JSON.stringify(request.creative_spec):null,
              ],
            )
          ).rows[0];
          if (attached) {
            const snapshot = {
              plan_id: attached.plan_id,
              channel: attached.channel,
              planned_at: attached.planned_at,
              format: attached.format,
              creative_spec:attached.creative_spec??null,
              brief: attached.brief,
              pillar: attached.pillar,
              hook: attached.hook,
              cta: attached.cta,
              state: attached.state,
              creative_version_id: version,
              creative_sha256: sha,
            };
            await db.query(
              `INSERT INTO app.content_slot_events(id,organization_id,brand_id,slot_id,revision,action,actor_id,creative_version_id,creative_sha256,feedback,snapshot)
              VALUES($1,$2,$3,$4,$5,'creative_attached',$6,$7,$8,'',$9)`,
              [
                randomUUID(),
                j.organization_id,
                j.brand_id,
                attached.id,
                attached.revision,
                j.requested_by,
                version,
                sha,
                JSON.stringify(snapshot),
              ],
            );
          }
          await db.query(
            "UPDATE app.content_slot_generations SET attachment_status=$2,attached_version_id=$3 WHERE job_id=$1",
            [
              j.id,
              attached ? "attached" : "needs_attachment",
              attached ? version : null,
            ],
          );
        }
        savedVersion=version;
        return this.finish(db, j, "succeeded");
      });
      if(status==='succeeded'&&savedVersion)await this.recordKnowledge(scope,savedVersion,plan.brief.headline||plan.brief.caption,knowledge);
      return status;
    } catch (error) {
      if(error instanceof StockError)error=new CreativeError(error.code);
      if(monthlyBudgetExceeded(error))error=new CreativeError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
      if (!(error instanceof CreativeError)) throw error;
      return this.jobs.transaction(scope, async (db, j) => {
        if (terminal.has(j.status)) return j.status;
        const status = [
          "CREATIVE_SUBMISSION_UNKNOWN",
          "CREATIVE_REPLAY_MISMATCH",
        ].includes(error.code)
          ? "unknown"
          : error.code === "CREATIVE_ACCESS_REVOKED"
            ? "canceled"
            : "rejected";
        return this.finish(db, j, status, error.code);
      });
    }
  }
  fail(scope: JobScope) {
    return this.jobs.transaction(scope, async (db, j) => {
      if (j.kind !== "creative.generate") throw new Error("JOB_KIND_DENIED");
      if (terminal.has(j.status)) return j.status;
      const uncertain = (
        await db.query(
          "SELECT job_id FROM app.creative_calls WHERE job_id=$1 AND status IN ('submitted','unknown') LIMIT 1",
          [j.id],
        )
      ).rowCount;
      return this.finish(
        db,
        j,
        uncertain ? "unknown" : "failed",
        uncertain
          ? "CREATIVE_SUBMISSION_UNKNOWN"
          : "CREATIVE_RETRIES_EXHAUSTED",
      );
    });
  }
}
