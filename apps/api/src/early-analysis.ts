import type {PoolClient} from 'pg';
import {ConflictException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {hash,canonicalJSON,lockReview,bumpReview} from './brand-brain.js';
import {BUSINESS_RESEARCH_AGENT_VERSION,type GuidedBrief} from './guided-campaign-contracts.js';

/** Statuses of a job that may still run. */
export const ACTIVE_JOB=['queued','running','retrying'];

/** Canonical digest of exactly the answers the business analysis reads. Looks (references,
 * visual direction), folder links, files, guidelines, timing and the social profile are
 * deliberately left out: changing them never restarts the analysis. */
export function researchDigest(brief:GuidedBrief):string{
 const d=brief.details;
 return hash(canonicalJSON({
  name:d?.business_name??'',website:d?.website??'',offering:brief.offering,offering_type:d?.business_type??'',industry:d?.industry??'',
  audience:brief.audience,market:brief.market,goal:brief.goal,cta:d?.cta??'',differentiator:d?.differentiator??'',
  competitors:d?.competitors??[],must_avoid:brief.must_follow,priority_offers:d?.priority_offers??'',
 }));
}

/** Steps 1 and 2 are saved (the owner is on step 3 or later) and the brief has the answers
 * research needs: a business name, what it offers and who it is for. */
export function analysisReady(brief:GuidedBrief,step:number):boolean{
 return step>=2&&!!brief.offering.trim()&&!!brief.audience.trim()&&(!brief.details||!!brief.details.business_name.trim());
}

/** Record the answers as user-supplied evidence, without confirming any fact. Idempotent per
 * brief: the same answers are stored once. The analysis grounds itself only in the snapshot
 * it was submitted with. */
export async function recordBriefEvidence(db:PoolClient,b:{organization_id:string;name?:string},id:string,brief:GuidedBrief,revision:number):Promise<void>{
 await lockReview(db,b.organization_id,id);
 const evidence=canonicalJSON({brand_name:b.name,...brief}),digest=hash(evidence);
 const existing=(await db.query("SELECT id FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND kind='manual' AND sha256=$3 AND parser_version=$4",[b.organization_id,id,digest,BUSINESS_RESEARCH_AGENT_VERSION])).rows[0];
 if(existing)return;
 const usage=(await db.query('SELECT source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0];
 if(usage.source_count>=100)throw new ConflictException('Your business has reached its research source limit');
 const source=randomUUID();
 await db.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,'manual',$4,$5,$6)",[source,b.organization_id,id,digest,BUSINESS_RESEARCH_AGENT_VERSION,JSON.stringify({type:'user_supplied',brief_revision:revision})]);
 await db.query("INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,'campaign-brief',$5)",[randomUUID(),b.organization_id,id,source,evidence]);
 await db.query('UPDATE app.brand_review_state SET source_count=source_count+1 WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id]);
 await bumpReview(db,b.organization_id,id);
}

export type StageState='skipped'|'waiting'|'running'|'done'|'failed'|'unknown';
export type ResearchProgress={website:StageState;market:StageState;analysis:StageState};
/** Job and ledger statuses behind one research run, as read from the database. */
export type ProgressInput={
 hasWebsite:boolean;
 capture:string|null;captureMarket:string|null;
 analysis:string|null;followupMarket:string|null;hasFollowup:boolean;
};
function jobStage(status:string|null):StageState{
 if(!status||status==='queued')return 'waiting';
 if(status==='running'||status==='retrying')return 'running';
 if(status==='succeeded')return 'done';
 return status==='unknown'?'unknown':'failed';
}
/** What the research screen shows, derived only from saved job and ledger states. Market
 * research is best-effort: a refused or uncertain market call is reported as skipped,
 * because the analysis continues without it. */
export function researchProgress(p:ProgressInput):ResearchProgress{
 const website:StageState=p.hasWebsite?jobStage(p.capture):'skipped';
 if(!p.hasWebsite)return {website,market:'skipped',analysis:jobStage(p.analysis)};
 const ledger=(status:string|null):StageState|null=>status==='submitted'?'running':status==='succeeded'?'done':status?'skipped':null;
 // The full market step runs beside the website read; a competitor follow-up runs first in the analysis.
 const full=ledger(p.captureMarket)??(website==='running'?'running':website==='waiting'?'waiting':'skipped');
 const analysis=jobStage(p.analysis);
 const followup=p.hasFollowup?ledger(p.followupMarket)??(analysis==='running'?'running':analysis==='waiting'?'waiting':'skipped'):null;
 const states=[full,...(followup?[followup]:[])];
 const market:StageState=(['running','waiting','done'] as const).find(s=>states.includes(s))??'skipped';
 return {website,market,analysis:jobStage(p.analysis)};
}
