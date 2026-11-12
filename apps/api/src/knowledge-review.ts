/** Owner view of what Desvio knows about a business: list the graph, approve or reject, supersede.
 * Every call runs in the caller's tenant transaction; who may review is enforced by row-level security. */
import {BadRequestException,ForbiddenException,NotFoundException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {Businesses} from './businesses.js';
import {KnowledgeError,NODE_TYPES,edgeFromRow,nodeFromRow,reviewEdge,reviewNode,supersedeNode,type KnowledgeEdge,type KnowledgeNode,type KnowledgeScope,type NodeType,type Properties,type Status} from './knowledge-graph.js';
import {uuid} from './workspaces.js';

export const KNOWLEDGE_PAGE={defaultLimit:50,maxLimit:100,maxEdges:500} as const;
const STATUSES:readonly Status[]=['suggested','approved','rejected'];
type ListQuery={status?:unknown;type?:unknown;cursor?:unknown;limit?:unknown};
export type KnowledgeListNode=KnowledgeNode&{evidence_count:number};
export type KnowledgePage={nodes:KnowledgeListNode[];edges:KnowledgeEdge[];next_cursor:string|null};

/** Query parameters, validated: unknown values are refused rather than ignored. */
export function knowledgeListQuery(query:ListQuery):{status:Status|null;type:NodeType|null;cursor:string|null;limit:number}{
 const status=query.status===undefined?null:String(query.status);
 if(status!==null&&!STATUSES.includes(status as Status))throw new BadRequestException('Unknown knowledge status');
 const type=query.type===undefined?null:String(query.type);
 if(type!==null&&!(NODE_TYPES as readonly string[]).includes(type))throw new BadRequestException('Unknown knowledge type');
 const cursor=query.cursor===undefined?null:uuid(String(query.cursor));
 const limit=query.limit===undefined?KNOWLEDGE_PAGE.defaultLimit:Number(query.limit);
 if(!Number.isInteger(limit)||limit<1||limit>KNOWLEDGE_PAGE.maxLimit)throw new BadRequestException(`Choose a page size from 1 to ${KNOWLEDGE_PAGE.maxLimit}`);
 return {status:status as Status|null,type:type as NodeType|null,cursor,limit};
}

function decisionOf(body:unknown):'approve'|'reject'{
 const decision=(body as {decision?:unknown}|null)?.decision;
 if(decision!=='approve'&&decision!=='reject')throw new BadRequestException('Choose approve or reject');
 return decision;
}
function correctionOf(body:unknown):{label?:string;properties?:Properties}{
 const v=(body??{}) as Record<string,unknown>;
 const extra=Object.keys(v).filter(k=>!['decision','label','properties'].includes(k));
 if(extra.length)throw new BadRequestException('Unknown review field');
 if(v.label!==undefined&&typeof v.label!=='string')throw new BadRequestException('Label must be text');
 if(v.properties!==undefined&&(typeof v.properties!=='object'||v.properties===null||Array.isArray(v.properties)))throw new BadRequestException('Properties must be an object');
 return {...(v.label!==undefined?{label:v.label as string}:{}),...(v.properties!==undefined?{properties:v.properties as Properties}:{})};
}
/** Graph and database faults as customer-safe HTTP errors. */
function translate(error:unknown):never{
 if(error instanceof KnowledgeError){
  if(error.code==='KNOWLEDGE_NOT_FOUND')throw new NotFoundException('Knowledge item not found');
  throw new BadRequestException('This knowledge change is not valid');
 }
 if((error as {code?:unknown})?.code==='42501')throw new ForbiddenException('Only a business owner or admin can review knowledge');
 throw error;
}

export class KnowledgeReview{
 constructor(readonly businesses:Businesses){}
 private async scope<T>(user:string,id:string,write:boolean,action:(db:PoolClient,scope:KnowledgeScope)=>Promise<T>):Promise<T>{
  const b=await this.businesses.resolve(user,id);
  try{return await this.businesses.database.transaction(user,b.organization_id,write,(db:PoolClient)=>action(db,{organizationId:b.organization_id,brandId:id}),id);}
  catch(error){return translate(error);}
 }
 /** One page of nodes in id order, with the edges among the page's nodes. Bounded on both counts. */
 async list(user:string,id:string,query:ListQuery):Promise<KnowledgePage>{
  const q=knowledgeListQuery(query);
  return this.scope(user,id,false,async(db,scope)=>{
   const {rows}=await db.query(`SELECT n.id,n.type,n.key,n.label,n.properties,n.status,n.origin,n.confidence,n.version,n.first_seen,n.last_seen,n.superseded_by,
     (SELECT count(*)::int FROM app.knowledge_evidence e WHERE e.organization_id=n.organization_id AND e.brand_id=n.brand_id AND e.node_id=n.id) AS evidence_count
    FROM app.knowledge_nodes n WHERE n.organization_id=$1 AND n.brand_id=$2 AND ($3::text IS NULL OR n.status=$3) AND ($4::text IS NULL OR n.type=$4) AND ($5::uuid IS NULL OR n.id>$5)
    ORDER BY n.id LIMIT $6`,[scope.organizationId,scope.brandId,q.status,q.type,q.cursor,q.limit+1]);
   const page=rows.slice(0,q.limit),ids=page.map(row=>row.id);
   const edges=ids.length?(await db.query(`SELECT id,from_node,to_node,relation,properties,status,origin,confidence,first_seen,last_seen FROM app.knowledge_edges
    WHERE organization_id=$1 AND brand_id=$2 AND (from_node=ANY($3::uuid[]) OR to_node=ANY($3::uuid[])) ORDER BY id LIMIT $4`,[scope.organizationId,scope.brandId,ids,KNOWLEDGE_PAGE.maxEdges])).rows:[];
   return {nodes:page.map(({evidence_count,...row})=>({...nodeFromRow(row),evidence_count})),edges:edges.map(edgeFromRow),next_cursor:rows.length>q.limit?page[page.length-1].id:null};
  });
 }
 async reviewNode(user:string,id:string,nodeId:string,body:unknown):Promise<KnowledgeNode>{
  const decision=decisionOf(body),correction=correctionOf(body),node=uuid(nodeId);
  return this.scope(user,id,true,(db,scope)=>reviewNode(db,scope,{id:node,decision,actor:user,...(decision==='approve'?correction:{})}));
 }
 async reviewEdge(user:string,id:string,edgeId:string,body:unknown):Promise<KnowledgeEdge>{
  const decision=decisionOf(body),edge=uuid(edgeId);
  if(Object.keys((body??{}) as object).some(k=>k!=='decision'))throw new BadRequestException('Unknown review field');
  return this.scope(user,id,true,(db,scope)=>reviewEdge(db,scope,{id:edge,decision,actor:user}));
 }
 async supersede(user:string,id:string,nodeId:string,body:unknown):Promise<KnowledgeNode>{
  const v=(body??{}) as Record<string,unknown>;
  if(Object.keys(v).some(k=>k!=='replacement_id')||typeof v.replacement_id!=='string')throw new BadRequestException('Choose the replacement');
  const oldId=uuid(nodeId),newId=uuid(v.replacement_id);
  return this.scope(user,id,true,(db,scope)=>supersedeNode(db,scope,{oldId,newId,actor:user}));
 }
}
