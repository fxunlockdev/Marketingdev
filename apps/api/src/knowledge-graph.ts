/** Per-business knowledge graph: typed repository over app.knowledge_* (migrations 111, 112).
 *
 * Every function runs inside a transaction the caller opened with tenant or job context set
 * (TenantDatabase.transaction or AssetJobs.transaction). Row-level security decides who may
 * read or write; the explicit organisation and business filters here are a second guard.
 *
 * Rules that hold whatever the caller does:
 *  - knowledge found on the web or inferred by a model is stored as 'suggested';
 *  - reviewed knowledge (approved or rejected) is never overwritten by a suggestion;
 *  - a node is unique per (type, key), so repeated findings merge instead of piling up.
 */
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

export const NODE_TYPES=['business','offer','audience','persona','pain','angle','proof_point','competitor','pillar','format','visual_direction','voice','positioning','rule','brand_element','asset','post','result','lesson'] as const;
export const RELATIONS=['offers','targets','belongs_to','has_pain','solves','differentiates_from','proves','expresses','constrains','used_in','performed','learned_from','contradicts','supersedes','related_to'] as const;
export type NodeType=typeof NODE_TYPES[number];
export type Relation=typeof RELATIONS[number];
export type Status='suggested'|'approved'|'rejected';
export type Origin='extracted'|'inferred'|'owner';
export type Properties=Readonly<Record<string,unknown>>;
export type KnowledgeScope={readonly organizationId:string;readonly brandId:string};
/** At least one of sourceId (app.brand_sources), sourceUrl or jobId says where the claim came from. */
export type EvidenceRef={readonly sourceId?:string;readonly sourceUrl?:string;readonly jobId?:string;readonly excerpt:string};
export type NodeRef={readonly type:NodeType;readonly key:string};
type Claim={readonly properties:Properties;readonly status:'suggested'|'approved';readonly origin:Origin;readonly confidence:number;readonly evidence:readonly EvidenceRef[]};
export type NodeMutation=NodeRef&Claim&{readonly label:string};
export type EdgeMutation=Claim&{readonly from:NodeRef;readonly to:NodeRef;readonly relation:Relation};
export type GraphMutations={readonly nodes:readonly NodeMutation[];readonly edges:readonly EdgeMutation[]};
export type KnowledgeNode={id:string;type:NodeType;key:string;label:string;properties:Properties;status:Status;origin:Origin;confidence:number;version:number;first_seen:string;last_seen:string;superseded_by:string|null};
export type KnowledgeEdge={id:string;from_node:string;to_node:string;relation:Relation;properties:Properties;status:Status;origin:Origin;confidence:number;first_seen:string;last_seen:string};
export type WriteOutcome='inserted'|'updated'|'touched'|'kept'|'skipped';
export type NodeWrite={ref:NodeRef;id:string;outcome:WriteOutcome;version:number;conflict:boolean};
export type EdgeWrite={from:NodeRef;to:NodeRef;relation:Relation;id:string|null;outcome:WriteOutcome};
/** `actor` is the signed-in reviewer; it is required to write anything other than a suggestion. */
export type WriteContext={readonly actor?:string};

export class KnowledgeError extends Error{
 constructor(readonly code:string,readonly detail=''){super(detail?`${code}: ${detail}`:code);}
}

export const KNOWLEDGE_LIMITS={label:300,key:120,nodePropertiesBytes:8192,edgePropertiesBytes:4096,excerpt:1000,url:2048,batch:500,depth:3,neighbours:500} as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN_RANK:Readonly<Record<Origin,number>>={inferred:1,extracted:2,owner:3};
const sha256=(text:string):string=>createHash('sha256').update(text).digest('hex');

/** Key-sorted JSON, so equal values always serialise to equal text. */
export function stableJSON(value:unknown):string{
 const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered((v as Record<string,unknown>)[k])])):v;
 return JSON.stringify(ordered(JSON.parse(JSON.stringify(value))));
}

