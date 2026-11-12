"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {api} from './api';
import {Loading,Notice} from './primitives';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {EmptyState} from './ui/empty-state';
import {StatusBadge} from './ui/status-badge';
import styles from './knowledge-view.module.css';

type NodeStatus='suggested'|'approved'|'rejected';
type KnowledgeNode={id:string;type:string;label:string;status:NodeStatus;origin:'extracted'|'inferred'|'owner';confidence:number;evidence_count:number;superseded_by:string|null};
type KnowledgeEdge={id:string;from_node:string;to_node:string;relation:string;status:NodeStatus};
type Page={nodes:KnowledgeNode[];edges:KnowledgeEdge[];next_cursor:string|null};
export type KnowledgeBusiness={id:string;name:string;role:string};

/** Reader-facing names for graph types, in the order a business owner thinks about them. */
const TYPE_LABELS:ReadonlyArray<readonly [string,string]>=[
 ['business','Business'],['offer','Offers'],['positioning','Positioning'],['audience','Audiences'],['persona','Personas'],
 ['pain','Customer pains'],['angle','Angles'],['proof_point','Proof points'],['competitor','Competitors'],['pillar','Content pillars'],
 ['format','Formats'],['visual_direction','Visual direction'],['voice','Voice'],['brand_element','Brand elements'],['rule','Rules'],
 ['asset','Assets'],['post','Posts'],['result','Results'],['lesson','Lessons'],
];
const RELATION_LABELS:Record<string,string>={targets:'targets',solves:'solves',differentiates_from:'differs from',proves:'supports',expresses:'expresses',
 used_in:'used in',performed:'performed',contradicts:'contradicts',supersedes:'replaces',offers:'offers',has_pain:'has pain',belongs_to:'belongs to',
 constrains:'constrains',learned_from:'learned from',related_to:'related to'};
const FILTERS:ReadonlyArray<readonly [NodeStatus|'all',string]>=[['suggested','To review'],['approved','Approved'],['rejected','Rejected'],['all','Everything']];
const ORIGIN_LABELS:Record<KnowledgeNode['origin'],string>={extracted:'Found in your research',inferred:'Inferred by Desvio',owner:'Added by you'};

function badgeFor(status:NodeStatus){
 return status==='approved'?<StatusBadge status="approved"/>:status==='rejected'?<StatusBadge status="failed" label="Rejected"/>:<StatusBadge status="in_review" label="To review"/>;
}

/** "What Desvio knows": the business's knowledge graph, grouped by kind, with review for owners and admins. */
export function KnowledgeView({business}:{business:KnowledgeBusiness}){
 const reviewer=['owner','admin'].includes(business.role);
 const [filter,setFilter]=useState<NodeStatus|'all'>('suggested');
 const [nodes,setNodes]=useState<KnowledgeNode[]>([]),[edges,setEdges]=useState<KnowledgeEdge[]>([]);
 const [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState<unknown>();
 const root=`/api/v1/businesses/${business.id}/knowledge`;

 const load=useCallback(async(next:string|null)=>{
  setLoading(true);setError(undefined);
  const params=new URLSearchParams({limit:'100'});if(filter!=='all')params.set('status',filter);if(next)params.set('cursor',next);
  try{
   const page=await api<Page>(`${root}?${params}`);
   setNodes(prev=>next?[...prev,...page.nodes]:page.nodes);setEdges(prev=>next?[...prev,...page.edges]:page.edges);setCursor(page.next_cursor);
  }catch(e){setError(e);}finally{setLoading(false);}
 },[root,filter]);
 useEffect(()=>{void load(null);},[load]);

 const byId=useMemo(()=>new Map(nodes.map(n=>[n.id,n])),[nodes]);
 const groups=useMemo(()=>TYPE_LABELS.map(([type,label])=>({type,label,items:nodes.filter(n=>n.type===type&&!n.superseded_by)})).filter(g=>g.items.length),[nodes]);
 const links=useCallback((id:string)=>edges.filter(e=>e.status!=='rejected'&&(e.from_node===id||e.to_node===id)).flatMap(e=>{
  const other=byId.get(e.from_node===id?e.to_node:e.from_node);if(!other)return [];
  const relation=RELATION_LABELS[e.relation]??e.relation.replace(/_/g,' ');
  return [e.from_node===id?`${relation} ${other.label}`:`${other.label} ${relation} this`];
 }).slice(0,4),[edges,byId]);

 async function review(node:KnowledgeNode,decision:'approve'|'reject'){
  setBusy(node.id);setError(undefined);
  try{
   const updated=await api<KnowledgeNode>(`${root}/nodes/${node.id}/review`,{decision},'POST');
   setNodes(prev=>filter==='all'||updated.status===filter?prev.map(n=>n.id===node.id?{...n,...updated}:n):prev.filter(n=>n.id!==node.id));
  }catch(e){setError(e);}finally{setBusy(null);}
 }

 return <section className={styles.screen} aria-labelledby="knowledge-title">
  <header className={styles.heading}>
   <div>
    <p className={styles.eyebrow}>{business.name}</p>
    <h1 id="knowledge-title">What Desvio knows</h1>
    <p className={styles.lede}>Everything Desvio has learned about your business from your website, documents, competitors, your answers and your feedback. Approved items shape new plans and posts; items to review are only suggestions until you approve them.</p>
   </div>
  </header>
  <div className={styles.filters} role="group" aria-label="Show">
   {FILTERS.map(([value,label])=><Button key={value} size="sm" variant={filter===value?'primary':'quiet'} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</Button>)}
  </div>
  <Notice error={error}/>
  {loading&&!nodes.length?<Loading/>:!groups.length?
   <EmptyState title={filter==='suggested'?'Nothing to review':'Nothing here yet'} description={filter==='suggested'?'New findings from research, plans and your feedback appear here for you to confirm.':'Approve your brand profile and run research to start building what Desvio knows.'}/>:
   <div className={styles.groups}>
    {groups.map(group=><section key={group.type} aria-labelledby={`k-${group.type}`}>
     <h2 id={`k-${group.type}`} className={styles.groupTitle}>{group.label} <span className={styles.count}>{group.items.length}</span></h2>
     <ul className={styles.items}>
      {group.items.map(node=><li key={node.id}><Card className={styles.item}>
       <div className={styles.itemHead}><p className={styles.label}>{node.label}</p>{badgeFor(node.status)}</div>
       <p className={styles.meta}>{ORIGIN_LABELS[node.origin]}{node.evidence_count?` · ${node.evidence_count} source${node.evidence_count===1?'':'s'}`:''}{node.origin!=='owner'?` · ${Math.round(node.confidence*100)}% confidence`:''}</p>
       {links(node.id).length>0&&<ul className={styles.links}>{links(node.id).map(text=><li key={text}>{text}</li>)}</ul>}
       {reviewer&&node.status==='suggested'&&<div className={styles.actions}>
        <Button size="sm" variant="primary" loading={busy===node.id} disabled={!!busy} onClick={()=>void review(node,'approve')}>Approve</Button>
        <Button size="sm" variant="quiet" disabled={!!busy} onClick={()=>void review(node,'reject')}>Not right</Button>
       </div>}
      </Card></li>)}
     </ul>
    </section>)}
   </div>}
  {cursor&&<Button variant="secondary" loading={loading} onClick={()=>void load(cursor)}>Show more</Button>}
  {!reviewer&&<p className={styles.note}>Only owners and admins can approve knowledge.</p>}
 </section>;
}
