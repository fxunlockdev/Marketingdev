"use client";
import {useEffect,useRef,useState} from 'react';
import {ActionButton} from './design-system';
import {api} from './api';
import {loadPrivateImage} from './load-private-image';
import {Notice} from './primitives';
import {keyframeRequest,keyframeReference,type GeneratedVideoReference,type KeyframeAspect} from '../../api/src/reel-keyframe';
import './video-keyframe.css';

type Frame={versionId:string;sha256:string;revision:number;status:string;mediaId:string};
type Stage='idle'|'creating'|'ready'|'approving'|'approved';
interface VideoKeyframeProps{businessId:string;prompt:string;channel:string;aspect:KeyframeAspect;canApprove:boolean;disabled?:boolean;onSelect:(reference:GeneratedVideoReference&{label:string})=>void}
const POLL_MS=2500,LIMIT=480;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** "Create a starting frame": the image engine makes a still at the video's aspect, the owner approves it,
 * and its full-size PNG export (with its approval) becomes the video's first frame. Uploads still work. */
export function VideoKeyframe({businessId,prompt,channel,aspect,canApprove,disabled=false,onSelect}:VideoKeyframeProps){
 const root=`/api/v1/businesses/${businessId}`;
 const [stage,setStage]=useState<Stage>('idle'),[frame,setFrame]=useState<Frame|null>(null),[error,setError]=useState<unknown>(),[thread,setThread]=useState<string|null>(null);
 const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);

 async function generated(threadId:string,jobId:string):Promise<Frame>{
  for(let i=0;i<LIMIT&&live.current;i++){
   const state=await api(`${root}/canvas/threads/${threadId}`);
   const run=state.runs.find((r:{id:string})=>r.id===jobId);
   if(run?.status==='succeeded'&&run.output_version_id){
    const project=await api(`${root}/creative-projects/${run.project_id}`),version=project.versions.find((v:{id:string})=>v.id===run.output_version_id);
    return {versionId:version.id,sha256:version.sha256,revision:version.review_revision,status:version.status,mediaId:version.media_id};
   }
   if(run&&['failed','rejected','canceled','unknown'].includes(run.status))throw new Error(run.status==='unknown'?'The image request is uncertain; check it in Create before trying again.':'The starting frame could not be created. Try again.');
   await wait(POLL_MS);
  }
  throw new Error('Still creating the starting frame. It will appear in Create when ready.');
 }
 async function create(){
  setError(undefined);setStage('creating');setFrame(null);
  try{
   const request=keyframeRequest({prompt,channel,aspect});
   const threadId=thread??(await api(`${root}/canvas/threads`,{title:'Video starting frame'},'POST',`keyframe-thread:${crypto.randomUUID()}`)).id;
   setThread(threadId);
   const job=await api(`${root}/canvas/threads/${threadId}/messages`,{...request,text_provider:'openai'},'POST',`keyframe:${crypto.randomUUID()}`);
   const made=await generated(threadId,job.id);
   if(live.current){setFrame(made);setStage('ready');}
  }catch(e){if(live.current){setError(e);setStage('idle');}}
 }
 async function exported(versionId:string,sha256:string){
  for(let i=0;i<LIMIT&&live.current;i++){
   const state=await api(`${root}/creative-versions/${versionId}/exports`);
   const saved=state.exports.find((e:{format:string;renderer_image:string;source_sha256:string})=>e.format==='png'&&e.renderer_image===state.renderer_image&&e.source_sha256===sha256);
   if(saved)return {state,saved};
   await wait(POLL_MS);
  }
  throw new Error('The full-size frame is still being prepared. Try approving again shortly.');
 }
 async function approve(){
  if(!frame)return;
  setError(undefined);setStage('approving');
  try{
   let revision=frame.revision;
   if(['draft','changes_requested'].includes(frame.status)){const reviewed=await api(`${root}/creative-versions/${frame.versionId}/review`,{decision:'in_review',feedback:'Starting frame for a video',revision},'POST');revision=reviewed.revision??revision+1;}
   await api(`${root}/creative-versions/${frame.versionId}/exports`,{source_sha256:frame.sha256},'POST',`keyframe-export:${frame.versionId}`);
   let {state,saved}=await exported(frame.versionId,frame.sha256);
   if(!keyframeReference(state,frame.versionId)){
    await api(`${root}/creative-exports/${saved.id}/approve`,{sha256:saved.sha256,source_sha256:frame.sha256,context_type:'canvas',context_id:frame.versionId,context_revision:revision,confirmed:true},'POST');
    state=await api(`${root}/creative-versions/${frame.versionId}/exports`);
   }
   const reference=keyframeReference(state,frame.versionId);
   if(!reference)throw new Error('Approve the starting frame again; its approval was not saved.');
   if(live.current){setStage('approved');onSelect({...reference,label:'Created starting frame'});}
  }catch(e){if(live.current){setError(e);setStage('ready');}}
 }
 const busy=stage==='creating'||stage==='approving';
 return <section className="video-keyframe" aria-label="Create a starting frame">
  <Notice error={error}/>
  {stage==='idle'&&<ActionButton type="button" disabled={disabled||!prompt.trim()} onClick={()=>void create()} label="Create a starting frame"/>}
  {stage==='creating'&&<p role="status" className="video-keyframe-status">Creating your starting frame with your brand direction…</p>}
  {frame&&<figure className={`video-keyframe-frame aspect-${aspect}`}>
   <FramePreview root={root} mediaId={frame.mediaId}/>
   <figcaption>{stage==='approved'?'Approved. This frame opens your video.':'Check the frame. Your video starts from exactly this image.'}</figcaption>
  </figure>}
  {frame&&stage!=='approved'&&<div className="video-keyframe-actions">
   {canApprove?<ActionButton type="button" variant="primary" isLoading={stage==='approving'} disabled={busy||disabled} onClick={()=>void approve()} label={stage==='approving'?'Approving frame…':'Use this starting frame'}/>:<p className="hint">An owner or admin approves the starting frame.</p>}
   <ActionButton type="button" disabled={busy||disabled} onClick={()=>void create()} label="Try another frame"/>
  </div>}
 </section>;
}

/** The frame exactly as stored, loaded through an authenticated grant into a blob URL. A signed storage URL is
 * never used as an image source: the page's content security policy allows images from this origin only. */
function FramePreview({root,mediaId}:{root:string;mediaId:string}){
 const [url,setUrl]=useState(''),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let objectURL='';
  setUrl('');setFailed(false);
  loadPrivateImage(`${root}/creative-media/${mediaId}`,controller.signal).then(blob=>{
   if(controller.signal.aborted)return;
   objectURL=URL.createObjectURL(blob);setUrl(objectURL);
  }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>{controller.abort();if(objectURL)URL.revokeObjectURL(objectURL);};
 },[root,mediaId,attempt]);
 if(failed)return <span role="alert">Preview unavailable <button type="button" onClick={()=>setAttempt(n=>n+1)}>Try again</button></span>;
 return url?<img src={url} alt="Created starting frame for the video"/>:<span role="status">Loading your starting frame…</span>;
}
