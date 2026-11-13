import type {PoolClient} from 'pg';
import {BadRequestException,ConflictException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Businesses} from './businesses.js';
import {Intake} from './intake.js';
import {object} from './workspaces.js';
import {canonicalJSON} from './brand-brain.js';
import {ACTIVE_JOB,analysisReady,recordBriefEvidence,researchDigest,researchProgress,type ResearchProgress} from './early-analysis.js';
import {guidedBrief,requireGuidedRevision,researchSuggestions,earlyResearchWebsite,uncoveredCompetitors,type GuidedBrief} from './guided-campaign-contracts.js';
import {websiteURL} from './safe-web.js';

const ACTIVE=ACTIVE_JOB;
type EarlyResearch={prefill_job_id:string|null;prefill_status:string|null;prefill_error:string|null;prefill_website:string|null};
type EarlyAnalysis={early_analysis_job_id:string|null;early_analysis_status:string|null;early_analysis_current:boolean};
type Business={organization_id:string;name?:string};
/** How the analysis waits for and builds on the early capture. Null: wait for a fresh capture. */
type AnalysisPlan={website:string|null;after?:string;marketFollowup?:{website:string;competitors:string[]}};
/** A saved brief and its research share one transaction. Worker results remain unapproved. */
export class GuidedBusiness {
 constructor(readonly businesses:Businesses,readonly intake:Intake,readonly channels:readonly string[]=[]){}
 profilePolicy(){return {social_profile_limit:1,channels:this.channels.filter(c=>['instagram','facebook','linkedin'].includes(c))};}
 async read(user:string,id:string){
  const b=await this.businesses.resolve(user,id);
  return this.businesses.database.transaction(user,b.organization_id,false,async db=>{
   const row=(await db.query(`SELECT g.revision,g.step,g.brief,g.research_job_id,g.updated_at,j.status,j.error_code,r.result,
    j.kind AS research_kind,g.early_analysis_job_id,ea.status AS early_analysis_status,g.early_analysis_digest,
    g.prefill_job_id,pj.status AS prefill_status,pj.error_code AS prefill_error,pr.website_url AS prefill_website,
    (j.kind='website.extract' AND j.status IN ('failed','rejected','canceled') AND (child.id IS NULL OR child.status IN ('failed','rejected','canceled'))) AS can_use_saved_answers,
    EXISTS(SELECT 1 FROM app.guided_moodboards m WHERE m.organization_id=g.organization_id AND m.brand_id=g.brand_id) AS answers_locked,
    child.id AS analysis_job_id,child.status AS analysis_status,child.error_code AS analysis_error,cr.result AS analysis_result
    FROM app.guided_business_briefs g LEFT JOIN app.jobs j ON j.id=g.research_job_id
    LEFT JOIN app.intake_requests r ON r.job_id=j.id LEFT JOIN app.intake_dependencies d ON d.capture_job_id=j.id
    LEFT JOIN app.jobs child ON child.id=d.analysis_job_id LEFT JOIN app.intake_requests cr ON cr.job_id=child.id
    LEFT JOIN app.jobs pj ON pj.id=g.prefill_job_id LEFT JOIN app.intake_requests pr ON pr.job_id=pj.id LEFT JOIN app.jobs ea ON ea.id=g.early_analysis_job_id
    WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,id])).rows[0];
   // Saved answers win, including intentional empty fields. Only a new brief
   // may borrow facts from this business's immutable approved profile.
   // Suggestions come from the latest finished research for this business, even after an
   // edited answer has detached the brief from that job, so choosing one does not erase them.
   const latest=async(kind:string,path:string[])=>(await db.query(`SELECT r.result#>$4::text[] AS value FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id
    WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind=$3 AND j.status='succeeded' AND jsonb_typeof(r.result#>$4::text[])='array' AND jsonb_array_length(r.result#>$4::text[])>0 ORDER BY j.updated_at DESC,j.id LIMIT 1`,[b.organization_id,id,kind,path])).rows[0]?.value;
   // Early research answers the Customers step while the owner is still typing; a later
   // full analysis, grounded in more evidence, replaces those audience options.
   const suggestions=researchSuggestions(await latest('brand.analyze',['business_direction','audience_suggestions'])??await latest('website.extract',['market','audience_suggestions']),await latest('website.extract',['market','discovered_competitors']));
   if(row){
    const {early_analysis_digest,...saved}=row,current=early_analysis_digest===researchDigest(row.brief as GuidedBrief);
    return {...saved,early_analysis_current:current,progress:await this.progress(db,{...row,early_analysis_current:current}),suggestions,onboarding:this.profilePolicy()};
   }
   const approved=(await db.query('SELECT snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY review_revision DESC LIMIT 1',[b.organization_id,id])).rows[0];
   return {suggestions,onboarding:this.profilePolicy(),revision:0,step:0,brief:initialGuidedBrief(approved?.snapshot),research_job_id:null};
  },id);
 }
 async save(user:string,id:string,body:unknown){
  const v=object(body,['revision','brief','step']),brief=guidedBrief(v.brief),b=await this.businesses.resolve(user,id);
  return this.businesses.database.transaction(user,b.organization_id,true,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${id}`]);
   if(v.step!==undefined&&(!Number.isInteger(v.step)||Number(v.step)<0||Number(v.step)>4))throw new BadRequestException('Choose a valid questionnaire step');
   const row=(await db.query('SELECT revision,step,brief,research_job_id FROM app.guided_business_briefs WHERE organization_id=$1 AND brand_id=$2 FOR UPDATE',[b.organization_id,id])).rows[0];
   requireGuidedRevision(row?.revision??0,v.revision);
   const same=!!row&&canonicalJSON(row.brief)===canonicalJSON(brief),step=v.step??row?.step??0;
   const platform=brief.details?.social_profile?.platform;
   if(!same&&platform&&platform!=='help'&&!this.profilePolicy().channels.includes(platform))throw new BadRequestException('That platform is not available. Choose another platform or ask us to help.');
   if(same&&step===row.step)return {revision:row.revision,step,brief,...await this.background(db,user,id,b,brief,step,row.revision,!!row.research_job_id)};
   if(row?.research_job_id){
    const active=(await db.query(`SELECT j.status FROM app.jobs j WHERE j.id=$1 OR j.id IN (SELECT analysis_job_id FROM app.intake_dependencies WHERE capture_job_id=$1)`,[row.research_job_id])).rows;
    if(active.some(j=>['queued','running','retrying','unknown'].includes(j.status)))throw new ConflictException('Research is still being checked. Your saved answers cannot change yet.');
   }
   // Moving between questions must retain the completed research snapshot.
   if(!same&&(await db.query('SELECT id FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 LIMIT 1',[b.organization_id,id])).rowCount)throw new ConflictException('Your mood board already uses these answers. Keep this saved direction while completing onboarding.');
   const saved=(await db.query(`INSERT INTO app.guided_business_briefs(organization_id,brand_id,brief,step) VALUES($1,$2,$3,$4)
    ON CONFLICT(organization_id,brand_id) DO UPDATE SET brief=EXCLUDED.brief,step=EXCLUDED.step,revision=guided_business_briefs.revision+1,research_job_id=CASE WHEN $5 THEN guided_business_briefs.research_job_id ELSE NULL END,research_request_key=CASE WHEN $5 THEN guided_business_briefs.research_request_key ELSE NULL END,updated_at=now() RETURNING revision,step,brief`,[b.organization_id,id,JSON.stringify(brief),step,same])).rows[0];
   return {...saved,...await this.background(db,user,id,b,brief,step,saved.revision,same&&!!row?.research_job_id)};
  },id);
 }
 /** Background work after a save: the early website capture, then the early analysis. */
 private async background(db:PoolClient,user:string,id:string,b:Business,brief:GuidedBrief,step:number,revision:number,finalResearch:boolean):Promise<EarlyResearch&EarlyAnalysis>{
  const research=await this.earlyResearch(db,user,id,b,brief,finalResearch);
  return {...research,...await this.earlyAnalysis(db,user,id,b,brief,step,revision,finalResearch)};
 }
 /** Start the business analysis as soon as steps 1 and 2 are saved, so "Send my brief" finds
  * it finished. It waits durably for an early capture that is still running. It starts at
  * most once per research digest, whatever the outcome: an uncertain run is never repeated
  * here, and a failed one is retried only by "Send my brief". Answers that change the digest
  * supersede it; looks, folder links and files do not. Never blocks saving. */
 private async earlyAnalysis(db:PoolClient,user:string,id:string,b:Business,brief:GuidedBrief,step:number,revision:number,finalResearch:boolean):Promise<EarlyAnalysis>{
  const digest=researchDigest(brief);
  const current=async():Promise<EarlyAnalysis>=>(await db.query(`SELECT g.early_analysis_job_id,j.status AS early_analysis_status,(g.early_analysis_digest IS NOT DISTINCT FROM $3) AS early_analysis_current
   FROM app.guided_business_briefs g LEFT JOIN app.jobs j ON j.id=g.early_analysis_job_id WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,id,digest])).rows[0]??{early_analysis_job_id:null,early_analysis_status:null,early_analysis_current:false};
  const state=(await db.query(`SELECT g.early_analysis_job_id AS id,g.early_analysis_digest AS digest,g.prefill_job_id,j.status,j.cancel_requested
   FROM app.guided_business_briefs g LEFT JOIN app.jobs j ON j.id=g.early_analysis_job_id WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,id])).rows[0];
  if(!state||finalResearch||!analysisReady(brief,step)||state.digest===digest||state.status==='unknown')return current();
  if((await db.query('SELECT id FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 LIMIT 1',[b.organization_id,id])).rowCount)return current();
  // The answers it read have changed, so its result no longer applies.
  if(state.id&&ACTIVE.includes(state.status)&&!state.cancel_requested)await db.query('SELECT app.supersede_early_analysis($1)',[state.id]);
  const plan=await this.analysisPlan(db,brief,state.prefill_job_id);
  if(!plan)return current();
  // Evidence and the job are one unit: a refusal (limits, another run) leaves neither behind.
  await db.query('SAVEPOINT early_analysis');
  try{
   await recordBriefEvidence(db,b,id,brief,revision);
   const job=await this.intake.submit(user,id,{kind:'brand.analyze'},`early-analysis-${randomUUID()}`,{db,b:{...b,website:plan.website},researchContext:brief,
    ...(plan.after?{after:plan.after}:{}),...(plan.marketFollowup?{marketFollowup:plan.marketFollowup}:{})});
   await db.query('UPDATE app.guided_business_briefs SET early_analysis_job_id=$3,early_analysis_digest=$4 WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id,job.id,digest]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'guided.early_analysis_started',$4)",[b.organization_id,id,user,job.id]);
   await db.query('RELEASE SAVEPOINT early_analysis');
  }catch(error){
   await db.query('ROLLBACK TO SAVEPOINT early_analysis');
   if(error instanceof ConflictException)return current();
   throw error;
  }
  return current();
 }
 /** With a website, the analysis builds on the early capture of that exact website: after it
  * (waiting if it is still running), researching only competitors it did not cover. */
 private async analysisPlan(db:PoolClient,brief:GuidedBrief,prefill:string|null):Promise<AnalysisPlan|null>{
  if(!brief.details?.website)return {website:null};
  let target:string;try{target=websiteURL(brief.details.website).href;}catch{return null;}
  const capture=prefill?(await db.query('SELECT j.id,j.status,j.cancel_requested,r.website_url,r.research_context FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.id=$1',[prefill])).rows[0]:null;
  if(!capture||capture.website_url!==target||capture.cancel_requested)return null;
  // A capture that failed never holds the analysis back: it runs on the answers and market notes.
  const unread=['failed','rejected','canceled'].includes(capture.status);
  if(!unread&&![...ACTIVE,'succeeded'].includes(capture.status))return null;
  const waiting=!unread&&capture.status!=='succeeded';
  if(waiting&&(await db.query('SELECT 1 FROM app.intake_dependencies WHERE capture_job_id=$1',[capture.id])).rowCount)return null;
  const covered:string[]=Array.isArray(capture.research_context?.details?.competitors)?capture.research_context.details.competitors:[];
  const competitors=uncoveredCompetitors(brief.details.competitors,covered);
  return {website:capture.website_url,...(waiting?{after:capture.id}:{}),...(competitors.length?{marketFollowup:{website:capture.website_url,competitors}}:{})};
 }
 /** The early analysis "Send my brief" can adopt: one for the same research answers that
  * finished or is still running, or one with an uncertain outcome, which is shown with its
  * stop-waiting choice and never repeated. Anything else is superseded and research runs as before. */
 private async adoptEarlyAnalysis(db:PoolClient,row:{early_analysis_job_id:string|null;early_analysis_digest:string|null},brief:GuidedBrief):Promise<{id:string;status:string}|null>{
  if(!row.early_analysis_job_id)return null;
  const early=(await db.query('SELECT id,status,cancel_requested FROM app.jobs WHERE id=$1',[row.early_analysis_job_id])).rows[0];
  if(!early)return null;
  if(early.status==='unknown')return {id:early.id,status:early.status};
  const live=!early.cancel_requested&&row.early_analysis_digest===researchDigest(brief);
  if(live&&['succeeded',...ACTIVE].includes(early.status))return {id:early.id,status:early.status};
  if(ACTIVE.includes(early.status)&&!early.cancel_requested)await db.query('SELECT app.supersede_early_analysis($1)',[early.id]);
  return null;
 }
 /** Stage by stage, what the research screen shows, read from saved job and ledger states. */
 private async progress(db:PoolClient,row:{brief:GuidedBrief;research_job_id:string|null;research_kind:string|null;analysis_job_id:string|null;early_analysis_job_id:string|null;early_analysis_current:boolean;prefill_job_id:string|null;prefill_website:string|null}):Promise<ResearchProgress>{
  let website:string|null=null;
  try{website=row.brief.details?.website?websiteURL(row.brief.details.website).href:null;}catch{website=null;}
  const analysisId=row.analysis_job_id??(row.research_kind==='brand.analyze'?row.research_job_id:null)??(!row.research_job_id&&row.early_analysis_current?row.early_analysis_job_id:null);
  const analysis=analysisId?(await db.query(`SELECT a.status,r.market_followup IS NOT NULL AS has_followup,m.status AS followup_market,d.capture_job_id
   FROM app.jobs a JOIN app.intake_requests r ON r.job_id=a.id LEFT JOIN app.market_research_calls m ON m.job_id=a.id LEFT JOIN app.intake_dependencies d ON d.analysis_job_id=a.id WHERE a.id=$1`,[analysisId])).rows[0]:null;
  const captureId=row.research_kind==='website.extract'?row.research_job_id:analysis?.capture_job_id??(row.prefill_website===website?row.prefill_job_id:null);
  const capture=captureId?(await db.query('SELECT j.status,m.status AS market FROM app.jobs j LEFT JOIN app.market_research_calls m ON m.job_id=j.id WHERE j.id=$1',[captureId])).rows[0]:null;
  return researchProgress({hasWebsite:!!website,capture:capture?.status??null,captureMarket:capture?.market??null,analysis:analysis?.status??null,followupMarket:analysis?.followup_market??null,hasFollowup:!!analysis?.has_followup});
 }
 /** Start background research as soon as the answers name a website and an offering.
  * It never blocks saving: any reason not to start leaves the answers saved as they are.
  * A website already researched is never researched again here; a changed website asks
  * the old run to stop and starts once it has. An uncertain run waits for a release. */
 private async earlyResearch(db:PoolClient,user:string,id:string,b:Business,brief:GuidedBrief,finalResearch:boolean):Promise<EarlyResearch>{
  const current=async():Promise<EarlyResearch>=>(await db.query(`SELECT g.prefill_job_id,j.status AS prefill_status,j.error_code AS prefill_error,r.website_url AS prefill_website
   FROM app.guided_business_briefs g LEFT JOIN app.jobs j ON j.id=g.prefill_job_id LEFT JOIN app.intake_requests r ON r.job_id=j.id
   WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,id])).rows[0]??{prefill_job_id:null,prefill_status:null,prefill_error:null,prefill_website:null};
  const before=await current(),website=earlyResearchWebsite(brief);
  if(!website||finalResearch||before.prefill_website===website||before.prefill_status==='unknown')return before;
  if((await db.query('SELECT id FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 LIMIT 1',[b.organization_id,id])).rowCount)return before;
  if(before.prefill_job_id&&ACTIVE.includes(before.prefill_status??'')){
   await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[before.prefill_job_id]);
   return before;
  }
  let job:{id:string};
  try{job=await this.intake.submit(user,id,{kind:'website.extract'},`early-${randomUUID()}`,{db,b:{...b,website},researchContext:brief});}
  catch(error){if(error instanceof ConflictException)return before;throw error;}
  await db.query('UPDATE app.guided_business_briefs SET prefill_job_id=$3 WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id,job.id]);
  await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'guided.early_research_started',$4)",[b.organization_id,id,user,job.id]);
  return current();
 }
 /** The early capture for this exact website, when it finished or is still on its way. */
 private async reusableEarlyCapture(db:PoolClient,prefill:string|null,website:string){
  if(!prefill)return null;
  let target:string;try{target=websiteURL(website).href;}catch{return null;}
  const early=(await db.query('SELECT j.id,j.status,r.website_url,r.research_context FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.id=$1',[prefill])).rows[0];
  if(!early||early.website_url!==target||![...ACTIVE,'succeeded'].includes(early.status))return null;
  if(early.status!=='succeeded'&&(await db.query('SELECT 1 FROM app.intake_dependencies WHERE capture_job_id=$1',[early.id])).rowCount)
   throw new ConflictException('Your research is already waiting for the website check to finish.');
  // Competitors in the early request count as covered whatever its outcome: a paid or
  // possibly paid request is never repeated.
  const covered:string[]=Array.isArray(early.research_context?.details?.competitors)?early.research_context.details.competitors:[];
  return {id:early.id as string,status:early.status as string,website_url:early.website_url as string,covered};
 }
 async research(user:string,id:string,body:unknown,key:unknown){
  const v=object(body,['revision','use_saved_answers']),b=await this.businesses.resolve(user,id);
  if(v.use_saved_answers!==undefined&&typeof v.use_saved_answers!=='boolean')throw new BadRequestException('Choose whether to continue with saved answers');
  if(typeof key!=='string'||!/^[-A-Za-z0-9_.:]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  return this.businesses.database.transaction(user,b.organization_id,true,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guided:${id}`]);
   const row=(await db.query('SELECT * FROM app.guided_business_briefs WHERE organization_id=$1 AND brand_id=$2 FOR UPDATE',[b.organization_id,id])).rows[0];
   if(!row)throw new ConflictException('Save your answers first');
   requireGuidedRevision(row.revision,v.revision);
   const brief=guidedBrief(row.brief,true);
   // A retried "Send my brief" that adopted the early analysis replays it.
   if(row.research_job_id&&row.research_request_key===key){
    const adopted=(await db.query('SELECT id,status FROM app.jobs WHERE id=$1',[row.research_job_id])).rows[0];
    return {id:adopted.id as string,status:adopted.status as string};
   }
   let reuseCapture=false;
   if(v.use_saved_answers&&!row.research_job_id)throw new ConflictException('Submit your brief before continuing with saved answers');
   if(row.research_job_id){
    const previous=(await db.query('SELECT j.id,j.kind,j.status,r.request_key FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.id=$1',[row.research_job_id])).rows[0];
    if(previous.request_key===key)return {id:previous.id,status:previous.status};
    // Completed research is reused. Failures need a new explicit request key.
    const child=(await db.query('SELECT j.status FROM app.intake_dependencies d JOIN app.jobs j ON j.id=d.analysis_job_id WHERE d.capture_job_id=$1',[row.research_job_id])).rows[0];
    if(v.use_saved_answers&&(previous.kind!=='website.extract'||!['failed','rejected','canceled'].includes(previous.status)||(child&&!['failed','rejected','canceled'].includes(child.status))))throw new ConflictException('Only a confirmed website capture failure can continue with saved answers');
    reuseCapture=previous.status==='succeeded'&&!!child&&['failed','rejected','canceled'].includes(child.status);
    if(!reuseCapture&&!['failed','rejected','canceled'].includes(previous.status))throw new ConflictException('Research already exists for these answers. Open your saved progress.');
   }
   // The early analysis already read these exact answers: adopt it, with no new paid call.
   // Adopting comes before any evidence is recorded, which would invalidate a running analysis.
   if(!v.use_saved_answers&&!reuseCapture){
    const adopted=await this.adoptEarlyAnalysis(db,row,brief);
    if(adopted){
     await db.query('UPDATE app.guided_business_briefs SET research_job_id=$3,research_request_key=$4,updated_at=now() WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id,adopted.id,key]);
     await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'guided.early_analysis_adopted',$4)",[b.organization_id,id,user,adopted.id]);
     return adopted;
    }
   }
   // Record answers as user-supplied evidence, without silently confirming any fact.
   await recordBriefEvidence(db,b,id,brief,row.revision);
   const researchBusiness={...b,website:brief.details?brief.details.website:b.website};
   const early=researchBusiness.website&&!reuseCapture&&!v.use_saved_answers?await this.reusableEarlyCapture(db,row.prefill_job_id,researchBusiness.website):null;
   const job=early
    // Early research already read this website: analyse only, waiting for it if it is
    // still running, and research only competitors it did not cover.
    ?await this.intake.submit(user,id,{kind:'brand.analyze'},key,{db,b:researchBusiness,researchContext:brief,...(early.status==='succeeded'?{}:{after:early.id}),
      ...(()=>{const competitors=uncoveredCompetitors(brief.details?.competitors,early.covered);return competitors.length?{marketFollowup:{website:early.website_url,competitors}}:{};})()})
    :await this.intake.submit(user,id,researchBusiness.website&&!reuseCapture&&!v.use_saved_answers?{kind:'website.extract',autoAnalyze:true}:{kind:'brand.analyze'},key,{db,b:researchBusiness,researchContext:brief});
   await db.query('UPDATE app.guided_business_briefs SET research_job_id=$3,updated_at=now() WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id,job.id]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'guided.research_started',$4)",[b.organization_id,id,user,job.id]);
   return job;
  },id);
 }
}

/** Unknown or oversized facts stay blank instead of being guessed or truncated. */
export function initialGuidedBrief(snapshot:unknown){
 const facts=snapshot&&typeof snapshot==='object'&&'facts' in snapshot&&Array.isArray(snapshot.facts)?snapshot.facts:[];
 const approvedText=(field:string,max:number)=>{
  const values=[...new Set(facts.filter(f=>f&&f.field===field&&typeof f.value==='string').map(f=>f.value.trim()))];
  return values.length===1&&values[0].length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(values[0])?values[0]:'';
 };
 return {offering:approvedText('offering',600),audience:approvedText('audience',600),market:'',goal:'awareness',visual_direction:'',must_follow:approvedText('prohibited_claims',800)};
}
