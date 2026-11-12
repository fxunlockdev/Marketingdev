/** Graphify graph.json -> knowledge graph mutations. Pure: no file, network or database access.
 *
 * Graphify (PyPI `graphifyy`) describes documents, not marketing concepts: its nodes are pages,
 * headings and, after its model pass, loosely typed concepts. It has no notion of an offer or a
 * pain. So this importer relies on a convention in the corpus we write for it: a heading named
 * "Type: Label" (for example "Persona: Anxious first-time owner") is an entity, and nesting one
 * such heading under another implies the relation between them. Everything else is structure
 * and is not imported.
 *
 * Whatever Graphify reports, the result is 'suggested'. See docs/KNOWLEDGE_GRAPH.md.
 */
import {KnowledgeError,KNOWLEDGE_LIMITS,normalizeKey,refId,stableJSON,
 type EdgeMutation,type EvidenceRef,type GraphMutations,type NodeMutation,type NodeRef,type NodeType,type Origin,type Relation} from './knowledge-graph.js';

export const GRAPHIFY_LIMITS={nodes:5000,links:20000,ancestors:50,
 /** Nesting implies a relation by convention only, so it is recorded as a modest inference. */
 structureConfidence:0.6,inferredConfidence:0.7,ambiguousConfidence:0.3} as const;

const HEADING_TYPES:Readonly<Record<string,NodeType>>={business:'business',offer:'offer',audience:'audience',persona:'persona',pain:'pain',angle:'angle',
 proof:'proof_point','proof point':'proof_point',competitor:'competitor',pillar:'pillar',format:'format','visual direction':'visual_direction',voice:'voice',positioning:'positioning',rule:'rule'};

type Link={readonly relation:Relation;
 /** True when the edge runs from the nested entity up to the one it sits under. */
 readonly upward?:boolean};
const up=(relation:Relation):Link=>({relation,upward:true}),down=(relation:Relation):Link=>({relation});
/** What nesting `child` under `parent` means. Keys are "parent>child". Unlisted pairs become 'related_to'. */
const NESTING:Readonly<Record<string,Link>>={
 'business>offer':down('offers'),'business>audience':down('targets'),'business>persona':down('targets'),'business>competitor':down('differentiates_from'),
 'business>pillar':down('expresses'),'business>voice':down('expresses'),'business>positioning':down('expresses'),'business>visual_direction':down('expresses'),
 'business>proof_point':up('proves'),'business>rule':up('constrains'),
 'offer>audience':down('targets'),'offer>persona':down('targets'),'offer>pain':down('solves'),'offer>competitor':down('differentiates_from'),'offer>proof_point':up('proves'),'offer>rule':up('constrains'),
 'audience>persona':up('belongs_to'),'audience>pain':down('has_pain'),'audience>angle':up('targets'),'persona>pain':down('has_pain'),'persona>angle':up('targets'),
 'pain>angle':up('solves'),'pain>offer':up('solves'),'pillar>angle':up('expresses'),'angle>proof_point':up('proves'),
};

export type GraphifyImportOptions={
 /** The sandbox job that ran Graphify. Recorded as evidence on every imported item. */
 readonly jobId?:string;
 /** Where each corpus file came from, keyed by Graphify's source_file. */
 readonly sources?:Readonly<Record<string,{readonly sourceId?:string;readonly sourceUrl?:string}>>};
export type GraphifyCommunity={id:number;name:string;members:string[]};
export type GraphifyImport={mutations:GraphMutations;
 report:{nodes:{imported:number;merged:number;structural:number};edges:{imported:number;skipped:number};
  /** Graphify's clusters over the imported nodes. Informational: communities are not stored. */
  communities:GraphifyCommunity[]}};

type Raw=Record<string,unknown>;
type GNode={id:string;label:string;file:string;location:string;community:number|null;communityName:string};
type GLink={source:string;target:string;relation:string;confidence:string;score:number;file:string;location:string};
const invalid=(detail:string):never=>{throw new KnowledgeError('KNOWLEDGE_GRAPHIFY_INVALID',detail);};
const isRecord=(value:unknown):value is Raw=>!!value&&typeof value==='object'&&!Array.isArray(value);
const str=(value:unknown):string=>typeof value==='string'?value:'';

