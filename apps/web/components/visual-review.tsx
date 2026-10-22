"use client";
import {useState} from 'react';
import {api} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
export function VisualReview({state,path,writable,onSaved}:{state:any;path:string;writable:boolean;onSaved:()=>Promise<void>}){
 if(!state?.directions?.length&&!state?.retained?.length)return null;
 return <section className="v5-panel" aria-label="Review visual identity">
  <h2>Make the visual direction yours.</h2>
  <p>Review these suggestions from your website. Accepted directions become design preferences in your approved brand profile. This does not approve source images for reuse.</p>
  {state.stale&&<p role="status">Your website evidence changed. Run analysis again before reviewing these directions.</p>}
  {state.retained?.length>0&&<div><h3>Previously approved style</h3><p>These preferences are retained because this analysis did not propose a replacement for them.</p><ul>{state.retained.map((f:any)=><li key={f.id}>{f.value}</li>)}</ul></div>}
  <div className="finding-grid">{state.directions.map((d:any)=><Direction key={d.index} direction={d} stale={state.stale} path={path} writable={writable} onSaved={onSaved}/>)}</div>
 </section>;
}
function Direction({direction,stale,path,writable,onSaved}:{direction:any;stale:boolean;path:string;writable:boolean;onSaved:()=>Promise<void>}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[base,setBase]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState('');
 useUnsavedChanges(editing&&!busy);
 const category=direction.suggestion.category.replaceAll('_',' '),changed=editing&&base&&(base.analysis_job_id!==direction.analysis_job_id||base.evidence_sha256!==direction.evidence_sha256||(base.review?.revision??0)!==(direction.review?.revision??0));
 async function decide(decision:string){
  const d=editing?base:direction;
  setBusy(true);setError(undefined);setSaved('');
  try{
   await api(path+'/brain/visuals',{analysis_job_id:d.analysis_job_id,index:d.index,evidence_sha256:d.evidence_sha256,revision:d.review?.revision??0,decision,...(decision==='edited'?{value}:{})},'PATCH');
   setEditing(false);setSaved('Visual decision saved. Confirm your brand profile to use it in new creatives.');await onSaved();
  }catch(e){setError(e);}finally{setBusy(false);}
 }
 return <article className="v5-panel" aria-label={`Visual direction: ${category}`} aria-busy={busy}>
  <h3>{category}</h3><p className="status neutral">{direction.review?.status??'Needs review'}</p>
  <p><strong>Observed:</strong> {direction.suggestion.observation}</p>
  {editing?<Field label={`Edit visual ${category}`} hint="Describe the style you want Desvio to follow.">{(id,hint)=><textarea id={id} aria-describedby={hint} required maxLength={1500} value={value} onChange={e=>setValue(e.target.value)}/>}</Field>:<p>{direction.review?.value??direction.suggestion.creative_direction}</p>}
  <details><summary>Supporting visual evidence</summary><ul>{direction.manifest.filter((r:any)=>direction.suggestion.image_ids.includes(r.id)).map((r:any)=><li key={r.id}><a href={r.website_url} target="_blank" rel="noopener noreferrer">{r.viewport} · {r.view} · source page</a></li>)}</ul></details>
  <Notice error={error}/>{saved&&<p role="status">{saved}</p>}
  {changed&&<p role="status">This suggestion changed while you were editing. Your text is retained; reload the suggestion before making a new decision.</p>}
  {writable&&<div className="actions">{editing?<>
   <button disabled={busy||stale||changed||!value.trim()} onClick={()=>void decide('edited')}>Save visual correction</button>
   <button disabled={busy} onClick={()=>{setEditing(false);setError(undefined);}}>{changed?'Discard edit & reload suggestion':'Cancel visual edit'}</button>
  </>:<>
   <button disabled={busy||stale} onClick={()=>void decide('correct')}>Correct</button>
   <button disabled={busy||stale} onClick={()=>void decide('wrong')}>Wrong</button>
   <button disabled={busy||stale} onClick={()=>{setBase(direction);setValue(direction.review?.value??direction.suggestion.creative_direction);setEditing(true);setSaved('');}}>Edit</button>
  </>}</div>}
 </article>;
}
