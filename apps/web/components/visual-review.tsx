"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {PrivateVisual} from './private-visual';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
const identity=(d:any)=>`${d.analysis_job_id}:${d.index}`;
export function VisualReview({state,path,writable,onSaved,onEditingChange}:{state:any;path:string;writable:boolean;onSaved:()=>Promise<void>;onEditingChange:(editing:boolean)=>void}){
 const [held,setHeld]=useState<Record<string,any>>({});
 useEffect(()=>{onEditingChange(Object.keys(held).length>0);return()=>onEditingChange(false);},[held,onEditingChange]);
 const live=[...(state?.directions??[]),...(state?.retained_directions??[])];
 const current=new Set(live.map(identity));
 // Keep an edited card mounted even when an analysis removes/replaces it.
 const orphaned=Object.values(held).filter(d=>!current.has(identity(d)));
 function editing(d:any,active:boolean){if(active)onEditingChange(true);setHeld(previous=>{const next={...previous};if(active)next[identity(d)]=d;else delete next[identity(d)];return next;});}
 if(!live.length&&!orphaned.length)return null;
 return <section className="v5-panel" aria-label="Review visual identity">
  <h2>Make the visual direction yours.</h2>
  <p>Review these suggestions from your website and uploaded guidelines. Accepted directions become design preferences in your approved brand profile. This does not approve source images for reuse.</p>
  {state?.stale&&<p role="status">Your source evidence changed. Run analysis again before reviewing new suggestions. You can still edit your previously approved preferences.</p>}
  <div className="finding-grid">{[...live,...orphaned].map(d=><Direction key={identity(d)} direction={d} obsolete={!current.has(identity(d))} stale={!!state?.stale&&!d.retained} path={path} writable={writable} onSaved={onSaved} onEditing={editing}/>)}</div>
 </section>;
}
function Direction({direction,obsolete,stale,path,writable,onSaved,onEditing}:{direction:any;obsolete:boolean;stale:boolean;path:string;writable:boolean;onSaved:()=>Promise<void>;onEditing:(d:any,active:boolean)=>void}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[base,setBase]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState('');
 useUnsavedChanges(editing);
 const category=direction.suggestion.category.replaceAll('_',' ');
 const changed=obsolete||(editing&&base&&(base.evidence_sha256!==direction.evidence_sha256||(base.review?.revision??0)!==(direction.review?.revision??0)));
 async function decide(decision:string,replacement?:string){
  const d=editing?base:direction;
  let committed=false;onEditing(d,true);
  setBusy(true);setError(undefined);setSaved('');
  try{
   await api(path+'/brain/visuals',{analysis_job_id:d.analysis_job_id,index:d.index,evidence_sha256:d.evidence_sha256,revision:d.review?.revision??0,decision,...(decision==='edited'?{value:replacement??value}:{})},'PATCH');
   committed=true;setEditing(false);setSaved('Visual decision saved. Confirm your brand profile to use it in new creatives.');await onSaved();
  }catch(e){setError(e);}finally{setBusy(false);if(committed||!editing)onEditing(d,false);}
 }
 function startEdit(){setBase(direction);setValue(direction.review?.status==='wrong'&&direction.retained?direction.approved_value:(direction.review?.value??direction.suggestion.creative_direction));setEditing(true);onEditing(direction,true);setSaved('');}
 function discard(){setEditing(false);onEditing(base??direction,false);setError(undefined);}
 return <article className="v5-panel" aria-label={`${obsolete?'Unsaved visual direction':'Visual direction'}: ${category}`} aria-busy={busy}>
  <h3>{category}</h3>
  {direction.retained&&<p>Previously approved style · editable without another AI analysis</p>}
  <p className="status neutral">{direction.review?.status==='wrong'&&direction.retained?'Marked for removal':direction.review?.status??'Needs review'}</p>
  <p><strong>Observed:</strong> {direction.suggestion.observation}</p>
  {editing?<Field label={`Edit visual ${category}`} hint="Describe the style you want Desvio to follow.">{(id,hint)=><textarea id={id} aria-describedby={hint} readOnly={busy} required maxLength={1500} value={value} onChange={e=>setValue(e.target.value)}/>}</Field>:<p>{direction.review?.value??direction.suggestion.creative_direction}</p>}
  <details><summary>Supporting visual evidence</summary><ul>{direction.manifest.filter((r:any)=>direction.suggestion.image_ids.includes(r.id)).map((r:any)=><li key={r.id}>{r.document_page ? <PrivateVisual businessId={path.split('/').at(-1)!} visualId={r.visual_id} label={`View document page ${r.document_page}`} alt={`Source guideline page ${r.document_page}`}/> : <a href={r.website_url} target="_blank" rel="noopener noreferrer">{r.viewport} · {r.view} · source page</a>}</li>)}</ul></details>
  <Notice error={error}/>{saved&&<p role="status">{saved}</p>}
  {changed&&<p role="status">This suggestion changed while you were editing. Your text is retained so you can copy it. Discard this edit before reviewing the latest suggestion.</p>}
  {writable&&<div className="actions">{editing?<>
   <button disabled={busy||stale||changed||!value.trim()} onClick={()=>void decide('edited')}>Save visual correction</button>
   <button disabled={busy} onClick={discard}>{changed?'Discard edit & reload suggestion':'Cancel visual edit'}</button>
  </>:<>
   {direction.retained?direction.review.status==='wrong'?<button disabled={busy||obsolete} onClick={()=>void decide('edited',direction.approved_value)}>Restore approved style</button>:<button disabled={busy||obsolete} onClick={()=>void decide('wrong')}>Remove style</button>:<><button disabled={busy||stale||obsolete} onClick={()=>void decide('correct')}>Correct</button><button disabled={busy||stale||obsolete} onClick={()=>void decide('wrong')}>Wrong</button></>}
   <button disabled={busy||stale||obsolete} onClick={startEdit}>Edit</button>
  </>}</div>}
 </article>;
}