function readNodes(graph:Raw):GNode[]{
 const nodes=graph.nodes;
 if(!Array.isArray(nodes)||nodes.length>GRAPHIFY_LIMITS.nodes)return invalid('nodes missing or too many');
 return nodes.map((node,index)=>{
  if(!isRecord(node)||typeof node.id!=='string'||!node.id||typeof node.label!=='string')return invalid(`nodes[${index}] has no id or label`);
  return {id:node.id,label:node.label,file:str(node.source_file),location:str(node.source_location),community:Number.isInteger(node.community)?node.community as number:null,communityName:str(node.community_name)};
 });
}
function readLinks(graph:Raw):GLink[]{
 // NetworkX writes "links"; Graphify's raw extraction calls the same list "edges".
 const links=graph.links??graph.edges;
 if(!Array.isArray(links)||links.length>GRAPHIFY_LIMITS.links)return invalid('links missing or too many');
 return links.map((link,index)=>{
  if(!isRecord(link)||typeof link.source!=='string'||typeof link.target!=='string'||typeof link.relation!=='string')return invalid(`links[${index}] has no source, target or relation`);
  const score=typeof link.confidence_score==='number'&&link.confidence_score>=0&&link.confidence_score<=1?link.confidence_score:0;
  return {source:link.source,target:link.target,relation:link.relation,confidence:str(link.confidence),score,file:str(link.source_file),location:str(link.source_location)};
 });
}

type Entity={type:NodeType;key:string;label:string};
/** "Persona: Anxious owner" -> {type:'persona', label:'Anxious owner'}; anything else is document structure. */
export function entityFromHeading(heading:string):Entity|null{
 const match=/^\s*([A-Za-z][A-Za-z ]{2,24}?)\s*:\s*(\S.*)$/.exec(heading);
 if(!match)return null;
 const prefix=match[1].toLowerCase().replace(/\s+/g,' '),label=match[2].replace(/\s+/g,' ').trim();
 if(!Object.hasOwn(HEADING_TYPES,prefix)||label.length>KNOWLEDGE_LIMITS.label)return null;
 const type=HEADING_TYPES[prefix];
 try{return {type,key:type==='business'?'self':normalizeKey(label),label};}catch{return null;}
}

const lineOf=(location:string):number|null=>{const match=/^L(\d+)$/.exec(location);return match?Number(match[1]):null;};
/** child id -> parent id from 'contains' links. The graph is undirected, so line numbers settle any doubt. */
function parents(nodes:ReadonlyMap<string,GNode>,links:readonly GLink[]):Map<string,string>{
 const result=new Map<string,string>();
 for(const link of links.filter(candidate=>candidate.relation==='contains')){
  const a=nodes.get(link.source),b=nodes.get(link.target);
  if(!a||!b)continue;
  const lineA=lineOf(a.location),lineB=lineOf(b.location),flipped=a.file===b.file&&lineA!==null&&lineB!==null&&lineB<lineA;
  const [parent,child]=flipped?[b,a]:[a,b];
  if(!result.has(child.id))result.set(child.id,parent.id);
 }
 return result;
}
function typedAncestor(id:string,parentOf:ReadonlyMap<string,string>,entities:ReadonlyMap<string,Entity>):string|null{
 let current=parentOf.get(id);
 for(let step=0;current!==undefined&&step<GRAPHIFY_LIMITS.ancestors;step++){
  if(entities.has(current))return current;
  current=parentOf.get(current);
 }
 return null;
}

function evidenceFor(file:string,location:string,options:GraphifyImportOptions):EvidenceRef[]{
 const source=options.sources&&Object.hasOwn(options.sources,file)?options.sources[file]:undefined;
 if(!options.jobId&&!source?.sourceId&&!source?.sourceUrl)return [];
 return [{excerpt:`${file}${location?` ${location}`:''}`.slice(0,KNOWLEDGE_LIMITS.excerpt),...(source?.sourceId?{sourceId:source.sourceId}:{}),...(source?.sourceUrl?{sourceUrl:source.sourceUrl}:{}),...(options.jobId?{jobId:options.jobId}:{})}];
}
function unionEvidence(a:readonly EvidenceRef[],b:readonly EvidenceRef[]):EvidenceRef[]{
 return [...new Map([...a,...b].map(ref=>[stableJSON(ref),ref])).values()];
}
/** Graphify's own confidence label decides how far its score is trusted. */
function standing(link:GLink):{origin:Origin;confidence:number}{
 if(link.confidence==='EXTRACTED')return {origin:'extracted',confidence:link.score};
 return {origin:'inferred',confidence:Math.min(link.score,link.confidence==='INFERRED'?GRAPHIFY_LIMITS.inferredConfidence:GRAPHIFY_LIMITS.ambiguousConfidence)};
}
const toRef=(entity:Entity):NodeRef=>({type:entity.type,key:entity.key});
const edgeKey=(edge:EdgeMutation):string=>`${refId(edge.from)}>${edge.relation}>${refId(edge.to)}`;

