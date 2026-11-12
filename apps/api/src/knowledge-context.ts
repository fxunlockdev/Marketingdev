/** Context packs: the slice of a business's knowledge graph that one planner or generator needs.
 *
 * A pack replaces the flat fact list. It holds approved knowledge first, then confident
 * suggestions clearly marked "unproven", ranked for the task and cut to a byte budget, plus a
 * ledger of what recent posts already used so the next ones do not repeat it.
 *
 * Ranking is plain word overlap with fixed weights per task. It needs no embeddings, and the
 * same graph and task always give the same pack.
 */
import type {PoolClient} from 'pg';
import {KnowledgeError,type KnowledgeScope,type NodeType,type Relation,type Status} from './knowledge-graph.js';

export const CONTEXT_TASKS=['plan','creative','carousel','video','insights'] as const;
export type ContextTaskKind=typeof CONTEXT_TASKS[number];
export type ContextTask={readonly kind:ContextTaskKind;
 /** What is being planned or made: the brief, topic or question. Drives relevance. */
 readonly input:string;
 readonly budgetBytes?:number;
 /** Injected in tests; defaults to the current time. Only the ledger window depends on it. */
 readonly now?:Date;readonly ledgerDays?:number};
export type Standing='approved'|'unproven';
export type PackRelation={relation:Relation;to:string;to_type:NodeType;standing:Standing};
export type PackItem={id:string;type:NodeType;label:string;summary:string;standing:Standing;confidence:number;relations:PackRelation[]};
export type LedgerEntry={node_id:string;type:NodeType;label:string;uses:number;last_used:string};
export type ContextPack={task:ContextTaskKind;budget_bytes:number;
 /** Size of the prompt-facing part: notice, items and ledger. Never above budget_bytes. */
 bytes:number;
 /** True when eligible knowledge was left out to stay within the budget. */
 truncated:boolean;notice:string;items:PackItem[];ledger:LedgerEntry[];
 /** Provenance: every node and edge that reached the pack, for the run record. Not part of the prompt. */
 used_node_ids:string[];used_edge_ids:string[]};

export const CONTEXT_LIMITS={defaultBudgetBytes:6000,minBudgetBytes:600,maxBudgetBytes:32000,inputChars:4000,summaryChars:400,
 /** Suggestions below this confidence never reach a prompt. */
 suggestedConfidence:0.6,candidates:600,edges:3000,ledgerEntries:12,ledgerDays:45,ledgerShare:0.2,itemShare:0.85} as const;
export const PACK_NOTICE='Items marked "unproven" are unreviewed suggestions: treat them as hypotheses to test, never as facts about the business. The ledger lists what recent posts already used; vary from it.';

type Weights=Partial<Record<NodeType,number>>;
const CREATIVE:Weights={business:3,offer:4,angle:4,proof_point:4,visual_direction:4,brand_element:4,voice:3,persona:3,pain:3,asset:3,audience:2,positioning:2,pillar:2,lesson:2,competitor:1,format:1};
/** How much each kind of knowledge matters to each task. A type that is absent is left out of that task's pack. */
export const TASK_WEIGHTS:Readonly<Record<ContextTaskKind,Weights>>={
 plan:{business:3,offer:4,audience:4,persona:4,pain:4,angle:4,pillar:4,lesson:4,proof_point:3,competitor:3,positioning:3,format:2,voice:2,visual_direction:1},
 creative:CREATIVE,
 carousel:{...CREATIVE,pillar:3,pain:4,format:2},
 video:{business:3,visual_direction:4,angle:4,offer:4,persona:3,pain:3,voice:3,asset:3,brand_element:2,proof_point:2,lesson:2},
 insights:{result:4,lesson:4,angle:4,format:4,pillar:4,post:3,offer:2,persona:2,audience:2,business:2},
};
/** Approved rules are constraints, so they lead every pack whatever the task. */
const RULE_WEIGHT=6;

const STOP=new Set('the and for with that this from are was were has have had not but you your our their its can will into about over than then them they what when where which who how why all any each more most some such only own same too very one two out off per via'.split(' '));
const singular=(word:string):string=>word.length>4&&word.endsWith('ies')?`${word.slice(0,-3)}y`:word.length>3&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
/** Lower-cased words of three letters or more, without filler words and plural endings. */
export function tokens(text:string):string[]{
 const words=text.toLowerCase().normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').split(/[^\p{L}\p{N}]+/u);
 return [...new Set(words.filter(word=>word.length>=3&&!STOP.has(word)).map(singular))];
}

export type Candidate={readonly id:string;readonly type:NodeType;readonly key:string;readonly label:string;readonly summary:string;readonly status:Status;readonly confidence:number};
export type CandidateEdge={readonly id:string;readonly from_node:string;readonly to_node:string;readonly relation:Relation;readonly status:Status};

