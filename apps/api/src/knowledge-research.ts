/** Research → knowledge graph, on the worker.
 *
 * After a website/market research job or a brand analysis succeeds, the sources it added are
 * read by the extraction model (knowledge-extract.ts) and the validated answer is written to the
 * graph as 'suggested' rows. This step is a bonus, never a gate: every failure is recorded in
 * app.knowledge_extraction_calls and skipped, and the research job's outcome never changes.
 *
 * One ledger row per job, written before the call: a replay never pays twice, and a call that
 * succeeded but was not yet applied is applied from the stored answer without a second call.
 * Each row also lists the brand sources it read, so a later job never pays for the same page.
 *
 * Market research describes other businesses. Its evidence can support a competitor, or an
 * audience, persona or pain in the market (tagged as market insight), but never a claim about
 * this business's own offers, proof or voice.
 */
import OpenAI from 'openai';
import {canonicalJSON,hash} from './brand-brain.js';
import {logActivityFailure} from './activity-log.js';
import {exceedsAllowance,monthlyBudgetExceeded} from './spending-allowance.js';
import {reservationRates,MODEL_POLICY} from './model-policy.js';
import {MARKET_RESEARCH_VERSION} from './openai-website-research.js';
import {extractionRequest,validateExtraction,EXTRACTION_LIMITS,type ExtractionRequest,type ExtractionSource} from './knowledge-extract.js';
import {applyMutations,KnowledgeError,refId,type EdgeMutation,type EvidenceRef,type GraphMutations,type NodeMutation,type NodeType,type Relation} from './knowledge-graph.js';
import type {AssetJobs,JobScope} from './jobs.js';

export const MARKET_NOTE='Market research about other businesses, not a fact about this business.';
/** Types a market page can say something true about without it being this business's own claim. */
const MARKET_TYPES:readonly NodeType[]=['competitor','audience','persona','pain'];
const MARKET_RELATIONS:readonly Relation[]=['differentiates_from','belongs_to','has_pain','related_to'];
export const RESEARCH_EXTRACTION_LIMITS={sources:24,sourceChars:6000,totalChars:60000,marketChars:18000,candidates:200,knownNodes:200,inputAllowance:4096,timeoutMs:60000} as const;
const KINDS=['website.extract','brand.analyze'];

type Claim=NodeMutation|EdgeMutation;
const isMarket=(ref:EvidenceRef,market:ReadonlySet<string>):boolean=>!!ref.sourceId&&market.has(ref.sourceId);
/** A claim with evidence that all comes from market pages. Evidence-free inferences are left as they are. */
const marketOnly=(claim:Claim,market:ReadonlySet<string>):boolean=>claim.evidence.length>0&&claim.evidence.every(ref=>isMarket(ref,market));
const ownEvidence=<T extends Claim>(claim:T,market:ReadonlySet<string>):T=>({...claim,evidence:claim.evidence.filter(ref=>!isMarket(ref,market))});
function marketClaim<T extends Claim>(claim:T,keepOrigin:boolean):T{
 const summary=typeof claim.properties.summary==='string'&&claim.properties.summary?`${MARKET_NOTE} ${claim.properties.summary}`:MARKET_NOTE;
 const properties={...claim.properties,scope:'market',...('label' in claim?{summary:summary.slice(0,EXTRACTION_LIMITS.summary+MARKET_NOTE.length+1)}:{})};
 return keepOrigin?{...claim,properties}:{...claim,properties,origin:'inferred',confidence:Math.min(claim.confidence,EXTRACTION_LIMITS.inferredConfidence)};
}

/** Keeps market evidence from ever standing as this business's own facts. Pure. */
export function scopeMarketEvidence(mutations:GraphMutations,market:ReadonlySet<string>):GraphMutations{
 if(!market.size)return mutations;
 const nodes=mutations.nodes.flatMap(node=>{
  if(marketOnly(node,market))return MARKET_TYPES.includes(node.type)?[marketClaim(node,node.type==='competitor')]:[];
  return [MARKET_TYPES.includes(node.type)?node:ownEvidence(node,market)];
 });
 const kept=new Set(nodes.map(node=>refId(node)));
 const edges=mutations.edges.flatMap(edge=>{
  if(!kept.has(refId(edge.from))||!kept.has(refId(edge.to)))return [];
  if(marketOnly(edge,market))return MARKET_RELATIONS.includes(edge.relation)?[marketClaim(edge,false)]:[];
  return [MARKET_RELATIONS.includes(edge.relation)?edge:ownEvidence(edge,market)];
 });
 return {nodes,edges};
}