function nestingEdge(child:GNode,parent:Entity,entity:Entity,options:GraphifyImportOptions):EdgeMutation|null{
 if(refId(parent)===refId(entity))return null;
 const link=NESTING[`${parent.type}>${entity.type}`]??down('related_to');
 const [from,to]=link.upward?[entity,parent]:[parent,entity];
 return {from:toRef(from),to:toRef(to),relation:link.relation,properties:{},status:'suggested',origin:'inferred',confidence:GRAPHIFY_LIMITS.structureConfidence,evidence:evidenceFor(child.file,child.location,options)};
}
function semanticEdge(link:GLink,from:Entity,to:Entity,options:GraphifyImportOptions):EdgeMutation|null{
 if(refId(from)===refId(to))return null;
 // Graphify's relation names ("references", "conceptually_related_to", ...) say nothing a marketer can act on.
 return {from:toRef(from),to:toRef(to),relation:'related_to',properties:{graphify_relation:link.relation.slice(0,60)},status:'suggested',...standing(link),evidence:evidenceFor(link.file,link.location,options)};
}

/** Converts a Graphify graph.json (parsed) into validated, suggestion-only graph mutations. */
export function fromGraphify(graph:unknown,options:GraphifyImportOptions={}):GraphifyImport{
 if(!isRecord(graph))return invalid('graph is not an object');
 const nodes=readNodes(graph),links=readLinks(graph),byId=new Map(nodes.map(node=>[node.id,node]));
 const entities=new Map<string,Entity>(nodes.flatMap(node=>{const entity=entityFromHeading(node.label);return entity?[[node.id,entity] as const]:[];}));
 const merged=new Map<string,NodeMutation>();
 for(const node of nodes){
  const entity=entities.get(node.id);
  if(!entity)continue;
  const earlier=merged.get(refId(entity)),evidence=evidenceFor(node.file,node.location,options);
  // The same entity named in two documents is one node, citing both.
  merged.set(refId(entity),earlier?{...earlier,evidence:unionEvidence(earlier.evidence,evidence)}
   :{...toRef(entity),label:entity.label,properties:{},status:'suggested',origin:'extracted',confidence:GRAPHIFY_LIMITS.structureConfidence,evidence});
 }
 const parentOf=parents(byId,links);
 const nested=[...entities].flatMap(([id,entity])=>{
  const ancestor=typedAncestor(id,parentOf,entities),edge=ancestor?nestingEdge(byId.get(id) as GNode,entities.get(ancestor) as Entity,entity,options):null;
  return edge?[edge]:[];
 });
 const others=links.filter(link=>link.relation!=='contains');
 const semantic=others.flatMap(link=>{
  const from=entities.get(link.source),to=entities.get(link.target),edge=from&&to?semanticEdge(link,from,to,options):null;
  return edge?[edge]:[];
 });
 const edges=new Map<string,EdgeMutation>();
 for(const edge of [...nested,...semantic]){
  const earlier=edges.get(edgeKey(edge));
  edges.set(edgeKey(edge),earlier?{...earlier,evidence:unionEvidence(earlier.evidence,edge.evidence)}:edge);
 }
 return {mutations:{nodes:[...merged.values()],edges:[...edges.values()]},
  report:{nodes:{imported:merged.size,merged:entities.size-merged.size,structural:nodes.length-entities.size},edges:{imported:edges.size,skipped:others.length-semantic.length},communities:communities(nodes,entities)}};
}

function communities(nodes:readonly GNode[],entities:ReadonlyMap<string,Entity>):GraphifyCommunity[]{
 const groups=new Map<number,GraphifyCommunity>();
 for(const node of nodes){
  const entity=entities.get(node.id);
  if(!entity||node.community===null)continue;
  const group=groups.get(node.community)??{id:node.community,name:node.communityName,members:[]};
  groups.set(node.community,{...group,members:[...new Set([...group.members,refId(entity)])]});
 }
 return [...groups.values()].sort((a,b)=>a.id-b.id);
}
