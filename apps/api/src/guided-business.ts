import {BadRequestException,ConflictException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Businesses} from './businesses.js';
import {Intake} from './intake.js';
import {object} from './workspaces.js';
import {hash,canonicalJSON,lockReview,bumpReview} from './brand-brain.js';
import {guidedBrief,requireGuidedRevision,BUSINESS_RESEARCH_AGENT_VERSION} from './guided-campaign-contracts.js';
/** A saved brief and its research share one transaction. Worker results remain unapproved. */
export class GuidedBusiness {
 constructor(readonly businesses:Businesses,readonly intake:Intake){}
 async read(user:string,id:string){
  const b=await this.businesses.resolve(user,id);
  return this.businesses.database.transaction(user,b.organization_id,false,async db=>{
   const row=(await db.query(`SELECT g.revision,g.step,g.brief,g.research_job_id,g.updated_at,j.status,j.error_code,r.result,
    (j.kind='website.extract' AND j.status IN ('failed','rejected','canceled') AND (child.id IS NULL OR child.status IN ('failed','rejected','canceled'))) AS can_use_saved_answers,
    EXISTS(SELECT 1 FROM app.guided_moodboards m WHERE m.organization_id=g.organization_id AND m.brand_id=g.brand_id) AS answers_locked,
    child.id AS analysis_job_id,child.status AS analysis_status,child.error_code AS analysis_error,cr.result AS analysis_result
    FROM app.guided_business_briefs g LEFT JOIN app.jobs j ON j.id=g.research_job_id
    LEFT JOIN app.intake_requests r ON r.job_id=j.id LEFT JOIN app.intake_dependencies d ON d.capture_job_id=j.id
    LEFT JOIN app.jobs child ON child.id=d.analysis_job_id LEFT JOIN app.intake_requests cr ON cr.job_id=child.id
    WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,id])).rows[0];
   // Saved answers win, including intentional empty fields. Only a new brief
   // may borrow facts from this business's immutable approved profile.
   if(row)return row;
   const approved=(await db.query('SELECT snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY review_revision DESC LIMIT 1',[b.organization_id,id])).rows[0];
   return {revision:0,step:0,brief:initialGuidedBrief(approved?.snapshot),research_job_id:null};
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
   if(same&&step===row.step)return {revision:row.revision,step,brief};
   if(row?.research_job_id){
    const active=(await db.query(`SELECT j.status FROM app.jobs j WHERE j.id=$1 OR j.id IN (SELECT analysis_job_id FROM app.intake_dependencies WHERE capture_job_id=$1)`,[row.research_job_id])).rows;
    if(active.some(j=>['queued','running','retrying','unknown'].includes(j.status)))throw new ConflictException('Research is still being checked. Your saved answers cannot change yet.');
   }
   // Moving between questions must retain the completed research snapshot.
   if(!same&&(await db.query('SELECT id FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 LIMIT 1',[b.organization_id,id])).rowCount)throw new ConflictException('Your mood board already uses these answers. Keep this saved direction while completing onboarding.');
   const saved=(await db.query(`INSERT INTO app.guided_business_briefs(organization_id,brand_id,brief,step) VALUES($1,$2,$3,$4)
    ON CONFLICT(organization_id,brand_id) DO UPDATE SET brief=EXCLUDED.brief,step=EXCLUDED.step,revision=guided_business_briefs.revision+1,research_job_id=CASE WHEN $5 THEN guided_business_briefs.research_job_id ELSE NULL END,updated_at=now() RETURNING revision,step,brief`,[b.organization_id,id,JSON.stringify(brief),step,same])).rows[0];
   return saved;
  },id);
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
   // Record answers as user-supplied evidence, without silently confirming any fact.
   await lockReview(db,b.organization_id,id);
   const evidence=canonicalJSON({brand_name:b.name,...brief}),digest=hash(evidence);
   const existing=(await db.query("SELECT id FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND kind='manual' AND sha256=$3 AND parser_version=$4",[b.organization_id,id,digest,BUSINESS_RESEARCH_AGENT_VERSION])).rows[0];
   if(!existing){
    const usage=(await db.query('SELECT source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0];
    if(usage.source_count>=100)throw new ConflictException('Your business has reached its research source limit');
    const source=randomUUID();
    await db.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,'manual',$4,$5,$6)",[source,b.organization_id,id,digest,BUSINESS_RESEARCH_AGENT_VERSION,JSON.stringify({type:'user_supplied',brief_revision:row.revision})]);
    await db.query("INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,'campaign-brief',$5)",[randomUUID(),b.organization_id,id,source,evidence]);
    await db.query('UPDATE app.brand_review_state SET source_count=source_count+1 WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id]);
    await bumpReview(db,b.organization_id,id);
   }
   const researchBusiness={...b,website:brief.details?brief.details.website:b.website};
   const job=await this.intake.submit(user,id,researchBusiness.website&&!reuseCapture&&!v.use_saved_answers?{kind:'website.extract',autoAnalyze:true}:{kind:'brand.analyze'},key,{db,b:researchBusiness,researchContext:brief});
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
