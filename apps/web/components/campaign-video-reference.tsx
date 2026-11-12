"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import {PostThumbnail} from './post-thumbnail';
import {VideoKeyframe} from './video-keyframe';
import type {KeyframeAspect} from '../../api/src/reel-keyframe';
export type GeneratedVideoReference={export_id:string;approval_id:string;source_sha256:string;export_sha256:string};
type SlotFrame={prompt:string;channel:string;aspect:KeyframeAspect;canApprove:boolean;writable:boolean};
/** The planned video post on this page (?slot=), so a starting frame can be created for it. */
function useSlotFrame(businessId:string,slotId?:string):SlotFrame|null{
 const [frame,setFrame]=useState<SlotFrame|null>(null);
 useEffect(()=>{let live=true;const id=slotId??new URLSearchParams(location.search).get('slot');if(!id)return;
  void Promise.all([api(`/api/v1/businesses/${businessId}/content-slots/${id}`),api(`/api/v1/businesses/${businessId}`)]).then(([v,b])=>{
   if(!live||v.slot?.format!=='video')return;const role=String(b.role??'');
   setFrame({prompt:v.slot.video_draft?.prompt??v.slot.brief,channel:v.slot.channel,aspect:(v.slot.creative_spec?.aspect??'vertical') as KeyframeAspect,canApprove:['owner','admin'].includes(role),writable:['owner','admin','editor'].includes(role)});
  }).catch(()=>{});return()=>{live=false;};},[businessId,slotId]);
 return frame;
}
export function CampaignVideoReference({businessId,onSelect,slotId}:{businessId:string;onSelect:(reference:GeneratedVideoReference)=>void;slotId?:string}){
 const slotFrame=useSlotFrame(businessId,slotId);
 const [images,setImages]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>{let live=true;api(`/api/v1/businesses/${businessId}/carousels`).then(v=>{if(live)setImages(v.candidates??[]);}).catch(setError);return()=>{live=false;};},[businessId]);
 async function choose(image:any){setBusy(true);setError(undefined);try{const state=await api(`/api/v1/businesses/${businessId}/creative-versions/${image.creative_version_id}/exports`),saved=state.exports.find((e:any)=>e.id===image.export_id&&e.format==='png'&&e.renderer_image===state.renderer_image),approval=state.approvals.find((a:any)=>a.export_id===saved?.id&&a.context_type==='canvas'&&a.context_id===image.creative_version_id);if(!saved||!approval)throw new Error('Open this image and approve its final PNG before using it for a video.');onSelect({export_id:saved.id,approval_id:approval.id,source_sha256:saved.source_sha256,export_sha256:saved.sha256});}catch(e){setError(e);}finally{setBusy(false);}}
 return <>{slotFrame&&<VideoKeyframe businessId={businessId} prompt={slotFrame.prompt} channel={slotFrame.channel} aspect={slotFrame.aspect} canApprove={slotFrame.canApprove} disabled={!slotFrame.writable} onSelect={({label:_label,...reference})=>onSelect(reference)}/>}<details><summary>Use a generated image</summary><Notice error={error}/>{images.length?<div className="campaign-video-reference-grid">{images.map(image=><article key={image.export_id}><PostThumbnail businessId={businessId} post={image}/><p>{image.title}</p><button type="button" disabled={busy} onClick={()=>void choose(image)}>Use for video</button><a href={`/b/${businessId}/campaign-post?thread=${image.thread_id}&project=${image.project_id}`}>Open image</a></article>)}</div>:<p>Finished images appear here after their PNG export is ready.</p>}</details></>;
}
