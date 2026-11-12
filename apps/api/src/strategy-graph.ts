import type {BrandStrategy,Citation} from './strategy-contracts.js';
import {KNOWLEDGE_LIMITS,normalizeKey,refId,type EdgeMutation,type EvidenceRef,type GraphMutations,type NodeMutation,type NodeRef,type Relation} from './knowledge-graph.js';

/** Graphify's two edge classes: EXTRACTED is backed by a cited source, INFERRED is a hypothesis. */
export type GraphConfidence='EXTRACTED'|'INFERRED';
export type StrategyNode={id:string;type:'persona'|'pain'|'angle'|'format'|'pillar';label:string;confidence:GraphConfidence;properties:Record<string,string|boolean>};
export type StrategyEdge={source:string;target:string;type:'has_pain'|'addressed_by'|'targeted_by'|'delivered_as'|'serves'|'supported_by';confidence:GraphConfidence};
export type StrategyGraph={nodes:StrategyNode[];edges:StrategyEdge[]};

const confidence=(item:{basis:string})=>item.basis==='proven'?'EXTRACTED' as const:'INFERRED' as const;
/** Citation edges point at `fact:<id>` and `evidence:<id>`; those nodes belong to the knowledge graph. */
const support=(id:string,item:Citation):StrategyEdge[]=>[...item.fact_ids.map(fact=>`fact:${fact}`),...item.evidence_ids.map(evidence=>`evidence:${evidence}`)].map(target=>({source:id,target,type:'supported_by' as const,confidence:'EXTRACTED' as const}));

/** Pure mapping of a brand strategy to graph data. No ids are invented and nothing is stored. */
export function strategyToGraph(strategy:BrandStrategy):StrategyGraph{
 const angleConfidence=new Map(strategy.angles.map(angle=>[angle.id,confidence(angle)]));
 const nodes:StrategyNode[]=[
  ...strategy.personas.map(p=>({id:p.id,type:'persona' as const,label:p.name,confidence:confidence(p),properties:{life_situation:p.life_situation,relationship_to_problem:p.relationship_to_problem,why_this_brand:p.why_this_brand}})),
  ...strategy.pains.map(p=>({id:p.id,type:'pain' as const,label:p.statement,confidence:confidence(p),properties:{anchor:p.anchor}})),
  ...strategy.angles.map(a=>({id:a.id,type:'angle' as const,label:a.angle,confidence:confidence(a),properties:{awareness:a.awareness}})),
  ...strategy.formats.map(f=>({id:f.id,type:'format' as const,label:f.format,confidence:angleConfidence.get(f.angle_id)??'INFERRED' as const,properties:{format:f.format,rationale:f.rationale}})),
  ...strategy.pillars.map(p=>({id:p.id,type:'pillar' as const,label:p.name,confidence:confidence(p),properties:{purpose:p.purpose}})),
 ];
 const edges:StrategyEdge[]=[
  ...strategy.pains.map(p=>({source:p.persona_id,target:p.id,type:'has_pain' as const,confidence:confidence(p)})),
  ...strategy.angles.flatMap(a=>[{source:a.pain_id,target:a.id,type:'addressed_by' as const,confidence:confidence(a)},{source:a.persona_id,target:a.id,type:'targeted_by' as const,confidence:confidence(a)}]),
  ...strategy.formats.map(f=>({source:f.angle_id,target:f.id,type:'delivered_as' as const,confidence:'INFERRED' as const})),
  ...strategy.pillars.flatMap(p=>p.persona_ids.map(persona=>({source:p.id,target:persona,type:'serves' as const,confidence:confidence(p)}))),
  ...[...strategy.personas,...strategy.pains,...strategy.angles,...strategy.pillars].flatMap(item=>support(item.id,item)),
 ];
 return {nodes,edges};
}

/** What a strategy citation points at in the knowledge graph: a fact's node, or a stored source or job. Built by the caller from what exists. */
export type CitationTargets={facts:ReadonlyMap<string,NodeRef>;evidence:ReadonlyMap<string,EvidenceRef>};
const KIND_TYPE={persona:'persona',pain:'pain',angle:'angle',format:'format',pillar:'pillar'} as const;
/** Each strategy relation in the graph's vocabulary, with its direction: `reverse` swaps source and target. */
const RELATION:Readonly<Record<StrategyEdge['type'],{relation:Relation;reverse:boolean}|undefined>>={
 has_pain:{relation:'has_pain',reverse:false},addressed_by:{relation:'solves',reverse:true},targeted_by:{relation:'targets',reverse:true},
 delivered_as:{relation:'related_to',reverse:false},serves:{relation:'targets',reverse:false},supported_by:undefined,
};
const MAX_PROOFS_PER_ITEM=3;
const safeKey=(text:string):string|undefined=>{try{return normalizeKey(text);}catch{return undefined;}};
const clipLabel=(text:string):string=>{const line=text.replace(/\s+/g,' ').trim();return line.length<=KNOWLEDGE_LIMITS.label?line:`${line.slice(0,KNOWLEDGE_LIMITS.label-1)}…`;};

