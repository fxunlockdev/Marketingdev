/** Glue between the knowledge graph and the production jobs (creative, carousel slide, insights).
 *
 * - A job builds one context pack, stores it with its request, and replays the stored pack on every attempt,
 *   so the planner input (and therefore every recorded call hash) never changes under a retry.
 * - After a version is saved, the job records a `post` node and `used_in` edges from the production
 *   knowledge it was given. After insights are saved, `result` and `lesson` nodes.
 * Everything a job writes is a suggestion; only a reviewer of the business can approve it.
 */
import type {PoolClient} from 'pg';
import {buildContextPack,type ContextPack,type ContextTaskKind} from './knowledge-context.js';
import {applyMutations,normalizeKey,KNOWLEDGE_LIMITS,type AppliedMutations,type EdgeMutation,type GraphMutations,type KnowledgeScope,type NodeMutation,type NodeRef,type NodeType} from './knowledge-graph.js';

/** The part of a pack a model reads. Ids are kept so a planner can cite them; provenance stays outside. */
export type PromptKnowledge=Pick<ContextPack,'task'|'notice'|'items'|'ledger'|'truncated'>;
export type StoredKnowledge=
 |{status:'ready';prompt:PromptKnowledge;used_node_ids:string[];used_edge_ids:string[];bytes:number}
 |{status:'skipped'|'unavailable';reason:string};

/** Node types a post is built from. Constant constraints (rules, voice, business, brand elements) are not
 * "used" by one post and would only crowd the ledger. */
export const PRODUCTION_TYPES:readonly NodeType[]=['angle','format','pillar','asset','visual_direction','offer','persona','pain','proof_point','audience'];
const MAX_LABEL=KNOWLEDGE_LIMITS.label;
const clip=(text:string,max:number):string=>{const flat=text.replace(/\s+/g,' ').trim();return flat.length>max?flat.slice(0,max-1)+'…':flat;};

/** The prompt part of a stored pack, or undefined when there is nothing to say: an empty graph adds nothing to a prompt. */
export function promptKnowledge(stored:StoredKnowledge):PromptKnowledge|undefined{
 return stored.status==='ready'&&(stored.prompt.items.length||stored.prompt.ledger.length)?stored.prompt:undefined;
}

export function storedFromPack(pack:ContextPack):StoredKnowledge{
 return {status:'ready',prompt:{task:pack.task,notice:pack.notice,items:pack.items,ledger:pack.ledger,truncated:pack.truncated},used_node_ids:[...pack.used_node_ids],used_edge_ids:[...pack.used_edge_ids],bytes:pack.bytes};
}

/** Builds the pack inside a savepoint: a knowledge fault is recorded as 'unavailable' and the job goes on without it. */
export async function packForJob(db:PoolClient,scope:KnowledgeScope,kind:ContextTaskKind,input:string):Promise<StoredKnowledge>{
 await db.query('SAVEPOINT knowledge_pack');
 try{
  const pack=await buildContextPack(db,scope,{kind,input:input.slice(0,4000)});
  await db.query('RELEASE SAVEPOINT knowledge_pack');
  return storedFromPack(pack);
 }catch(error){
  await db.query('ROLLBACK TO SAVEPOINT knowledge_pack');
  const code=(error as {code?:unknown}).code;
  return {status:'unavailable',reason:typeof code==='string'&&/^[A-Z0-9_]{2,64}$/.test(code)?code:'KNOWLEDGE_UNAVAILABLE'};
 }
}

/** A post node and `used_in` edges from the production knowledge in its pack. Pure: refs are looked up by the caller. */
export function productionMutations(post:{key:string;label:string;jobId:string;properties?:Record<string,unknown>},used:readonly NodeRef[]):GraphMutations{
 const ref:NodeRef={type:'post',key:normalizeKey(post.key)};
 const node:NodeMutation={...ref,label:clip(post.label||'Post',MAX_LABEL),properties:post.properties??{},status:'suggested',origin:'extracted',confidence:1,evidence:[{jobId:post.jobId,excerpt:''}]};
 const seen=new Set<string>();
 const edges:EdgeMutation[]=used.filter(r=>PRODUCTION_TYPES.includes(r.type)).filter(r=>{const id=`${r.type}:${r.key}`;if(seen.has(id))return false;seen.add(id);return true;})
  .map(from=>({from,to:ref,relation:'used_in',properties:{},status:'suggested',origin:'extracted',confidence:1,evidence:[]}));
 return {nodes:[node],edges};
}

export type InsightFinding={readonly title:string;readonly detail?:string};
/** One result node per analysis run and one lesson node per finding, linked `learned_from` the result. */
export function insightMutations(run:{jobId:string;label:string},findings:readonly InsightFinding[]):GraphMutations{
 const result:NodeRef={type:'result',key:normalizeKey(`insights ${run.jobId}`)};
 const evidence=[{jobId:run.jobId,excerpt:''}];
 const lessons=findings.slice(0,20).filter(f=>f.title.trim()).map(f=>({type:'lesson' as const,key:normalizeKey(clip(f.title,100)),label:clip(f.title,MAX_LABEL),
  properties:f.detail?{summary:clip(f.detail,400)}:{},status:'suggested' as const,origin:'inferred' as const,confidence:0.6,evidence}));
 return {nodes:[{...result,label:clip(run.label,MAX_LABEL),properties:{},status:'suggested',origin:'extracted',confidence:1,evidence},...lessons],
  edges:lessons.map(l=>({from:{type:l.type,key:l.key},to:result,relation:'learned_from' as const,properties:{},status:'suggested' as const,origin:'inferred' as const,confidence:0.6,evidence:[]}))};
}

/** Looks up the (type, key) of pack nodes so edges can be written by reference. Rejected or superseded nodes drop out. */
export async function nodeRefs(db:PoolClient,scope:KnowledgeScope,ids:readonly string[]):Promise<NodeRef[]>{
 if(!ids.length)return [];
 const {rows}=await db.query<{type:NodeType;key:string}>(`SELECT type,key FROM app.knowledge_nodes WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[]) AND status<>'rejected' AND superseded_by IS NULL ORDER BY type,key`,
  [scope.organizationId,scope.brandId,ids.slice(0,KNOWLEDGE_LIMITS.batch)]);
 return rows.map(row=>({type:row.type,key:row.key}));
}

export async function recordPost(db:PoolClient,scope:KnowledgeScope,post:{key:string;label:string;jobId:string;properties?:Record<string,unknown>},usedNodeIds:readonly string[]):Promise<AppliedMutations>{
 return applyMutations(db,scope,productionMutations(post,await nodeRefs(db,scope,usedNodeIds)));
}
