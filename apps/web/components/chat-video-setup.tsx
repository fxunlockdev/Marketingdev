"use client";
import {useEffect,useId,useRef,useState} from 'react';
import './chat-video-prompt.css';
import {api,ApiError} from './api';
import {Notice} from './primitives';
import {PrivateVisual} from './private-visual';
import {BrandReferences} from './brand-references';
import {CampaignVideoReference,type GeneratedVideoReference} from './campaign-video-reference';
import {useUnsavedChanges} from './unsaved';

type Business={id:string;name:string;role:string;organization_id?:string};
type Reference=GeneratedVideoReference|{brand_reference_id:string;source_sha256:string;label?:string};
/** Generate commits the reference, duration and existing brief together. A lost
 * response holds the exact request for retry; polling recovers an accepted job. */
export function ChatVideoSetup({business,threadId,turn,onSubmitted}:{business:Business;threadId:string;turn:any;onSubmitted:()=>void}){
 const [references,setReferences]=useState<any[]>(),[duration,setDuration]=useState(turn.output.duration_seconds??5),[library,setLibrary]=useState(false),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[error,setError]=useState<unknown>();
 const [selected,setSelected]=useState<Reference|null>(null);
 const initialPrompt=String(turn.output.prompt??'').replace(/\u2014/g,', ');
 const [prompt,setPrompt]=useState(initialPrompt);
 const promptId=useId(),promptValid=!!prompt.trim()&&prompt.length<=3800;
 const canGenerate=['owner','admin'].includes(business.role);
 const pending=useRef<{key:string;body:any}|null>(null),locked=useRef(false);
 const writable=['owner','admin','editor'].includes(business.role),root=`/api/v1/businesses/${business.id}`;
 useUnsavedChanges(busy||!!pending.current||(!submitted&&prompt!==initialPrompt));
 useEffect(()=>{let live=true;void api(root+'/canvas/references').then(v=>{if(live){setReferences(v.references.filter((r:any)=>r.kind==='upload'&&!r.crop&&r.width>=64&&r.height>=64));setError(undefined);}}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[root,reload]);
 async function choose(reference?:Reference){
  if(locked.current||submitted||!writable)return;
  if(!pending.current){if(!reference||!promptValid)return;const placement=turn.output.placement??'feed';pending.current={key:`chat-video:${turn.id}`,body:{generate:canGenerate,prompt:prompt.trim(),channel:turn.output.channel,text_provider:'openai',duration_seconds:duration,creative_spec:{placement,aspect:placement!=='feed'?'vertical':turn.output.size==='1024x1024'?'square':turn.output.size==='1024x1536'?'portrait':'landscape',slide_count:null},reference:{...('brand_reference_id' in reference?{brand_reference_id:reference.brand_reference_id,source_sha256:reference.source_sha256}:reference),confirmed:true}}};}
  locked.current=true;setBusy(true);setError(undefined);
  try{await api(`${root}/canvas/threads/${threadId}/videos`,pending.current.body,'POST',pending.current.key);pending.current=null;setSubmitted(true);setLibrary(false);onSubmitted();}
  catch(e){setError(e);if(e instanceof ApiError&&e.status>=400&&e.status<500&&![408,429].includes(e.status))pending.current=null;}
  finally{locked.current=false;setBusy(false);}
 }
 function select(reference:Reference){setSelected(reference);setLibrary(false);setReload(n=>n+1);}
 return <div className="chat-video-setup">
  <div className="chat-video-quick-create">
   <p>Choose a starting image.</p>
   <Notice error={error}/>
   {pending.current&&!busy&&<button type="button" onClick={()=>void choose()}>Retry saved video setup</button>}
   {references===undefined?<p role="status">Loading images…</p>:<div className="chat-video-image-strip" role="group" aria-label="Starting image">{references.map(r=><button className="chat-video-reference" type="button" key={r.id} disabled={busy||submitted||!!pending.current||!writable} aria-pressed={!!selected&&'brand_reference_id' in selected&&selected.brand_reference_id===r.id} aria-label={`Use ${r.label} for video`} title={r.label} onClick={()=>select({brand_reference_id:r.id,source_sha256:r.sha256,label:r.label})}><PrivateVisual autoLoad presentation businessId={business.id} visualId={r.visual_id} label={`Preview ${r.label}`} alt={r.label}/></button>)}</div>}
   {references===undefined&&!!error&&<button type="button" onClick={()=>setReload(n=>n+1)}>Reload starting images</button>}
   <div className="chat-video-quick-actions"><button type="button" disabled={busy||submitted||!!pending.current||!writable} onClick={()=>setLibrary(true)}>Choose or upload image</button><span>{duration}s · {turn.output.placement==='reel'?'Reel':'Video'}</span></div>
   {selected&&<p className="hint" role="status">{('label' in selected&&selected.label)||'Image selected'}</p>}
   <details className="chat-video-options"><summary>Options</summary><div className="chat-video-lengths" role="group" aria-label="Video length (seconds)">{[...new Set([3,5,10,15,duration])].sort((a,b)=>a-b).map(n=><button type="button" key={n} aria-pressed={duration===n} disabled={busy||submitted||!!pending.current||!writable} onClick={()=>setDuration(n)}>{n}s</button>)}</div></details>
   {selected&&<div className="chat-video-prompt-box">
    <label htmlFor={promptId}>Your video prompt</label>
    <p id={promptId+'-help'}>Review the direction below. You can edit it before generating.</p>
    <textarea id={promptId} aria-describedby={promptId+'-help'} value={prompt} rows={5} maxLength={3800} disabled={busy||submitted||!!pending.current||!writable} onChange={e=>setPrompt(e.target.value)}/>
    {prompt.length>3800&&<p role="alert">Please shorten the prompt to 3,800 characters.</p>}
   </div>}
   <button className="chat-video-generate" type="button" disabled={!selected||!promptValid||busy||submitted||!!pending.current||!writable} onClick={()=>void choose(selected!)}>{busy||submitted?'Starting your video…':canGenerate?'Generate video':'Prepare for review'}</button>
   <p className="hint">{canGenerate?'Uses the prompt above, your image, brand context and creative skills. Generation credits apply.':'An owner or admin will approve generation.'}</p>
  </div>
  {library&&<VideoImageDialog onClose={()=>{setLibrary(false);setReload(n=>n+1);}}><CampaignVideoReference businessId={business.id} onSelect={select}/><BrandReferences businessId={business.id} writable={writable} visualPicker uploadWorkspace={business.organization_id?{id:business.organization_id,name:business.name,role:business.role}:undefined} onVideo={select} disabled={busy||submitted||!!pending.current}/></VideoImageDialog>}
 </div>;
}
function VideoImageDialog({onClose,children}:{onClose:()=>void;children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="conversation-history chat-video-image-dialog" aria-label="Choose a video image" onCancel={e=>{e.preventDefault();onClose();}}><header><h2>Choose your starting image</h2><button type="button" aria-label="Close image picker" onClick={onClose}>×</button></header>{children}</dialog>;
}
