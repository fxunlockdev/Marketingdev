/** The planner's view of what Desvio knows about a business, and what a saved plan adds back.
 *
 * - planningContextSource: read in the API's business transaction when a plan is requested. It returns the
 *   knowledge-graph context pack, bounded market notes and preferences learned from the customer's own
 *   decisions. Every part is optional; an empty graph adds nothing to the planner input.
 * - recordPlanPosts: run by the planning worker after a plan is saved. One `post` node per planned slot and
 *   `used_in` edges from the strategy persona, pain, angle, format and pillar it was planned from, so the
 *   next pack's ledger shows what this month already covers. Everything it writes is a suggestion.
 */
import type {PoolClient} from 'pg';
import type {LearnedPreference,PlanningContext,StrategyRef} from './planning-contracts.js';
import type {StrategySnapshot} from './strategy-contracts.js';
import {signalSummary,type PreferenceStatement} from './learning-signals.js';
import {packForJob,promptKnowledge} from './knowledge-production.js';
import {marketNotes,savedResearch} from './strategy-evidence.js';
import {applyMutations,normalizeKey,refId,KNOWLEDGE_LIMITS,type AppliedMutations,type EdgeMutation,type GraphMutations,type KnowledgeScope,type NodeMutation,type NodeRef} from './knowledge-graph.js';
import {strategyNodeRef} from './strategy-graph.js';

/** What a context source supplies: the planner context plus the graph nodes it drew on, kept as provenance. */
export type SuppliedPlanningContext=PlanningContext&{used_node_ids?:string[]};
export type PlanningScope={organization_id:string;brand_id:string};
export type PlanningRequestText={brief:string;goal?:string};
export const PLANNER_PREFERENCES=10;

const AVOID_KINDS:ReadonlySet<PreferenceStatement['kind']>=new Set(['rejection_reason','change_request','regeneration','stock']);
/** Signal statements as soft planner constraints: what was rejected or reworked is "avoid", what was approved or edited towards is "prefer". */
export function learnedPreferences(statements:readonly PreferenceStatement[]):LearnedPreference[]{
 return statements.slice(0,PLANNER_PREFERENCES).map(s=>({kind:AVOID_KINDS.has(s.kind)||(s.kind==='decision'&&s.statement.startsWith('Rejects'))?'avoid' as const:'prefer' as const,statement:s.statement.slice(0,500)}));
}

/** Context source for `new Planning(plans, planningContextSource)`. Reads customer-scoped tables, so it runs in the API transaction. */
export async function planningContextSource(db:PoolClient,scope:PlanningScope,request?:PlanningRequestText):Promise<SuppliedPlanningContext>{
 const graph:KnowledgeScope={organizationId:scope.organization_id,brandId:scope.brand_id};
 const stored=await packForJob(db,graph,'plan',[request?.goal,request?.brief].filter(Boolean).join('\n')||'monthly content plan');
 const prompt=promptKnowledge(stored),notes=marketNotes(await savedResearch(db,scope.organization_id,scope.brand_id)),preferences=learnedPreferences(await signalSummary(db));
 return {...(prompt?{context_pack:prompt}:{}),...(notes.length?{market_research:notes}:{}),...(preferences.length?{preferences_learned:preferences}:{}),
  ...(prompt&&stored.status==='ready'&&stored.used_node_ids.length?{used_node_ids:stored.used_node_ids}:{})};
}

export type PlannedSlot={id:string;hook:string;format:string;pillar:string;creative_spec?:{placement?:string}|null;strategy_ref?:StrategyRef|null};
const clip=(text:string):string=>{const line=text.replace(/\s+/g,' ').trim()||'Planned post';return line.length<=KNOWLEDGE_LIMITS.label?line:`${line.slice(0,KNOWLEDGE_LIMITS.label-1)}…`;};
/** The strategy format a slot delivers: a feed image is static, a full-screen image a story, a video a reel. */
export function slotFormat(slot:Pick<PlannedSlot,'format'|'creative_spec'>):string{
 return slot.format==='video'?'reel':slot.format==='carousel'?'carousel':slot.creative_spec?.placement==='story'?'story':'static';
}
/** Graph refs a slot was planned from, by the same keys the approved strategy was stored under. */
export function slotSources(slot:PlannedSlot,strategy?:StrategySnapshot):NodeRef[]{
 const refs:(NodeRef|undefined)[]=[strategyNodeRef('format',slotFormat(slot))];
 const ref=slot.strategy_ref;
 if(strategy&&ref){
  const persona=strategy.personas.find(p=>p.id===ref.persona_id),pain=strategy.pains.find(p=>p.id===ref.pain_id),angle=strategy.angles.find(a=>a.id===ref.angle_id);
  refs.push(persona&&strategyNodeRef('persona',persona.name),pain&&strategyNodeRef('pain',pain.statement),angle&&strategyNodeRef('angle',angle.angle));
 }
 const pillar=strategy?.pillars.find(p=>p.name.trim().toLowerCase()===slot.pillar.trim().toLowerCase());
 if(pillar)refs.push(strategyNodeRef('pillar',pillar.name));
 return refs.filter((r):r is NodeRef=>!!r);
}
/** Post nodes and used_in edges for a saved plan. Pure; `existing` holds the refs of nodes that are in the graph. */
export function planPostMutations(jobId:string,slots:readonly PlannedSlot[],strategy:StrategySnapshot|undefined,existing:ReadonlySet<string>):GraphMutations{
 const evidence=[{jobId,excerpt:''}],nodes:NodeMutation[]=[],edges:EdgeMutation[]=[];
 for(const slot of slots.slice(0,KNOWLEDGE_LIMITS.batch)){
  const post:NodeRef={type:'post',key:normalizeKey(`plan slot ${slot.id}`)};
  nodes.push({...post,label:clip(slot.hook),properties:{slot_id:slot.id,format:slot.format,planned:true},status:'suggested',origin:'extracted',confidence:1,evidence});
  for(const from of slotSources(slot,strategy)){
   if(!existing.has(refId(from))||edges.length>=KNOWLEDGE_LIMITS.batch)continue;
   edges.push({from,to:post,relation:'used_in',properties:{},status:'suggested',origin:'extracted',confidence:1,evidence:[]});
  }
 }
 return {nodes,edges};
}
/** Writes the plan's post nodes in the worker's job transaction. Only links to nodes that exist and are not rejected. */
export async function recordPlanPosts(db:PoolClient,scope:KnowledgeScope,jobId:string,slots:readonly PlannedSlot[],strategy?:StrategySnapshot):Promise<AppliedMutations>{
 const wanted=[...new Map(slots.flatMap(slot=>slotSources(slot,strategy)).map(ref=>[refId(ref),ref])).values()];
 const existing=wanted.length?new Set((await db.query("SELECT type,key FROM app.knowledge_nodes WHERE organization_id=$1 AND brand_id=$2 AND status<>'rejected' AND superseded_by IS NULL AND (type,key) IN (SELECT * FROM unnest($3::text[],$4::text[]))",
  [scope.organizationId,scope.brandId,wanted.map(r=>r.type),wanted.map(r=>r.key)])).rows.map((r:NodeRef)=>refId(r))):new Set<string>();
 return applyMutations(db,scope,planPostMutations(jobId,slots,strategy,existing));
}
