"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import {PostThumbnail} from './post-thumbnail';
export type GeneratedVideoReference={export_id:string;approval_id:string;source_sha256:string;export_sha256:string};
export function CampaignVideoReference({businessId,onSelect}:{businessId:string;onSelect:(reference:GeneratedVideoReference)=>void}){
 const [images,setImages]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>{let live=true;api(`/api/v1/businesses/${businessId}/carousels`).then(v=>{if(live)setImages(v.candidates??[]);}).catch(setError);return()=>{live=false;};},[businessId]);
 async function choose(image:any){setBusy(true);setError(undefined);try{const state=await api(`/api/v1/businesses/${businessId}/creative-versions/${image.creative_version_id}/exports`),saved=state.exports.find((e:any)=>e.id===image.export_id&&e.format==='png'&&e.renderer_image===state.renderer_image),approval=state.approvals.find((a:any)=>a.export_id===saved?.id&&a.context_type==='canvas'&&a.context_id===image.creative_version_id);if(!saved||!approval)throw new Error('Open this image and approve its final PNG before using it for a video.');onSelect({export_id:saved.id,approval_id:approval.id,source_sha256:saved.source_sha256,export_sha256:saved.sha256});}catch(e){setError(e);}finally{setBusy(false);}}
 return <details><summary>Use a generated image</summary><Notice error={error}/>{images.length?<div className="campaign-video-reference-grid">{images.map(image=><article key={image.export_id}><PostThumbnail businessId={businessId} post={image}/><p>{image.title}</p><button type="button" disabled={busy} onClick={()=>void choose(image)}>Use for video</button><a href={`/b/${businessId}/campaign-post?thread=${image.thread_id}&project=${image.project_id}`}>Open image</a></article>)}</div>:<p>Finished images appear here after their PNG export is ready.</p>}</details>;
}