/** Turns a label into the de-duplication key: case, Latin accents, punctuation and spacing do not matter. */
export function normalizeKey(text:string):string{
 // Accents are dropped from Latin letters only; in other scripts the marks carry meaning.
 const key=text.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
 if(!key)throw new KnowledgeError('KNOWLEDGE_KEY_EMPTY');
 if(key.length<=KNOWLEDGE_LIMITS.key)return key;
 // Long labels keep a readable prefix; the hash keeps two long labels with the same prefix apart.
 return `${key.slice(0,KNOWLEDGE_LIMITS.key-13).replace(/-+$/,'')}-${sha256(key).slice(0,12)}`;
}

export function refId(ref:NodeRef):string{return `${ref.type}:${ref.key}`;}

export function boundedProperties(value:unknown,maxBytes:number):Properties{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new KnowledgeError('KNOWLEDGE_PROPERTIES_INVALID');
 const text=stableJSON(value);
 if(Buffer.byteLength(text)>maxBytes)throw new KnowledgeError('KNOWLEDGE_PROPERTIES_TOO_LARGE');
 return JSON.parse(text) as Properties;
}

function assertClaim(claim:Claim,maxBytes:number,context:WriteContext):void{
 boundedProperties(claim.properties,maxBytes);
 if(claim.status!=='suggested'&&claim.status!=='approved')throw new KnowledgeError('KNOWLEDGE_STATUS_INVALID');
 if(!Object.hasOwn(ORIGIN_RANK,claim.origin))throw new KnowledgeError('KNOWLEDGE_ORIGIN_INVALID');
 if(typeof claim.confidence!=='number'||!(claim.confidence>=0&&claim.confidence<=1))throw new KnowledgeError('KNOWLEDGE_CONFIDENCE_INVALID');
 if(claim.status==='approved'&&!(context.actor&&UUID.test(context.actor)))throw new KnowledgeError('KNOWLEDGE_REVIEWER_REQUIRED');
 claim.evidence.forEach(assertEvidence);
}
function assertRef(ref:NodeRef):void{
 if(!NODE_TYPES.includes(ref.type))throw new KnowledgeError('KNOWLEDGE_TYPE_UNKNOWN',String(ref.type));
 if(typeof ref.key!=='string'||!ref.key||ref.key.length>KNOWLEDGE_LIMITS.key||ref.key!==ref.key.toLowerCase()||/\s/.test(ref.key))throw new KnowledgeError('KNOWLEDGE_KEY_INVALID');
}
export function assertNodeMutation(node:NodeMutation,context:WriteContext={}):void{
 assertRef(node);
 if(typeof node.label!=='string'||!node.label.trim()||node.label.length>KNOWLEDGE_LIMITS.label)throw new KnowledgeError('KNOWLEDGE_LABEL_INVALID');
 assertClaim(node,KNOWLEDGE_LIMITS.nodePropertiesBytes,context);
}
export function assertEdgeMutation(edge:EdgeMutation,context:WriteContext={}):void{
 assertRef(edge.from);assertRef(edge.to);
 if(!RELATIONS.includes(edge.relation))throw new KnowledgeError('KNOWLEDGE_RELATION_UNKNOWN',String(edge.relation));
 if(refId(edge.from)===refId(edge.to))throw new KnowledgeError('KNOWLEDGE_EDGE_SELF');
 assertClaim(edge,KNOWLEDGE_LIMITS.edgePropertiesBytes,context);
}
export function assertEvidence(ref:EvidenceRef):void{
 const ids=[ref.sourceId,ref.jobId].filter((v):v is string=>v!==undefined);
 if(ids.some(id=>!UUID.test(id)))throw new KnowledgeError('KNOWLEDGE_EVIDENCE_INVALID');
 if(ref.sourceUrl!==undefined&&(ref.sourceUrl.length>KNOWLEDGE_LIMITS.url||!/^https?:\/\//.test(ref.sourceUrl)))throw new KnowledgeError('KNOWLEDGE_EVIDENCE_INVALID');
 if(!ids.length&&ref.sourceUrl===undefined)throw new KnowledgeError('KNOWLEDGE_EVIDENCE_UNSOURCED');
 if(typeof ref.excerpt!=='string'||ref.excerpt.length>KNOWLEDGE_LIMITS.excerpt)throw new KnowledgeError('KNOWLEDGE_EVIDENCE_INVALID');
}

export type NodeState={readonly label:string;readonly properties:Properties;readonly status:Status;readonly origin:Origin;readonly confidence:number;readonly version:number};
export type NodeDecision=
 |{action:'insert'}
 |{action:'keep';conflict:boolean}
 |{action:'touch'}
 |{action:'update';label:string;properties:Properties;status:'suggested'|'approved';origin:Origin;confidence:number;version:number};

function mergedProperties(current:Properties,incoming:Properties,maxBytes:number):Properties{
 const merged={...current,...incoming};
 return Buffer.byteLength(stableJSON(merged))<=maxBytes?merged:incoming;
}

/** Decides what a new finding does to the stored node. Pure: the database write follows the decision. */
export function mergeNode(existing:NodeState|null,incoming:NodeMutation):NodeDecision{
 if(!existing)return {action:'insert'};
 const sameContent=(label:string,properties:Properties):boolean=>label===existing.label&&stableJSON(properties)===stableJSON(existing.properties);
 if(incoming.status==='approved'){
  // A reviewer's statement replaces what is stored, including an earlier rejection.
  if(existing.status==='approved'&&existing.origin===incoming.origin&&sameContent(incoming.label,incoming.properties))return {action:'touch'};
  return {action:'update',label:incoming.label,properties:incoming.properties,status:'approved',origin:incoming.origin,confidence:incoming.confidence,version:existing.version+1};
 }
 // Reviewed knowledge stands. A differing suggestion is reported so the caller can raise it with the owner.
 if(existing.status!=='suggested')return {action:'keep',conflict:!sameContent(incoming.label,{...existing.properties,...incoming.properties})};
 // A weaker source (a guess) never rewrites a stronger one (a quote).
 if(ORIGIN_RANK[incoming.origin]<ORIGIN_RANK[existing.origin])return {action:'touch'};
 const properties=mergedProperties(existing.properties,incoming.properties,KNOWLEDGE_LIMITS.nodePropertiesBytes);
 const confidence=incoming.origin===existing.origin?Math.max(existing.confidence,incoming.confidence):incoming.confidence;
 const changed=!sameContent(incoming.label,properties)||incoming.origin!==existing.origin;
 if(!changed&&confidence===existing.confidence)return {action:'touch'};
 // The version counts content changes, so a confidence bump alone does not move it.
 return {action:'update',label:incoming.label,properties,status:'suggested',origin:incoming.origin,confidence,version:existing.version+(changed?1:0)};
}

export type EdgeState={readonly properties:Properties;readonly status:Status;readonly origin:Origin;readonly confidence:number};
export type EdgeDecision=
 |{action:'insert'}
 |{action:'keep'}
 |{action:'touch'}
 |{action:'update';properties:Properties;status:'suggested'|'approved';origin:Origin;confidence:number};

export function mergeEdge(existing:EdgeState|null,incoming:EdgeMutation):EdgeDecision{
 if(!existing)return {action:'insert'};
 const same=(properties:Properties):boolean=>stableJSON(properties)===stableJSON(existing.properties);
 if(incoming.status==='approved'){
  if(existing.status==='approved'&&existing.origin===incoming.origin&&same(incoming.properties))return {action:'touch'};
  return {action:'update',properties:incoming.properties,status:'approved',origin:incoming.origin,confidence:incoming.confidence};
 }
 if(existing.status!=='suggested')return {action:'keep'};
 if(ORIGIN_RANK[incoming.origin]<ORIGIN_RANK[existing.origin])return {action:'touch'};
 const properties=mergedProperties(existing.properties,incoming.properties,KNOWLEDGE_LIMITS.edgePropertiesBytes);
 const confidence=incoming.origin===existing.origin?Math.max(existing.confidence,incoming.confidence):incoming.confidence;
 if(same(properties)&&incoming.origin===existing.origin&&confidence===existing.confidence)return {action:'touch'};
 return {action:'update',properties,status:'suggested',origin:incoming.origin,confidence};
}

type NodeRow={id:string;type:NodeType;key:string;label:string;properties:Properties;status:Status;origin:Origin;confidence:string;version:number;first_seen:Date;last_seen:Date;superseded_by:string|null};
type EdgeRow={id:string;from_node:string;to_node:string;relation:Relation;properties:Properties;status:Status;origin:Origin;confidence:string;first_seen:Date;last_seen:Date};
const NODE_COLUMNS='id,type,key,label,properties,status,origin,confidence,version,first_seen,last_seen,superseded_by';
const EDGE_COLUMNS='id,from_node,to_node,relation,properties,status,origin,confidence,first_seen,last_seen';
export function nodeFromRow(row:NodeRow):KnowledgeNode{
 return {...row,confidence:Number(row.confidence),first_seen:row.first_seen.toISOString(),last_seen:row.last_seen.toISOString()};
}
export function edgeFromRow(row:EdgeRow):KnowledgeEdge{
 return {...row,confidence:Number(row.confidence),first_seen:row.first_seen.toISOString(),last_seen:row.last_seen.toISOString()};
}

function assertScope(scope:KnowledgeScope):void{
 if(!UUID.test(scope.organizationId)||!UUID.test(scope.brandId))throw new KnowledgeError('KNOWLEDGE_SCOPE_INVALID');
}
/** One writer per business at a time, so two jobs finding the same thing cannot both insert it. */
async function lockGraph(db:PoolClient,scope:KnowledgeScope):Promise<void>{
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`knowledge:${scope.brandId.toLowerCase()}`]);
}
function written(count:number|null):void{
 if(!count)throw new KnowledgeError('KNOWLEDGE_WRITE_DENIED');
}

