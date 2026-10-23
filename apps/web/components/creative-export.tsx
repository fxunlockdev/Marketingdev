"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {VideoRequest} from './video-canvas';
import {api} from './api';
import {Notice} from './primitives';
type SavedImage={id:string;sha256:string;source_sha256:string;renderer_image:string;manifest:{warnings?:string[]}};
type ExportState={configured:boolean;renderer_image:string|null;exports:SavedImage[];jobs:{id:string;status:string;cancel_requested:boolean;error_code:string|null}[];approvals:{id:string;export_id:string;context_type:string;context_id:string;context_revision:number}[]};
type Props={threadId?:string;business:{id:string;role:string};versionId:string;sourceSHA:string;context:{type:'canvas'|'slot';id:string;revision:number;state:string};disabled:boolean;onApproved:()=>Promise<void>};
const active=(s:string)=>['queued','running','retrying'].includes(s);
export function CreativeExportPanel({threadId,business,versionId,sourceSHA,context,disabled,onApproved}:Props){
 const root=`/api/v1/businesses/${business.id}`,labelId=useId();
 const [state,setState]=useState<ExportState>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[preview,setPreview]=useState(''),[loaded,setLoaded]=useState(false);
 const requestKey=useRef<string|null>(null),[previewRetry,setPreviewRetry]=useState(0);
 const load=useCallback(async()=>{setState(await api(`${root}/creative-versions/${versionId}/exports`));},[root,versionId]);
 useEffect(()=>{setState(undefined);setError(undefined);requestKey.current=null;void load().catch(setError);},[load]);
 const saved=state?.exports.find(e=>e.renderer_image===state.renderer_image&&e.source_sha256===sourceSHA),job=state?.jobs.find(j=>active(j.status)),latestJob=state?.jobs[0];
 useEffect(()=>{if(!job)return;const timer=setInterval(()=>void load().catch(setError),2000);return()=>clearInterval(timer);},[job?.id,load]);
 useEffect(()=>{setConfirmed(false);},[versionId,sourceSHA,context.id,context.revision,saved?.id,disabled]);
 useEffect(()=>{
  setPreview('');setLoaded(false);let canceled=false,url='';const controller=new AbortController();
  if(saved)void(async()=>{
   const grant=await api(`${root}/creative-exports/${saved.id}/download`);
   const response=await fetch(grant.url,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw new Error('Could not load the saved image. Reload and try again.');
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>20*1024*1024||bytes.byteLength!==grant.bytes)throw new Error('The saved image failed its integrity check.');
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(sha!==saved.sha256||sha!==grant.sha256)throw new Error('The saved image failed its integrity check.');
   if(!canceled){url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));setPreview(url);}
  })().catch(e=>{if(!canceled)setError(e);});
  return()=>{canceled=true;controller.abort();if(url)URL.revokeObjectURL(url);};
 },[root,saved?.id,saved?.sha256,previewRetry]);
 const approved=!!saved&&state?.approvals.some(a=>a.export_id===saved.id&&a.context_type===context.type&&a.context_id===context.id&&a.context_revision===context.revision);
 const reviewable=['in_review','pending_review','approved'].includes(context.state),writer=['owner','admin','editor'].includes(business.role),reviewer=['owner','admin','reviewer'].includes(business.role);
 async function act(action:()=>Promise<unknown>){setBusy(true);setError(undefined);try{await action();await load();}catch(e){setError(e);}finally{setBusy(false);}}
 async function create(){requestKey.current??=crypto.randomUUID();await api(`${root}/creative-versions/${versionId}/exports`,{source_sha256:sourceSHA},'POST',requestKey.current);requestKey.current=null;}
 return <section className="creative-review final-image-review" aria-labelledby={labelId} aria-busy={busy}>
  <h3 id={labelId}>Final image</h3>
  <p>Save the finished image, check its text and layout, then approve exactly what will be published.</p>
  {error!==undefined&&<Notice error={error}/>}
  {!state&&<p role="status">Loading saved image…</p>}
  {state&&!state.configured&&<p>Final-image export is not configured yet.</p>}
  {disabled&&<p>Save your changes and open the latest version before exporting or approving.</p>}
  {saved&&<>
   {preview?<img src={preview} alt="Saved final image for approval" className="final-image-preview" onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError(new Error('The saved image could not be displayed.'));}}/>:<p role="status">Loading the saved image for review…</p>}
   {!!saved.manifest.warnings?.length&&<details><summary>Check the rendered fonts</summary><ul>{saved.manifest.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
   {preview&&loaded&&<p><a href={preview} download="desvio-final.png">Download final image</a></p>}
   {approved&&!disabled?<><p role="status">Final image approved for this {context.type==='slot'?'post':'creative version'}.</p>{context.type==='slot'&&<a href={`/b/${business.id}/publishing?slot=${context.id}`}>Review publishing options →</a>}</>:<>
    {!reviewable&&<p>Send this {context.type==='slot'?'post':'version'} for review before final approval.</p>}
    {reviewer&&reviewable&&<><label className="check-row"><input type="checkbox" checked={confirmed} disabled={busy||disabled||!loaded} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this saved image and its text.</label><button className="primary" disabled={busy||disabled||!loaded||!confirmed} onClick={()=>void act(async()=>{await api(`${root}/creative-exports/${saved.id}/approve`,{sha256:saved.sha256,source_sha256:sourceSHA,context_type:context.type,context_id:context.id,context_revision:context.revision,confirmed:true});setConfirmed(false);await onApproved();})}>Approve final image</button></>}
   </>}
  </>}
  {approved&&!disabled&&saved&&threadId&&context.type==='canvas'&&<VideoRequest business={business} threadId={threadId} reference={{export_id:saved.id,approval_id:state!.approvals.find(a=>a.export_id===saved.id&&a.context_type==='canvas'&&a.context_id===context.id&&a.context_revision===context.revision)!.id,source_sha256:sourceSHA,export_sha256:saved.sha256}}/>}
  {job&&<div role="status"><p>{job.cancel_requested?'Canceling export…':job.status==='queued'?'Final image queued…':'Preparing final image…'}</p>{writer&&<button disabled={busy||job.cancel_requested} onClick={()=>void act(()=>api(`${root}/export-jobs/${job.id}/cancel`,{}))}>Cancel export</button>}</div>}
  {!saved&&!job&&state?.configured&&writer&&<>
   {latestJob&&['failed','rejected'].includes(latestJob.status)&&<p role="alert">{latestJob.error_code==='EXPORT_TEXT_OVERFLOW'?'Some text extends beyond the image. Move or resize it, save, and try again.':'The export could not finish. Your creative is still saved. You can try again.'}</p>}
   {latestJob?.status==='canceled'&&<p>Export canceled. Your creative is still saved.</p>}
   <button disabled={busy||disabled} onClick={()=>void act(create)}>Prepare final image</button>
  </>}
  {error!==undefined&&<button disabled={busy} onClick={()=>void act(async()=>{await load();setPreviewRetry(n=>n+1);})}>Reload export status</button>}
 </section>;
}