/** The node key for a strategy item: its name, so the same persona or angle in a later version merges into one node. */
export function strategyNodeRef(type:StrategyNode['type'],label:string):NodeRef|undefined{
 const key=safeKey(type==='format'?label:label.slice(0,400));return key?{type:KIND_TYPE[type],key}:undefined;
}

/** Graph mutations for an owner-approved strategy. Proven items become approved knowledge; unproven items stay
 * suggestions (so packs mark them "unproven"). Fact citations become `proves` edges from the fact's node, and
 * evidence citations become evidence rows. Citations with no target in `targets` are skipped. */
export function strategyMutations(strategy:BrandStrategy,targets:CitationTargets):GraphMutations{
 const graph=strategyToGraph(strategy),refs=new Map<string,NodeRef>(),status=new Map<string,'approved'|'suggested'>();
 const cites=new Map<string,Citation>([...strategy.personas,...strategy.pains,...strategy.angles,...strategy.pillars].map(item=>[item.id,item]));
 const nodes:NodeMutation[]=graph.nodes.flatMap(node=>{
  const ref=strategyNodeRef(node.type,node.label);if(!ref)return [];
  const proven=node.type==='format'||node.confidence==='EXTRACTED',citation=cites.get(node.id);
  refs.set(node.id,ref);status.set(node.id,proven?'approved':'suggested');
  const summary=[node.properties.life_situation,node.properties.relationship_to_problem,node.properties.purpose,node.type==='pain'||node.type==='angle'?node.label:undefined].filter((v):v is string=>typeof v==='string').join(' ');
  const properties={...(summary?{summary:summary.slice(0,1500)}:{}),...(node.type==='angle'?{awareness:node.properties.awareness}:{}),...(node.type==='pain'?{anchor:node.properties.anchor}:{}),...(node.type==='persona'?{why_this_brand:String(node.properties.why_this_brand).slice(0,500)}:{}),source:'brand_strategy'};
  const evidence=(citation?.evidence_ids??[]).map(id=>targets.evidence.get(id)).filter((e):e is EvidenceRef=>!!e);
  return [{...ref,label:clipLabel(node.label),properties,status:proven?'approved' as const:'suggested' as const,origin:node.type==='format'?'owner' as const:proven?'extracted' as const:'inferred' as const,confidence:proven?1:0.7,evidence}];
 });
 const seen=new Set<string>(),edges:EdgeMutation[]=[];
 const add=(edge:EdgeMutation)=>{const id=`${refId(edge.from)}>${edge.relation}>${refId(edge.to)}`;if(refId(edge.from)===refId(edge.to)||seen.has(id)||edges.length>=KNOWLEDGE_LIMITS.batch)return;seen.add(id);edges.push(edge);};
 for(const edge of graph.edges){
  const rule=RELATION[edge.type],from=refs.get(edge.source),to=refs.get(edge.target);
  if(!rule||!from||!to)continue;
  const approved=status.get(edge.source)==='approved'&&status.get(edge.target)==='approved';
  const rationale=edge.type==='delivered_as'?strategy.formats.find(f=>f.id===edge.target)?.rationale:undefined;
  add({from:rule.reverse?to:from,to:rule.reverse?from:to,relation:rule.relation,properties:{...(edge.type==='delivered_as'?{strategy_relation:'delivered_as',...(rationale?{rationale:rationale.slice(0,400)}:{})}:{})},status:approved?'approved':'suggested',origin:approved?'extracted':'inferred',confidence:approved?1:0.7,evidence:[]});
 }
 for(const [id,citation] of cites){
  const to=refs.get(id);if(!to)continue;
  for(const fact of citation.fact_ids.slice(0,MAX_PROOFS_PER_ITEM)){
   const from=targets.facts.get(fact);if(!from)continue;
   const approved=status.get(id)==='approved';
   add({from,to,relation:'proves',properties:{},status:approved?'approved':'suggested',origin:'extracted',confidence:approved?1:0.7,evidence:[]});
  }
 }
 return {nodes,edges};
}
