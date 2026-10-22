"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import {PrivateVisual} from './private-visual';
type Reference={id:string;visual_id:string;label:string;kind:string};
export function BrandReferences({businessId,writable,sources,selection,onSelectionChange,disabled=false}:{businessId:string;writable:boolean;sources?:any[];selection?:string[];onSelectionChange?:(ids:string[])=>void;disabled?:boolean}){
 const [references,setReferences]=useState<Reference[]>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const root=`/api/v1/businesses/${businessId}/canvas/references`;
 useEffect(()=>{let active=true;setReferences(undefined);setError(undefined);api(root).then(r=>{if(active)setReferences(r.references);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[root]);
 async function refresh(){const r=await api(root);setReferences(r.references);}
 async function revoke(id:string){setBusy(true);setError(undefined);try{await api(`${root}/${id}/revoke`,{});onSelectionChange?.((selection??[]).filter(v=>v!==id));await refresh();}catch(e){setError(e);}finally{setBusy(false);}}
 return <details className="v5-panel reference-library"><summary>{onSelectionChange?'Brand image references':'Approve images for future creatives'}{selection?.length?` · ${selection.length} selected`:''}</summary>
  <p>{onSelectionChange?'Choose up to three approved references for this request.':'Only images you explicitly approve here can be selected for AI creatives. Reviewing a brand fact or style does not approve image reuse.'}</p>
  <Notice error={error}/>
  {references===undefined?(error?<button type="button" onClick={()=>{setError(undefined);void refresh().catch(setError);}}>Retry loading references</button>:<p role="status">Loading approved references…</p>):references.length===0?<p>No approved images yet. Open Brand to review your captured pages and approve references.</p>:<ul className="reference-list">{references.map(r=><li key={r.id}>
   {onSelectionChange?<label className="reference-choice"><input type="checkbox" checked={selection?.includes(r.id)??false} disabled={disabled||busy||(!selection?.includes(r.id)&&(selection?.length??0)>=3)} onChange={e=>onSelectionChange(e.target.checked?[...(selection??[]),r.id]:(selection??[]).filter(v=>v!==r.id))}/>{r.label}</label>:<strong>{r.label}</strong>}
   <PrivateVisual businessId={businessId} visualId={r.visual_id} label={`Preview ${r.label}`} alt={r.label}/>
   {writable&&<button type="button" disabled={busy||disabled} onClick={()=>void revoke(r.id)}>Remove approval for {r.label}</button>}
  </li>)}</ul>}
  {sources&&writable&&sources.filter(v=>!references?.some(r=>r.visual_id===v.id)).map(v=><ApproveReference key={v.id} businessId={businessId} visual={v} disabled={busy||disabled||!references} onSaved={refresh}/>)}
  {!!references?.length&&<p>Removing approval stops new provider submissions. A request already submitted may still finish; saved creatives remain in their history.</p>}
 </details>;
}
function ApproveReference({businessId,visual,disabled,onSaved}:{businessId:string;visual:any;disabled:boolean;onSaved:()=>Promise<void>}){
 const title=visual.document_page?`Document page ${visual.document_page}`:`${visual.viewport} website capture`;
 const [label,setLabel]=useState(title),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 async function approve(){setBusy(true);setError(undefined);try{await api(`/api/v1/businesses/${businessId}/canvas/references`,{kind:visual.document_page?'document':'website',visual_id:visual.id,label,consent});await onSaved();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section aria-label={`Approve reference: ${title}`}><h4>{title}</h4>
  <PrivateVisual businessId={businessId} visualId={visual.id} label={`Inspect ${title}`} alt={title}/>
  <label>Reference name<input value={label} maxLength={140} disabled={disabled||busy} onChange={e=>setLabel(e.target.value)}/></label>
  <label className="reference-choice"><input type="checkbox" checked={consent} disabled={disabled||busy} onChange={e=>setConsent(e.target.checked)}/>I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.</label>
  <button type="button" disabled={disabled||busy||!consent||!label.trim()} onClick={()=>void approve()}>{busy?'Saving approval…':'Approve image reference'}</button><Notice error={error}/>
 </section>;
}
