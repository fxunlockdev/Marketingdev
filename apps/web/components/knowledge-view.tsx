"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {api} from './api';
import {Loading,Notice} from './primitives';
import {Button} from './ui/button';
import {EmptyState} from './ui/empty-state';
import {StatusBadge} from './ui/status-badge';
import {KNOWLEDGE_GROUPS,evidenceFor,relationLabel,type KnowledgeOrigin} from './knowledge-labels';
import {BrandProfileGate} from './brand-profile-gate';
import styles from './knowledge-view.module.css';

type NodeStatus='suggested'|'approved'|'rejected';
type KnowledgeNode={id:string;type:string;label:string;status:NodeStatus;origin:KnowledgeOrigin;confidence:number;evidence_count:number;superseded_by:string|null};
type KnowledgeEdge={id:string;from_node:string;to_node:string;relation:string;status:NodeStatus};
type Page={nodes:KnowledgeNode[];edges:KnowledgeEdge[];next_cursor:string|null};
type Link={relation:string;other:string};
export type KnowledgeBusiness={id:string;name:string;role:string;organization_id?:string;has_approved_brand?:boolean};

const FILTERS:ReadonlyArray<readonly [NodeStatus|'all',string]>=[['suggested','To review'],['approved','Approved'],['rejected','Rejected'],['all','Everything']];

function badgeFor(status:NodeStatus){
 return status==='approved'?<StatusBadge status="approved"/>:status==='rejected'?<StatusBadge status="failed" label="Rejected"/>:<StatusBadge status="in_review" label="To review"/>;
}

/** "What Desvio knows": the business's knowledge, one checklist per topic, with review for owners and admins. */
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
 const groups=useMemo(()=>KNOWLEDGE_GROUPS.map(g=>({...g,items:nodes.filter(n=>n.type===g.type&&!n.superseded_by)})).filter(g=>g.items.length),[nodes]);
 // Links to the business itself ("Runwal Enterprises offers this") repeat the topic title, so only links between findings show.
 const links=useCallback((id:string):Link[]=>edges.filter(e=>e.status!=='rejected'&&(e.from_node===id||e.to_node===id)).flatMap(e=>{
  const self=byId.get(id),other=byId.get(e.from_node===id?e.to_node:e.from_node);
  if(!self||!other||self.type==='business'||other.type==='business')return [];
  return [{relation:relationLabel(e.relation,e.from_node===id),other:other.label}];
 }).slice(0,3),[edges,byId]);

 const settle=(updated:KnowledgeNode)=>setNodes(prev=>filter==='all'||updated.status===filter?prev.map(n=>n.id===updated.id?{...n,...updated}:n):prev.filter(n=>n.id!==updated.id));
 async function review(list:KnowledgeNode[],decision:'approve'|'reject',key:string){
  setBusy(key);setError(undefined);
  try{for(const node of list)settle(await api<KnowledgeNode>(`${root}/nodes/${node.id}/review`,{decision},'POST'));}
  catch(e){setError(e);}finally{setBusy(null);}
 }

 const pending=groups.reduce((sum,g)=>sum+g.items.filter(n=>n.status==='suggested').length,0);
 return <section className={styles.screen} aria-labelledby="knowledge-title">
  <header className={styles.heading}>
   <p className={styles.eyebrow}>{business.name}</p>
   <h1 id="knowledge-title">What Desvio knows</h1>
   <p className={styles.lede}>What we found on your website, in your documents, about competitors and in your answers. Approved items shape every plan and post. Nothing here is used until you approve it.</p>
  </header>
  {/* Approving findings here refines what Desvio knows; creating posts needs the brand profile itself approved. */}
  {business.has_approved_brand===false&&<BrandProfileGate business={business}/>}
  <div className={styles.toolbar}>
   <div className={styles.filters} role="group" aria-label="Show">
    {FILTERS.map(([value,label])=><Button key={value} size="sm" variant={filter===value?'primary':'quiet'} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</Button>)}
   </div>
   {filter==='suggested'&&pending>0&&<p className={styles.tally} aria-live="polite"><strong>{pending}</strong> {pending===1?'item':'items'} to check</p>}
  </div>
  <Notice error={error}/>
  {loading&&!nodes.length?<Loading/>:!groups.length?
   <EmptyState title={filter==='suggested'?'Nothing to review':'Nothing here yet'} description={filter==='suggested'?'New findings from research, plans and your feedback appear here for you to confirm.':'Approve your brand profile and run research to start building what Desvio knows.'}/>:
   <div className={styles.groups}>
    {groups.map(group=>{
     const open=group.items.filter(n=>n.status==='suggested');
     return <section key={group.type} className={styles.group} aria-labelledby={`k-${group.type}`}>
      <header className={styles.groupHead}>
       <div>
        <h2 id={`k-${group.type}`}>{group.title} <span className={styles.count}>{group.items.length}</span></h2>
        <p>{group.help}</p>
       </div>
       {reviewer&&open.length>1&&<Button size="sm" variant="secondary" loading={busy===`group:${group.type}`} disabled={!!busy} onClick={()=>void review(open,'approve',`group:${group.type}`)}>Approve all {open.length}</Button>}
      </header>
      <ul className={styles.items}>
       {group.items.map(node=>{
        const evidence=evidenceFor(node),linked=links(node.id);
        return <li key={node.id} className={styles.item} data-status={node.status}>
         <div className={styles.body}>
          <p className={styles.label}>{node.label}</p>
          <p className={styles.meta}>
           {evidence.strength&&<span className={styles.strength} data-strength={evidence.strength}><span aria-hidden="true"><i/><i/><i/></span>{evidence.strengthLabel}</span>}
           <span>{evidence.source}</span>
          </p>
          {linked.length>0&&<ul className={styles.links} aria-label="Linked findings">{linked.map(l=><li key={l.relation+l.other}><span>{l.relation}</span> {l.other}</li>)}</ul>}
         </div>
         <div className={styles.side}>
          {(filter==='all'||node.status!=='suggested')&&badgeFor(node.status)}
          {reviewer&&node.status==='suggested'&&<div className={styles.actions}>
           <Button size="sm" variant="secondary" loading={busy===node.id} disabled={!!busy} label={`Approve ${node.label}`} onClick={()=>void review([node],'approve',node.id)}>Approve</Button>
           <Button size="sm" variant="quiet" disabled={!!busy} label={`${node.label} is not right`} onClick={()=>void review([node],'reject',node.id)}>Not right</Button>
          </div>}
         </div>
        </li>;
       })}
      </ul>
     </section>;
    })}
   </div>}
  {cursor&&<Button variant="secondary" loading={loading} onClick={()=>void load(cursor)}>Show more</Button>}
  {!reviewer&&<p className={styles.note}>Only owners and admins can approve knowledge.</p>}
 </section>;
}
