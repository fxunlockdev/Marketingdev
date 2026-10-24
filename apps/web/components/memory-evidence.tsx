"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
type Fact={field:string;status:string;source_id?:string;source_sha256?:string;chunk_id?:string;reviewed_at?:string;evidence_type?:string;observation?:string;references?:unknown[]};
type Source={id:string;kind:string;sha256:string;website_url?:string;captured_at:string;chunks:{id:string;page:number;text:string}[]};
const sourceLabel=(kind:string)=>({manual:'Manually supplied information',website:'Website research',document:'Uploaded document'}[kind]??'Imported source');
export function MemoryEvidence({fact,path}:{fact:Fact;path:string}){
 const [open,setOpen]=useState(false),[source,setSource]=useState<Source>(),[error,setError]=useState<unknown>(),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!open||!fact.source_id)return;let active=true;setSource(undefined);setError(undefined);void api<Source>(`${path}/brain/sources/${fact.source_id}`).then(value=>{if(value.sha256!==fact.source_sha256||!value.chunks.some(c=>c.id===fact.chunk_id))throw new Error('The saved source does not match this approved fact.');if(active)setSource(value);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[open,path,fact.source_id,fact.source_sha256,fact.chunk_id,attempt]);
 const chunk=source?.chunks.find(c=>c.id===fact.chunk_id);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Evidence for {fact.field.replaceAll('_',' ')}</summary>
  {fact.reviewed_at&&<p className="hint">{fact.status==='edited'?'Corrected by your team':'Confirmed by your team'} · {new Date(fact.reviewed_at).toLocaleString()}</p>}
  {fact.evidence_type==='approved_visual_direction'?<><p>{fact.observation}</p><p className="hint">Approved visual interpretation with {fact.references?.length??0} saved image references. This is a design preference, not permission to reuse those images.</p></>:fact.source_id?<>
   <Notice error={error}/>{error&&<button onClick={()=>setAttempt(n=>n+1)}>Retry source evidence</button>}
   {!source&&!error&&open&&<p role="status">Loading saved evidence…</p>}
   {source&&chunk&&<><p>{sourceLabel(source.kind)}{source.kind!=='manual'&&` · page ${chunk.page}`}</p>{source.website_url&&<p className="hint" style={{overflowWrap:'anywhere'}}>{source.website_url}</p>}<p className="hint">Captured {new Date(source.captured_at).toLocaleString()}. The excerpt is source material; your approved value above remains authoritative.</p><blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{chunk.text}</blockquote></>}
  </>:<p>No source excerpt is recorded for this fact.</p>}
 </details>;
}
export function MemorySources({sources,businessId}:{sources:{id:string;kind:string;website_url?:string;captured_at:string}[];businessId:string}){
 return <section className="v5-panel" aria-labelledby="memory-sources"><h2 id="memory-sources">Saved brand sources</h2><p>Source material is evidence, not approved brand knowledge. Review and approve changes before they influence new creatives.</p>
 {sources.length?<details><summary>Browse saved sources ({sources.length})</summary><ol>{sources.map(s=><li key={s.id}><strong>{sourceLabel(s.kind)}</strong>{s.website_url&&<p style={{overflowWrap:'anywhere'}}>{s.website_url}</p>}<p className="hint">Captured {new Date(s.captured_at).toLocaleString()}</p></li>)}</ol>{sources.length===100&&<p>Showing the first 100 saved sources.</p>}</details>:<p>No source material saved yet.</p>}
 <a href={`/b/${businessId}/onboarding`}>Add or review brand sources →</a>
 </section>;
}