export type SourceRow={readonly id:string;readonly url:string|null;readonly market:boolean;readonly text:string};
export type BuiltSources={sources:ExtractionSource[];market:Set<string>;sourceIds:string[]};
/** The business's own pages first, then a bounded share of market pages. Ids shown to the model are short and meaningless. */
export function extractionSources(rows:readonly SourceRow[]):BuiltSources{
 const limits=RESEARCH_EXTRACTION_LIMITS,sources:ExtractionSource[]=[],market=new Set<string>();
 let total=0,marketTotal=0,own=0,rival=0;
 const ordered=[...rows.filter(row=>!row.market),...rows.filter(row=>row.market)];
 for(const row of ordered){
  if(sources.length>=limits.sources)break;
  const room=Math.min(limits.sourceChars,limits.totalChars-total,row.market?limits.marketChars-marketTotal:Infinity);
  const text=row.text.trim().slice(0,Math.max(0,room));
  if(!text)continue;
  const id=row.market?`m${++rival}`:`s${++own}`;
  sources.push({id,text,sourceId:row.id,...(row.url&&/^https?:\/\//.test(row.url)?{sourceUrl:row.url}:{})});
  total+=text.length;
  if(row.market){marketTotal+=text.length;market.add(row.id);}
 }
 return {sources,market,sourceIds:sources.map(source=>source.sourceId!)};
}

export type Reservation={maxInputTokens:number;maxOutputTokens:number;micros:number};
/** Reserves the full prompt (one token per byte, plus schema overhead) and the full output allowance. */
export function extractionReservation(request:ExtractionRequest):Reservation{
 const rates=reservationRates('check');
 const maxInputTokens=Buffer.byteLength(request.instructions)+Buffer.byteLength(request.input)+RESEARCH_EXTRACTION_LIMITS.inputAllowance;
 const maxOutputTokens=request.max_output_tokens;
 return {maxInputTokens,maxOutputTokens,micros:Math.ceil(maxInputTokens*rates.input_micros_per_token+maxOutputTokens*rates.output_micros_per_token)};
}

export type ExtractionAnswer={id:string;text:string;usage:unknown};
/** The one model call. No tools, nothing stored at the provider, never retried. */
export class KnowledgeExtractor{
 readonly sdk?:OpenAI;
 constructor(key?:string,sdk?:OpenAI){this.sdk=sdk??(key?new OpenAI({apiKey:key,maxRetries:0,timeout:RESEARCH_EXTRACTION_LIMITS.timeoutMs}):undefined);}
 get configured():boolean{return !!this.sdk;}
 async extract(request:ExtractionRequest):Promise<ExtractionAnswer>{
  if(!this.sdk)throw new KnowledgeError('KNOWLEDGE_NOT_CONFIGURED');
  const response=await this.sdk.responses.create(request,{timeout:RESEARCH_EXTRACTION_LIMITS.timeoutMs});
  if(response.status!=='completed'||response.output.some(item=>item.type==='message'&&item.content.some(part=>part.type==='refusal')))throw new KnowledgeError('KNOWLEDGE_RESPONSE_INCOMPLETE');
  return {id:response.id,text:response.output_text,usage:response.usage??null};
 }
}

export type ExtractionOutcome='applied'|'recorded'|'skipped'|'failed'|'not_applicable';
type Prepared={kind:'none'}|{kind:'done';outcome:ExtractionOutcome}|{kind:'apply';mutations:GraphMutations}|{kind:'call';request:ExtractionRequest;built:BuiltSources};
const RESERVED_SQL=`SELECT COALESCE(sum(reserved_micros),0) AS used FROM (
 SELECT reserved_micros FROM app.analysis_calls WHERE organization_id=$1 AND brand_id=$2
 UNION ALL SELECT reserved_micros FROM app.market_research_calls WHERE organization_id=$1 AND brand_id=$2
 UNION ALL SELECT reserved_micros FROM app.knowledge_extraction_calls WHERE organization_id=$1 AND brand_id=$2) reservations`;
// Market rows are tagged by their parser version, or by the coverage note written with them.
const SOURCES_SQL=`SELECT s.id,s.website_url AS url,(s.parser_version=$3 OR s.coverage->>'origin'='market') AS market,
 left(string_agg(c.text,E'\\n' ORDER BY c.page,c.id),$5) AS text
 FROM app.brand_sources s JOIN app.brand_chunks c ON c.source_id=s.id AND c.organization_id=s.organization_id AND c.brand_id=s.brand_id
 WHERE s.organization_id=$1 AND s.brand_id=$2 AND NOT (s.id=ANY($4::uuid[]))
 GROUP BY s.id ORDER BY s.captured_at DESC,s.id LIMIT $6`;

export class ResearchKnowledge{
 constructor(readonly jobs:AssetJobs,readonly extractor:KnowledgeExtractor){}
 /** Runs after an intake job succeeded. Never throws and never changes the job. */
 async afterSuccess(scope:JobScope):Promise<ExtractionOutcome>{
  try{
   const prepared=await this.prepare(scope).catch(error=>{if(monthlyBudgetExceeded(error))return this.skip(scope,'MONTHLY_GENERATION_BUDGET_EXHAUSTED');throw error;});
   if(prepared.kind==='none')return 'not_applicable';
   if(prepared.kind==='done')return prepared.outcome;
   const mutations=prepared.kind==='apply'?prepared.mutations:await this.call(scope,prepared.request,prepared.built);
   return mutations?await this.apply(scope,mutations):'failed';
  }catch(error){logActivityFailure('KnowledgeExtraction',scope,error);return 'failed';}
 }
 private prepare(scope:JobScope):Promise<Prepared>{
  return this.jobs.transaction(scope,async(db,job):Promise<Prepared>=>{
   if(!KINDS.includes(job.kind)||job.status!=='succeeded')return {kind:'none'};
   // Concurrent intake jobs of one business must not both pick up the same new sources.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`knowledge-extract:${job.brand_id.toLowerCase()}`]);
   const prior=(await db.query('SELECT status,applied_at,result FROM app.knowledge_extraction_calls WHERE job_id=$1',[job.id])).rows[0];
   if(prior)return prior.status==='succeeded'&&!prior.applied_at?{kind:'apply',mutations:prior.result}:{kind:'done',outcome:prior.applied_at?'applied':'recorded'};
   const skip=async(code:string):Promise<Prepared>=>{await this.insertSkip(db,job,code);return {kind:'done',outcome:'skipped'};};
   if(!this.extractor.configured)return skip('AI_NOT_CONFIGURED');
   const grant=(await db.query('SELECT budget_micros FROM app.analysis_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()',[job.organization_id,job.brand_id])).rows[0];
   if(!grant)return skip('KNOWLEDGE_GRANT_MISSING');
   const covered=(await db.query('SELECT DISTINCT unnest(source_ids) AS id FROM app.knowledge_extraction_calls WHERE organization_id=$1 AND brand_id=$2',[job.organization_id,job.brand_id])).rows.map((row:{id:string})=>row.id);
   const rows=(await db.query(SOURCES_SQL,[job.organization_id,job.brand_id,MARKET_RESEARCH_VERSION,covered,RESEARCH_EXTRACTION_LIMITS.sourceChars,RESEARCH_EXTRACTION_LIMITS.candidates])).rows;
   const built=extractionSources(rows.map((row:{id:string;url:string|null;market:boolean;text:string|null})=>({id:row.id,url:row.url,market:row.market===true,text:row.text??''})));
   if(!built.sources.length)return skip('KNOWLEDGE_NOTHING_NEW');
   const known=(await db.query("SELECT type,label FROM app.knowledge_nodes WHERE organization_id=$1 AND brand_id=$2 AND status<>'rejected' ORDER BY last_seen DESC,id LIMIT $3",[job.organization_id,job.brand_id,RESEARCH_EXTRACTION_LIMITS.knownNodes])).rows;
   const request=extractionRequest({businessName:await businessName(db,job),sources:built.sources,jobId:job.id,known});
   const reservation=extractionReservation(request),used=Number((await db.query(RESERVED_SQL,[job.organization_id,job.brand_id])).rows[0].used);
   if(!Number.isSafeInteger(reservation.micros)||reservation.micros<=0||exceedsAllowance(used+reservation.micros,grant.budget_micros))return skip('KNOWLEDGE_BUDGET_EXHAUSTED');
   // Written before the call: a crash after this point consumes the reservation but can never pay twice.
   await db.query("INSERT INTO app.knowledge_extraction_calls(job_id,organization_id,brand_id,model,reserved_micros,input_sha256,source_ids,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')",
    [job.id,job.organization_id,job.brand_id,request.model,reservation.micros,hash(canonicalJSON(request)),built.sourceIds]);
   return {kind:'call',request,built};
  });
 }
 private insertSkip(db:{query:(sql:string,values:unknown[])=>Promise<unknown>},job:{id:string;organization_id:string;brand_id:string},code:string):Promise<unknown>{
  return db.query("INSERT INTO app.knowledge_extraction_calls(job_id,organization_id,brand_id,model,reserved_micros,status,error_code) VALUES($1,$2,$3,$4,0,'skipped',$5) ON CONFLICT(job_id) DO NOTHING",[job.id,job.organization_id,job.brand_id,MODEL_POLICY.check.model,code]);
 }
 private async skip(scope:JobScope,code:string):Promise<Prepared>{
  await this.jobs.transaction(scope,db=>this.insertSkip(db,{id:scope.jobId,organization_id:scope.organizationId,brand_id:scope.brandId},code));
  return {kind:'done',outcome:'skipped'};
 }
 private record(scope:JobScope,status:string,code:string|null,answer?:ExtractionAnswer,result?:GraphMutations):Promise<unknown>{
  return this.jobs.transaction(scope,db=>db.query('UPDATE app.knowledge_extraction_calls SET status=$2,error_code=$3,response_id=COALESCE($4,response_id),usage=COALESCE($5,usage),result=COALESCE($6,result) WHERE job_id=$1',
   [scope.jobId,status,code,answer?.id??null,answer?JSON.stringify(answer.usage):null,result?JSON.stringify(result):null]));
 }
 private async call(scope:JobScope,request:ExtractionRequest,built:BuiltSources):Promise<GraphMutations|null>{
  let answer:ExtractionAnswer;
  try{answer=await this.extractor.extract(request);}catch(error){
   const known=error instanceof OpenAI.APIError&&[400,401,403,404,422,429].includes(error.status??0);
   const declined=known||error instanceof KnowledgeError;
   await this.record(scope,declined?'rejected':'unknown',declined?'KNOWLEDGE_PROVIDER_REJECTED':'KNOWLEDGE_SUBMISSION_UNKNOWN');
   logActivityFailure('KnowledgeExtraction',scope,error);
   return null;
  }
  let mutations:GraphMutations;
  try{mutations=scopeMarketEvidence(validateExtraction(answer.text,{sources:built.sources,jobId:scope.jobId}),built.market);}catch(error){
   if(!(error instanceof KnowledgeError))throw error;
   await this.record(scope,'rejected','KNOWLEDGE_EXTRACTION_INVALID',answer);
   return null;
  }
  // Saved before it is applied: applying again later never calls the provider again.
  await this.record(scope,'succeeded',null,answer,mutations);
  return mutations;
 }
 private async apply(scope:JobScope,mutations:GraphMutations):Promise<ExtractionOutcome>{
  try{
   await this.jobs.transaction(scope,async db=>{
    await applyMutations(db,scope,mutations);
    await db.query('UPDATE app.knowledge_extraction_calls SET applied_at=now(),error_code=NULL WHERE job_id=$1',[scope.jobId]);
   });
   return 'applied';
  }catch(error){
   logActivityFailure('KnowledgeExtraction',scope,error);
   await this.record(scope,'succeeded',error instanceof KnowledgeError?'KNOWLEDGE_APPLY_REJECTED':'KNOWLEDGE_APPLY_FAILED').catch(()=>undefined);
   return 'failed';
  }
 }
}

/** The analysis job can read the reviewed brand name; a capture job falls back to its website. */
async function businessName(db:{query:(sql:string,values:unknown[])=>Promise<{rows:{value?:string;website_url?:string|null}[]}>},job:{id:string;organization_id:string;brand_id:string}):Promise<string>{
 const named=(await db.query("SELECT value FROM app.brand_findings WHERE organization_id=$1 AND brand_id=$2 AND field='brand_name' AND status<>'wrong' ORDER BY (status='unreviewed'),id LIMIT 1",[job.organization_id,job.brand_id])).rows[0]?.value;
 if(named?.trim())return named.trim().slice(0,200);
 const site=(await db.query('SELECT website_url FROM app.intake_requests WHERE job_id=$1',[job.id])).rows[0]?.website_url;
 try{return site?new URL(site).hostname.replace(/^www\./,''):'This business';}catch{return 'This business';}
}
