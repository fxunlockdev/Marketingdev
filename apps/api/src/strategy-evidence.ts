/** Saved research for the strategist and the planner: own-site pages, AI market and competitor notes, and the
 * audience suggestions and competitor gaps of the latest analysis. Read inside the caller's business transaction.
 * Market notes are labelled as third-party analysis; nothing here is an approved brand fact. */
import type {PoolClient} from 'pg';
import {MARKET_RESEARCH_VERSION} from './openai-website-research.js';
import {CONTEXT_LIMITS,type Evidence} from './strategy-contracts.js';

export type ResearchSource={id:string;market:boolean;url:string|null;text:string};
export type ResearchDirection={job_id:string;audience_suggestions:string[];competitor_gaps:string[]};
export type SavedResearch={sources:ResearchSource[];direction?:ResearchDirection};
/** How the 60 evidence slots are shared, so one kind of source cannot crowd out the others. */
export const EVIDENCE_SHARE={own:25,market:20,direction:15} as const;
export const PLANNER_MARKET_NOTES=8;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIRECTION_ID=/^analysis:([0-9a-f-]{36}):(audience|gap):\d+$/i;

/** One line of plain text: control characters and runs of white space become single spaces. */
export function flat(text:string,max:number):string{
 const line=text.replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim();
 return line.length<=max?line:`${line.slice(0,max-1)}…`;
}
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'&&!!v.trim()):[];

function sourceEvidence(source:ResearchSource):Evidence|undefined{
 const prefix=source.url?`${flat(source.url,150)}: `:'',summary=flat(`${prefix}${source.text}`,CONTEXT_LIMITS.evidenceSummary);
 return source.text.trim()&&UUID.test(source.id)?{id:source.id,kind:source.market?'market_research':'own_site',summary}:undefined;
}
function directionEvidence(direction:ResearchDirection):Evidence[]{
 if(!UUID.test(direction.job_id))return [];
 const rows=(list:string[],kind:'audience'|'gap',label:string)=>list.map((text,i)=>({id:`analysis:${direction.job_id}:${kind}:${i+1}`,kind:label,summary:flat(text,CONTEXT_LIMITS.evidenceSummary)}));
 return [...rows(direction.audience_suggestions,'audience','audience_suggestion'),...rows(direction.competitor_gaps,'gap','competitor_gap')];
}
/** Evidence for a strategy request: own-site first, then market notes, then the analysis suggestions. Pure and bounded. */
export function researchEvidence(research:SavedResearch):Evidence[]{
 const own=research.sources.filter(s=>!s.market).map(sourceEvidence).filter((e):e is Evidence=>!!e).slice(0,EVIDENCE_SHARE.own);
 const market=research.sources.filter(s=>s.market).map(sourceEvidence).filter((e):e is Evidence=>!!e).slice(0,EVIDENCE_SHARE.market);
 const direction=research.direction?directionEvidence(research.direction).slice(0,EVIDENCE_SHARE.direction):[];
 const seen=new Set<string>();
 return [...own,...market,...direction].filter(e=>!seen.has(e.id)&&!!seen.add(e.id)).slice(0,CONTEXT_LIMITS.evidence);
}
/** Bounded market and competitor notes for a planner. Each is labelled so it is never read as the business's own words. */
export function marketNotes(research:SavedResearch,max:number=PLANNER_MARKET_NOTES):string[]{
 const label='Market research (third-party, not a brand fact): ';
 const notes=research.sources.filter(s=>s.market&&s.text.trim()).map(s=>flat(`${label}${s.url?`${s.url}: `:''}${s.text}`,CONTEXT_LIMITS.noteLength));
 const gaps=(research.direction?.competitor_gaps??[]).map(gap=>flat(`Competitor gap suggested by research (unproven): ${gap}`,CONTEXT_LIMITS.noteLength));
 return [...notes,...gaps].slice(0,Math.min(max,CONTEXT_LIMITS.notes));
}
/** Where a cited evidence id came from, for the knowledge graph: a stored source, or the analysis job. */
export function evidenceOrigin(id:string):{sourceId:string}|{jobId:string}|undefined{
 if(UUID.test(id))return {sourceId:id};
 const match=DIRECTION_ID.exec(id);
 return match&&UUID.test(match[1])?{jobId:match[1]}:undefined;
}

/** Reads the business's saved research. The caller's transaction scopes it to one business. */
export async function savedResearch(db:PoolClient,organization:string,brand:string):Promise<SavedResearch>{
 const {rows}=await db.query(`SELECT s.id,s.website_url AS url,(s.parser_version=$3) AS market,
   COALESCE((SELECT left(string_agg(c.text,' ' ORDER BY c.page,c.id),1500) FROM (SELECT text,page,id FROM app.brand_chunks WHERE organization_id=$1 AND brand_id=$2 AND source_id=s.id ORDER BY page,id LIMIT 3) c),'') AS text
  FROM app.brand_sources s WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.kind='website' ORDER BY s.captured_at DESC,s.id LIMIT 80`,[organization,brand,MARKET_RESEARCH_VERSION]);
 const latest=(await db.query(`SELECT j.id,r.result->'business_direction' AS direction FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id
  WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='brand.analyze' AND j.status='succeeded' AND jsonb_typeof(r.result->'business_direction')='object' ORDER BY j.updated_at DESC,j.id LIMIT 1`,[organization,brand])).rows[0];
 const sources=rows.map(row=>({id:String(row.id),market:row.market===true,url:typeof row.url==='string'?row.url:null,text:String(row.text??'')}));
 return latest?{sources,direction:{job_id:String(latest.id),audience_suggestions:strings(latest.direction?.audience_suggestions),competitor_gaps:strings(latest.direction?.competitor_gaps)}}:{sources};
}