/** Matches in the label count double: a node named after the topic beats one that merely mentions it. */
export function relevance(taskTokens:ReadonlySet<string>,node:Pick<Candidate,'label'|'summary'>):number{
 const label=new Set(tokens(node.label)),summary=tokens(node.summary);
 return [...label].filter(word=>taskTokens.has(word)).length*2+summary.filter(word=>!label.has(word)&&taskTokens.has(word)).length;
}

type Ranked={node:Candidate;tier:number;score:number};
function weight(kind:ContextTaskKind,node:Candidate):number{
 return node.type==='rule'?(node.status==='approved'?RULE_WEIGHT:1):TASK_WEIGHTS[kind][node.type]??0;
}
/** Orders candidates for a task: approved rules, then approved knowledge, then suggestions; best match first within each. */
export function rankNodes(nodes:readonly Candidate[],task:Pick<ContextTask,'kind'|'input'>):Candidate[]{
 const wanted=new Set(tokens(task.input.slice(0,CONTEXT_LIMITS.inputChars)));
 const ranked:Ranked[]=nodes.filter(node=>node.status!=='rejected'&&weight(task.kind,node)>0&&(node.status==='approved'||node.confidence>=CONTEXT_LIMITS.suggestedConfidence)).map(node=>({node,
  tier:node.status!=='approved'?2:node.type==='rule'?0:1,score:weight(task.kind,node)*10+relevance(wanted,node)*5+node.confidence}));
 const order=(a:Ranked,b:Ranked):number=>a.tier-b.tier||b.score-a.score||a.node.type.localeCompare(b.node.type)||a.node.key.localeCompare(b.node.key)||a.node.id.localeCompare(b.node.id);
 return [...ranked].sort(order).map(entry=>entry.node);
}

const size=(value:unknown):number=>Buffer.byteLength(JSON.stringify(value));
const standingOf=(status:Status):Standing=>status==='approved'?'approved':'unproven';
const clip=(text:string,max:number):string=>text.length<=max?text:`${text.slice(0,max-1)}…`;

function budgetOf(task:ContextTask):number{
 const budget=task.budgetBytes??CONTEXT_LIMITS.defaultBudgetBytes;
 if(!CONTEXT_TASKS.includes(task.kind)||typeof task.input!=='string'||!Number.isInteger(budget)||budget<CONTEXT_LIMITS.minBudgetBytes||budget>CONTEXT_LIMITS.maxBudgetBytes)throw new KnowledgeError('KNOWLEDGE_CONTEXT_INVALID');
 return budget;
}
/** Takes entries in order while they fit. An entry that does not fit is skipped, so a long one cannot starve the rest. */
function fill<T>(entries:readonly T[],room:number,cost:(entry:T)=>number):{taken:T[];used:number;dropped:boolean}{
 return entries.reduce<{taken:T[];used:number;dropped:boolean}>((state,entry)=>{
  const bytes=cost(entry)+1; // one byte for the separating comma
  return state.used+bytes<=room?{taken:[...state.taken,entry],used:state.used+bytes,dropped:state.dropped}:{...state,dropped:true};
 },{taken:[],used:0,dropped:false});
}

/** Builds the pack from already-loaded graph rows. Pure, so ranking and budgeting are tested without a database. */
export function assemblePack(task:ContextTask,nodes:readonly Candidate[],edges:readonly CandidateEdge[],ledger:readonly LedgerEntry[]):ContextPack{
 const budget=budgetOf(task),overhead=size({notice:PACK_NOTICE,items:[],ledger:[]});
 const recent=fill(ledger.slice(0,CONTEXT_LIMITS.ledgerEntries),Math.floor(budget*CONTEXT_LIMITS.ledgerShare),size);
 const bare=(node:Candidate):PackItem=>({id:node.id,type:node.type,label:node.label,summary:clip(node.summary,CONTEXT_LIMITS.summaryChars),standing:standingOf(node.status),confidence:node.confidence,relations:[]});
 const chosen=fill(rankNodes(nodes,task).map(bare),Math.floor(budget*CONTEXT_LIMITS.itemShare)-overhead-recent.used,size);
 const position=new Map(chosen.taken.map((item,index)=>[item.id,index])),byId=new Map(chosen.taken.map(item=>[item.id,item]));
 const linked=edges.filter(edge=>edge.status!=='rejected'&&position.has(edge.from_node)&&position.has(edge.to_node))
  .map(edge=>{const to=byId.get(edge.to_node) as PackItem,from=byId.get(edge.from_node) as PackItem;
   // A link is only as proven as its weakest part.
   const proven=edge.status==='approved'&&from.standing==='approved'&&to.standing==='approved';
   return {edge,relation:{relation:edge.relation,to:to.label,to_type:to.type,standing:proven?'approved' as const:'unproven' as const}};})
  .sort((a,b)=>(position.get(a.edge.from_node) as number)-(position.get(b.edge.from_node) as number)||a.edge.relation.localeCompare(b.edge.relation)||(position.get(a.edge.to_node) as number)-(position.get(b.edge.to_node) as number)||a.edge.id.localeCompare(b.edge.id));
 const kept=fill(linked,budget-overhead-recent.used-chosen.used,entry=>size(entry.relation));
 const items=chosen.taken.map(item=>({...item,relations:kept.taken.filter(entry=>entry.edge.from_node===item.id).map(entry=>entry.relation)}));
 const body={notice:PACK_NOTICE,items,ledger:recent.taken};
 return {task:task.kind,budget_bytes:budget,bytes:size(body),truncated:chosen.dropped||kept.dropped||recent.dropped||ledger.length>CONTEXT_LIMITS.ledgerEntries,...body,
  used_node_ids:items.map(item=>item.id),used_edge_ids:kept.taken.map(entry=>entry.edge.id)};
}

