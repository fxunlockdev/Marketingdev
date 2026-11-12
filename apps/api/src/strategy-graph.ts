import type {BrandStrategy,Citation} from './strategy-contracts.js';

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