async function loadNodes(db:PoolClient,scope:KnowledgeScope,refs:readonly NodeRef[]):Promise<Map<string,NodeRow>>{
 if(!refs.length)return new Map();
 const {rows}=await db.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM app.knowledge_nodes WHERE organization_id=$1 AND brand_id=$2 AND (type,key) IN (SELECT * FROM unnest($3::text[],$4::text[]))`,
  [scope.organizationId,scope.brandId,refs.map(r=>r.type),refs.map(r=>r.key)]);
 return new Map(rows.map(row=>[refId(row),row]));
}

async function writeNode(db:PoolClient,scope:KnowledgeScope,node:NodeMutation,row:NodeRow|undefined,context:WriteContext):Promise<{row:NodeRow;write:NodeWrite}>{
 const decision=mergeNode(row?{...row,confidence:Number(row.confidence)}:null,node),ref={type:node.type,key:node.key},base=[scope.organizationId,scope.brandId];
 const done=(next:NodeRow,outcome:WriteOutcome,conflict=false)=>({row:next,write:{ref,id:next.id,outcome,version:next.version,conflict}});
 if(decision.action==='insert'){
  const reviewer=node.status==='approved'?context.actor:null;
  const {rows:[created]}=await db.query<NodeRow>(`INSERT INTO app.knowledge_nodes(id,organization_id,brand_id,type,key,label,properties,status,origin,confidence,reviewed_by,reviewed_at)
   VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11::uuid IS NULL THEN NULL ELSE now() END) RETURNING ${NODE_COLUMNS}`,
   [...base,randomUUID(),node.type,node.key,node.label,stableJSON(node.properties),node.status,node.origin,node.confidence,reviewer]);
  return done(created,'inserted');
 }
 if(!row)throw new KnowledgeError('KNOWLEDGE_STATE_INVALID');
 if(decision.action==='keep')return done(row,'kept',decision.conflict);
 if(decision.action==='touch'){
  const result=await db.query<NodeRow>(`UPDATE app.knowledge_nodes SET last_seen=now() WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${NODE_COLUMNS}`,[...base,row.id]);
  written(result.rowCount);return done(result.rows[0],'touched');
 }
 // Suggestions are refined without naming the review columns: the worker role holds no privilege on them.
 const result=decision.status==='approved'
  ?await db.query<NodeRow>(`UPDATE app.knowledge_nodes SET label=$4,properties=$5,origin=$6,confidence=$7,version=$8,last_seen=now(),status='approved',reviewed_by=$9,reviewed_at=now()
    WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${NODE_COLUMNS}`,[...base,row.id,decision.label,stableJSON(decision.properties),decision.origin,decision.confidence,decision.version,context.actor])
  :await db.query<NodeRow>(`UPDATE app.knowledge_nodes SET label=$4,properties=$5,origin=$6,confidence=$7,version=$8,last_seen=now()
    WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND status='suggested' RETURNING ${NODE_COLUMNS}`,[...base,row.id,decision.label,stableJSON(decision.properties),decision.origin,decision.confidence,decision.version]);
 written(result.rowCount);return done(result.rows[0],'updated');
}

/** Inserts new nodes and merges repeated ones by (type, key). Returns one result per input, in order. */
export async function upsertNodes(db:PoolClient,scope:KnowledgeScope,nodes:readonly NodeMutation[],context:WriteContext={}):Promise<NodeWrite[]>{
 assertScope(scope);
 if(nodes.length>KNOWLEDGE_LIMITS.batch)throw new KnowledgeError('KNOWLEDGE_BATCH_TOO_LARGE');
 nodes.forEach(node=>assertNodeMutation(node,context));
 if(!nodes.length)return [];
 await lockGraph(db,scope);
 const rows=await loadNodes(db,scope,nodes),writes:NodeWrite[]=[];
 for(const node of nodes){
  // A key repeated within one batch merges into the row written a moment ago.
  const result=await writeNode(db,scope,node,rows.get(refId(node)),context);
  rows.set(refId(node),result.row);writes.push(result.write);
 }
 return writes;
}

type EdgeKey={from:string;to:string;relation:Relation};
const edgeId=(edge:EdgeKey):string=>`${edge.from}>${edge.relation}>${edge.to}`;
async function loadEdges(db:PoolClient,scope:KnowledgeScope,keys:readonly EdgeKey[]):Promise<Map<string,EdgeRow>>{
 if(!keys.length)return new Map();
 const {rows}=await db.query<EdgeRow>(`SELECT ${EDGE_COLUMNS} FROM app.knowledge_edges WHERE organization_id=$1 AND brand_id=$2 AND (from_node,to_node,relation) IN (SELECT * FROM unnest($3::uuid[],$4::uuid[],$5::text[]))`,
  [scope.organizationId,scope.brandId,keys.map(k=>k.from),keys.map(k=>k.to),keys.map(k=>k.relation)]);
 return new Map(rows.map(row=>[edgeId({from:row.from_node,to:row.to_node,relation:row.relation}),row]));
}

async function writeEdge(db:PoolClient,scope:KnowledgeScope,edge:EdgeMutation,key:EdgeKey,row:EdgeRow|undefined,context:WriteContext):Promise<{row:EdgeRow;outcome:WriteOutcome}>{
 const decision=mergeEdge(row?{...row,confidence:Number(row.confidence)}:null,edge),base=[scope.organizationId,scope.brandId];
 if(decision.action==='insert'){
  const reviewer=edge.status==='approved'?context.actor:null;
  const {rows:[created]}=await db.query<EdgeRow>(`INSERT INTO app.knowledge_edges(id,organization_id,brand_id,from_node,to_node,relation,properties,status,origin,confidence,reviewed_by,reviewed_at)
   VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11::uuid IS NULL THEN NULL ELSE now() END) RETURNING ${EDGE_COLUMNS}`,
   [...base,randomUUID(),key.from,key.to,key.relation,stableJSON(edge.properties),edge.status,edge.origin,edge.confidence,reviewer]);
  return {row:created,outcome:'inserted'};
 }
 if(!row)throw new KnowledgeError('KNOWLEDGE_STATE_INVALID');
 if(decision.action==='keep')return {row,outcome:'kept'};
 if(decision.action==='touch'){
  const result=await db.query<EdgeRow>(`UPDATE app.knowledge_edges SET last_seen=now() WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${EDGE_COLUMNS}`,[...base,row.id]);
  written(result.rowCount);return {row:result.rows[0],outcome:'touched'};
 }
 const result=decision.status==='approved'
  ?await db.query<EdgeRow>(`UPDATE app.knowledge_edges SET properties=$4,origin=$5,confidence=$6,last_seen=now(),status='approved',reviewed_by=$7,reviewed_at=now()
    WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${EDGE_COLUMNS}`,[...base,row.id,stableJSON(decision.properties),decision.origin,decision.confidence,context.actor])
  :await db.query<EdgeRow>(`UPDATE app.knowledge_edges SET properties=$4,origin=$5,confidence=$6,last_seen=now()
    WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND status='suggested' RETURNING ${EDGE_COLUMNS}`,[...base,row.id,stableJSON(decision.properties),decision.origin,decision.confidence]);
 written(result.rowCount);return {row:result.rows[0],outcome:'updated'};
}

/** Connects existing nodes. An edge to a missing node is an error; an edge to a rejected node is skipped. */
export async function upsertEdges(db:PoolClient,scope:KnowledgeScope,edges:readonly EdgeMutation[],context:WriteContext={}):Promise<EdgeWrite[]>{
 assertScope(scope);
 if(edges.length>KNOWLEDGE_LIMITS.batch)throw new KnowledgeError('KNOWLEDGE_BATCH_TOO_LARGE');
 edges.forEach(edge=>assertEdgeMutation(edge,context));
 if(!edges.length)return [];
 await lockGraph(db,scope);
 const nodes=await loadNodes(db,scope,edges.flatMap(edge=>[edge.from,edge.to]));
 const ends=edges.map(edge=>{
  const from=nodes.get(refId(edge.from)),to=nodes.get(refId(edge.to));
  if(!from||!to)throw new KnowledgeError('KNOWLEDGE_EDGE_DANGLING',refId(from?edge.to:edge.from));
  return {key:{from:from.id,to:to.id,relation:edge.relation},usable:from.status!=='rejected'&&to.status!=='rejected'};
 });
 const rows=await loadEdges(db,scope,ends.filter(end=>end.usable).map(end=>end.key)),writes:EdgeWrite[]=[];
 for(const [index,edge] of edges.entries()){
  const {key,usable}=ends[index],described={from:edge.from,to:edge.to,relation:edge.relation};
  if(!usable){writes.push({...described,id:null,outcome:'skipped'});continue;}
  const result=await writeEdge(db,scope,edge,key,rows.get(edgeId(key)),context);
  rows.set(edgeId(key),result.row);writes.push({...described,id:result.row.id,outcome:result.outcome});
 }
 return writes;
}

export type EvidenceTarget={readonly nodeId:string}|{readonly edgeId:string};
/** Records where a node or edge came from. The same reference attached twice is stored once. Returns rows added. */
export async function attachEvidence(db:PoolClient,scope:KnowledgeScope,target:EvidenceTarget,refs:readonly EvidenceRef[]):Promise<number>{
 assertScope(scope);refs.forEach(assertEvidence);
 const nodeId='nodeId' in target?target.nodeId:null,edge='edgeId' in target?target.edgeId:null;
 let added=0;
 for(const ref of refs){
  const fingerprint=sha256(stableJSON([nodeId,edge,ref.sourceId??null,ref.sourceUrl??null,ref.jobId??null,ref.excerpt]));
  const result=await db.query(`INSERT INTO app.knowledge_evidence(id,organization_id,brand_id,node_id,edge_id,source_id,source_url,job_id,excerpt,fingerprint)
   VALUES($3,$1,$2,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organization_id,brand_id,fingerprint) DO NOTHING`,
   [scope.organizationId,scope.brandId,randomUUID(),nodeId,edge,ref.sourceId??null,ref.sourceUrl??null,ref.jobId??null,ref.excerpt,fingerprint]);
  added+=result.rowCount??0;
 }
 return added;
}

export type AppliedMutations={nodes:NodeWrite[];edges:EdgeWrite[];evidence:number};
/** Applies a validated set of graph changes: nodes, then the edges between them, then their evidence. */
export async function applyMutations(db:PoolClient,scope:KnowledgeScope,mutations:GraphMutations,context:WriteContext={}):Promise<AppliedMutations>{
 const nodes=await upsertNodes(db,scope,mutations.nodes,context),edges=await upsertEdges(db,scope,mutations.edges,context);
 let evidence=0;
 for(const [index,node] of mutations.nodes.entries())evidence+=await attachEvidence(db,scope,{nodeId:nodes[index].id},node.evidence);
 for(const [index,edge] of mutations.edges.entries()){
  const id=edges[index].id;
  if(id)evidence+=await attachEvidence(db,scope,{edgeId:id},edge.evidence);
 }
 return {nodes,edges,evidence};
}

export type Review={readonly id:string;readonly decision:'approve'|'reject';readonly actor:string;
 /** An owner's correction made while approving. The node then counts as the owner's own statement. */
 readonly label?:string;readonly properties?:Properties};
/** A reviewer accepts or rejects a node. Row-level security refuses anyone who may not review this business. */
export async function reviewNode(db:PoolClient,scope:KnowledgeScope,review:Review):Promise<KnowledgeNode>{
 assertScope(scope);
 if(!UUID.test(review.id)||!UUID.test(review.actor))throw new KnowledgeError('KNOWLEDGE_REVIEW_INVALID');
 const corrected=review.decision==='approve'&&(review.label!==undefined||review.properties!==undefined);
 if(review.label!==undefined&&(!review.label.trim()||review.label.length>KNOWLEDGE_LIMITS.label))throw new KnowledgeError('KNOWLEDGE_LABEL_INVALID');
 const properties=review.properties===undefined?null:stableJSON(boundedProperties(review.properties,KNOWLEDGE_LIMITS.nodePropertiesBytes));
 const result=await db.query<NodeRow>(`UPDATE app.knowledge_nodes SET status=$4,reviewed_by=$5,reviewed_at=now(),
   label=CASE WHEN $6 THEN COALESCE($7,label) ELSE label END,properties=CASE WHEN $6 THEN COALESCE($8::jsonb,properties) ELSE properties END,
   origin=CASE WHEN $6 THEN 'owner' ELSE origin END,confidence=CASE WHEN $6 THEN 1 ELSE confidence END,version=version+CASE WHEN $6 THEN 1 ELSE 0 END
  WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${NODE_COLUMNS}`,
  [scope.organizationId,scope.brandId,review.id,review.decision==='approve'?'approved':'rejected',review.actor,corrected,review.label??null,properties]);
 if(!result.rowCount)throw new KnowledgeError('KNOWLEDGE_NOT_FOUND');
 return nodeFromRow(result.rows[0]);
}

export async function reviewEdge(db:PoolClient,scope:KnowledgeScope,review:Pick<Review,'id'|'decision'|'actor'>):Promise<KnowledgeEdge>{
 assertScope(scope);
 if(!UUID.test(review.id)||!UUID.test(review.actor))throw new KnowledgeError('KNOWLEDGE_REVIEW_INVALID');
 const result=await db.query<EdgeRow>(`UPDATE app.knowledge_edges SET status=$4,reviewed_by=$5,reviewed_at=now() WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${EDGE_COLUMNS}`,
  [scope.organizationId,scope.brandId,review.id,review.decision==='approve'?'approved':'rejected',review.actor]);
 if(!result.rowCount)throw new KnowledgeError('KNOWLEDGE_NOT_FOUND');
 return edgeFromRow(result.rows[0]);
}

/** Marks `oldId` as replaced by `newId` and records the link. The old node stays for history but leaves context packs. */
export async function supersedeNode(db:PoolClient,scope:KnowledgeScope,input:{readonly oldId:string;readonly newId:string;readonly actor:string}):Promise<KnowledgeNode>{
 assertScope(scope);
 if(![input.oldId,input.newId,input.actor].every(id=>UUID.test(id))||input.oldId===input.newId)throw new KnowledgeError('KNOWLEDGE_SUPERSEDE_INVALID');
 await lockGraph(db,scope);
 const {rows}=await db.query<NodeRow>(`SELECT ${NODE_COLUMNS} FROM app.knowledge_nodes WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[])`,[scope.organizationId,scope.brandId,[input.oldId,input.newId]]);
 const older=rows.find(row=>row.id===input.oldId),newer=rows.find(row=>row.id===input.newId);
 if(!older||!newer)throw new KnowledgeError('KNOWLEDGE_NOT_FOUND');
 // The replacement must itself be current, which also rules out a loop.
 if(newer.superseded_by||newer.status==='rejected'||newer.type!==older.type)throw new KnowledgeError('KNOWLEDGE_SUPERSEDE_INVALID');
 const result=await db.query<NodeRow>(`UPDATE app.knowledge_nodes SET superseded_by=$4 WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING ${NODE_COLUMNS}`,[scope.organizationId,scope.brandId,input.oldId,input.newId]);
 written(result.rowCount);
 await upsertEdges(db,scope,[{from:{type:newer.type,key:newer.key},to:{type:older.type,key:older.key},relation:'supersedes',properties:{},status:'approved',origin:'owner',confidence:1,evidence:[]}],{actor:input.actor});
 return nodeFromRow(result.rows[0]);
}

export type NeighbourhoodQuery={readonly seeds:readonly string[];readonly depth?:number;readonly limit?:number;
 /** Unreviewed nodes and edges are followed only when asked for. Rejected ones never are. */
 readonly includeSuggested?:boolean};
export type Neighbourhood={nodes:(KnowledgeNode&{depth:number})[];edges:KnowledgeEdge[]};
/** The nodes within `depth` steps of the seeds (at most 3), nearest first, and the edges among them. */
export async function neighbourhood(db:PoolClient,scope:KnowledgeScope,query:NeighbourhoodQuery):Promise<Neighbourhood>{
 assertScope(scope);
 const depth=query.depth??1,limit=query.limit??200;
 if(!Number.isInteger(depth)||depth<0||!Number.isInteger(limit)||limit<1||query.seeds.some(id=>!UUID.test(id)))throw new KnowledgeError('KNOWLEDGE_QUERY_INVALID');
 const statuses=query.includeSuggested?['approved','suggested']:['approved'];
 const {rows}=await db.query<NodeRow&{depth:number}>(`WITH RECURSIVE walk(id,depth) AS (
   SELECT n.id,0 FROM app.knowledge_nodes n WHERE n.organization_id=$1 AND n.brand_id=$2 AND n.id=ANY($3::uuid[]) AND n.status<>'rejected'
   UNION
   SELECT m.id,w.depth+1 FROM walk w
    JOIN app.knowledge_edges e ON e.organization_id=$1 AND e.brand_id=$2 AND (e.from_node=w.id OR e.to_node=w.id) AND e.status=ANY($5::text[])
    JOIN app.knowledge_nodes m ON m.organization_id=$1 AND m.brand_id=$2 AND m.id=CASE WHEN e.from_node=w.id THEN e.to_node ELSE e.from_node END AND m.status=ANY($5::text[]) AND m.superseded_by IS NULL
   WHERE w.depth<$4)
  SELECT ${NODE_COLUMNS.split(',').map(column=>`n.${column}`).join(',')},d.depth FROM (SELECT id,min(depth)::int AS depth FROM walk GROUP BY id) d
   JOIN app.knowledge_nodes n ON n.id=d.id ORDER BY d.depth,n.type,n.key,n.id LIMIT $6`,
  [scope.organizationId,scope.brandId,query.seeds,Math.min(depth,KNOWLEDGE_LIMITS.depth),statuses,Math.min(limit,KNOWLEDGE_LIMITS.neighbours)]);
 const ids=rows.map(row=>row.id);
 const edges=await db.query<EdgeRow>(`SELECT ${EDGE_COLUMNS} FROM app.knowledge_edges WHERE organization_id=$1 AND brand_id=$2 AND from_node=ANY($3::uuid[]) AND to_node=ANY($3::uuid[]) AND status=ANY($4::text[]) ORDER BY relation,from_node,to_node`,
  [scope.organizationId,scope.brandId,ids,statuses]);
 return {nodes:rows.map(row=>({...nodeFromRow(row),depth:row.depth})),edges:edges.rows.map(edgeFromRow)};
}