type NodeRow={id:string;type:NodeType;key:string;label:string;properties:Record<string,unknown>;status:Status;confidence:string};
type LedgerRow={node_id:string;type:NodeType;label:string;uses:number;last_used:Date};
function summaryOf(properties:Record<string,unknown>):string{
 const text=properties.summary??properties.text;
 return typeof text==='string'?text.replace(/\s+/g,' ').trim():'';
}

async function loadCandidates(db:PoolClient,scope:KnowledgeScope,kind:ContextTaskKind):Promise<Candidate[]>{
 const types=[...Object.keys(TASK_WEIGHTS[kind]),'rule'];
 const {rows}=await db.query<NodeRow>(`SELECT id,type,key,label,properties,status,confidence FROM app.knowledge_nodes
  WHERE organization_id=$1 AND brand_id=$2 AND superseded_by IS NULL AND type=ANY($3::text[]) AND (status='approved' OR (status='suggested' AND confidence>=$4))
  ORDER BY (status='approved') DESC,confidence DESC,last_seen DESC,id LIMIT $5`,[scope.organizationId,scope.brandId,types,CONTEXT_LIMITS.suggestedConfidence,CONTEXT_LIMITS.candidates]);
 return rows.map(row=>({id:row.id,type:row.type,key:row.key,label:row.label,summary:summaryOf(row.properties),status:row.status,confidence:Number(row.confidence)}));
}
async function loadEdges(db:PoolClient,scope:KnowledgeScope,ids:readonly string[]):Promise<CandidateEdge[]>{
 if(!ids.length)return [];
 const {rows}=await db.query<CandidateEdge>(`SELECT id,from_node,to_node,relation,status FROM app.knowledge_edges
  WHERE organization_id=$1 AND brand_id=$2 AND from_node=ANY($3::uuid[]) AND to_node=ANY($3::uuid[]) AND (status='approved' OR (status='suggested' AND confidence>=$4))
  ORDER BY relation,from_node,to_node LIMIT $5`,[scope.organizationId,scope.brandId,ids,CONTEXT_LIMITS.suggestedConfidence,CONTEXT_LIMITS.edges]);
 return rows;
}
/** What recent posts were built from: every node with a 'used_in' edge to a post inside the window, most recent first. */
async function loadLedger(db:PoolClient,scope:KnowledgeScope,since:Date):Promise<LedgerEntry[]>{
 const {rows}=await db.query<LedgerRow>(`SELECT n.id AS node_id,n.type,n.label,count(*)::int AS uses,max(e.first_seen) AS last_used
  FROM app.knowledge_edges e
  JOIN app.knowledge_nodes n ON n.organization_id=e.organization_id AND n.brand_id=e.brand_id AND n.id=e.from_node AND n.status<>'rejected'
  JOIN app.knowledge_nodes p ON p.organization_id=e.organization_id AND p.brand_id=e.brand_id AND p.id=e.to_node AND p.type='post' AND p.status<>'rejected'
  WHERE e.organization_id=$1 AND e.brand_id=$2 AND e.relation='used_in' AND e.status<>'rejected' AND e.first_seen>=$3
  GROUP BY n.id,n.type,n.label ORDER BY max(e.first_seen) DESC,count(*) DESC,n.id LIMIT $4`,[scope.organizationId,scope.brandId,since,CONTEXT_LIMITS.ledgerEntries+1]);
 return rows.map(row=>({...row,last_used:row.last_used.toISOString()}));
}

/** Loads the business's graph inside the caller's tenant or job transaction and returns the pack for one task. */
export async function buildContextPack(db:PoolClient,scope:KnowledgeScope,task:ContextTask):Promise<ContextPack>{
 budgetOf(task);
 const days=task.ledgerDays??CONTEXT_LIMITS.ledgerDays;
 if(!Number.isInteger(days)||days<1||days>365)throw new KnowledgeError('KNOWLEDGE_CONTEXT_INVALID');
 const since=new Date((task.now??new Date()).getTime()-days*86400000);
 const nodes=await loadCandidates(db,scope,task.kind);
 const [edges,ledger]=[await loadEdges(db,scope,nodes.map(node=>node.id)),await loadLedger(db,scope,since)];
 return assemblePack(task,nodes,edges,ledger);
}
