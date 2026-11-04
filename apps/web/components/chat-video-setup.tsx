"use client";
import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {Notice} from './primitives';
import {PrivateVisual} from './private-visual';
import {BrandReferences} from './brand-references';
import {CampaignVideoReference,type GeneratedVideoReference} from './campaign-video-reference';
import {useUnsavedChanges} from './unsaved';

type Business={id:string;name:string;role:string;organization_id?:string};
type Reference=GeneratedVideoReference|{brand_reference_id:string;source_sha256:string;label?:string};
/** The choice commits the reference, duration and existing brief together. A lost
 * response holds the exact request for retry; polling recovers an accepted job. */
export function ChatVideoSetup({business,threadId,turn,onSubmitted}:{business:Business;threadId:string;turn:any;onSubmitted:()=>void}){
 const [references,setReferences]=useState<any[]>(),[duration,setDuration]=useState(turn.output.duration_seconds??5),[library,setLibrary]=useState(false),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[error,setError]=useState<unknown>();
 const pending=useRef<{key:string;body:any}|null>(null),locked=useRef(false);
 const writable=['owner','admin','editor'].includes(business.role),root=`/api/v1/businesses/${business.id}`;
 useUnsavedChanges(busy||!!pending.current);
 useEffect(()=>{let live=true;void api(root+'/canvas/references').then(v=>{if(live){setReferences(v.references.filter((r:any)=>r.kind==='upload'&&!r.crop&&r.width>=64&&r.height>=64));setError(undefined);}}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[root,reload]);
 async function choose(reference?:Reference){
  if(locked.current||submitted||!writable)return;
  if(!pending.current){if(!reference)return;const placement=turn.output.placement??'feed';pending.current={key:`chat-video:${turn.id}`,body:{prompt:turn.output.prompt,channel:turn.output.channel,text_provider:'openai',duration_seconds:duration,creative_spec:{placement,aspect:placement!=='feed'?'vertical':turn.output.size==='1024x1024'?'square':turn.output.size==='1024x1536'?'portrait':'landscape',slide_count:null},reference:{...('brand_reference_id' in reference?{brand_reference_id:reference.brand_reference_id,source_sha256:reference.source_sha256}:reference),confirmed:true}}};}
  locked.current=true;setBusy(true);setError(undefined);
  try{await api(`${root}/canvas/threads/${threadId}/videos`,pending.current.body,'POST',pending.current.key);pending.current=null;setSubmitted(true);setLibrary(false);onSubmitted();}
  catch(e){setError(e);if(e instanceof ApiError&&e.status>=400&&e.status<500&&![408,429].includes(e.status))pending.current=null;}
  finally{locked.current=false;setBusy(false);}
 }
 return <div className="chat-video-setup">
  <div className="create-message assistant"><span className="create-avatar" aria-hidden="true">d.</span><p>Which image should we bring to life? Choose an approved photo, or upload one below. I’ll use your idea to prepare the script.</p></div>
  <div className="chat-video-answer-card">
   <p>I’ll prepare a <strong>{duration}-second</strong> video. You can adjust the length before choosing your image.</p>
   <div className="chat-video-lengths" role="group" aria-label="Video length (seconds)">{[...new Set([3,5,10,15,duration])].sort((a,b)=>a-b).map(n=><button type="button" key={n} aria-pressed={duration===n} disabled={busy||submitted||!!pending.current||!writable} onClick={()=>setDuration(n)}>{n}s</button>)}</div>
   <Notice error={error}/>
   {pending.current&&!busy&&<button type="button" onClick={()=>void choose()}>Retry saved video setup</button>}
   {references===undefined?<p role="status">Loading your approved images…</p>:references.length?<div className="chat-video-reference-grid">{references.map(r=><button className="chat-video-reference" type="button" key={r.id} disabled={busy||submitted||!!pending.current||!writable} aria-label={`Use ${r.label} for video`} onClick={()=>void choose({brand_reference_id:r.id,source_sha256:r.sha256})}><PrivateVisual autoLoad presentation businessId={business.id} visualId={r.visual_id} label={`Preview ${r.label}`} alt={r.label}/><span>{r.label}</span></button>)}</div>:<p>No approved starting images yet. Upload a photo to get started.</p>}
   {references===undefined&&!!error&&<button type="button" onClick={()=>setReload(n=>n+1)}>Reload starting images</button>}
   {!busy&&!submitted&&!pending.current&&<CampaignVideoReference businessId={business.id} onSelect={r=>void choose(r)}/>}
   <button type="button" disabled={busy||submitted||!!pending.current||!writable} onClick={()=>setLibrary(true)}>Upload or approve another image</button>
   <p className="hint">Choosing an image saves your setup and prepares a script. You’ll approve it here before video generation starts.</p>
   {(busy||submitted)&&<p role="status">Saving your image choice and preparing the script…</p>}
  </div>
  {library&&<VideoImageDialog onClose={()=>{if(!busy){setLibrary(false);setReload(n=>n+1);}}}><Notice error={error}/>{pending.current&&!busy&&<button type="button" onClick={()=>void choose()}>Retry saved video setup</button>}<BrandReferences businessId={business.id} writable={writable} visualPicker uploadWorkspace={business.organization_id?{id:business.organization_id,name:business.name,role:business.role}:undefined} onVideo={r=>void choose(r)} disabled={busy||submitted||!!pending.current}/></VideoImageDialog>}
 </div>;
}
function VideoImageDialog({onClose,children}:{onClose:()=>void;children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="conversation-history chat-video-image-dialog" aria-label="Choose a video image" onCancel={e=>{e.preventDefault();onClose();}}><header><h2>Choose your starting image</h2><button type="button" aria-label="Close image picker" onClick={onClose}>×</button></header>{children}</dialog>;
}
