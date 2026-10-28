"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import {VideoReview} from './video-canvas';
import {CarouselImage} from './carousels';
const ready=()=>{};
/** Load original saved media only when the user opens its preview. */
export function CampaignMediaPreview({business,post}:{business:{id:string;role:string};post:any}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[pages,setPages]=useState<any[]>(),[index,setIndex]=useState(0),[error,setError]=useState<unknown>();
 useEffect(()=>{if(open)dialog.current?.showModal();else if(dialog.current?.open)dialog.current.close();},[open]);
 useEffect(()=>{let active=true;if(!open||!post.carousel_version_id)return;setPages(undefined);setIndex(0);setError(undefined);void api(`/api/v1/businesses/${business.id}/carousels/${post.project_id}`).then(result=>{if(!active)return;const version=result.versions.find((v:any)=>v.id===post.carousel_version_id);if(!version?.pages?.length)throw new Error('Saved carousel preview is unavailable');setPages([...version.pages].sort((a,b)=>a.position-b.position));}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[open,business.id,post.project_id,post.carousel_version_id]);
 if(!post.video_version_id&&!post.carousel_version_id)return null;
 return <section aria-label="Saved post preview"><button ref={trigger} type="button" aria-haspopup="dialog" onClick={()=>setOpen(true)}>{post.video_version_id?'Play video':'Preview slides'}</button><dialog ref={dialog} className="campaign-media-dialog" aria-label={post.video_version_id?'Video preview':'Carousel preview'} onClose={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});}}><header><strong>{post.video_version_id?'Video preview':'Carousel preview'}</strong><button type="button" autoFocus onClick={()=>dialog.current?.close()}>Close preview</button></header>{open&&<><Notice error={error}/>{post.video_version_id?<VideoReview business={business} id={post.video_version_id} previewOnly/>:pages?<><CarouselImage key={pages[index].export_id} businessId={business.id} page={pages[index]} onReady={ready}/><div className="actions"><button type="button" aria-label="Previous slide" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>←</button><span aria-live="polite">{index+1} of {pages.length}</span><button type="button" aria-label="Next slide" disabled={index===pages.length-1} onClick={()=>setIndex(i=>i+1)}>→</button></div></>:!error&&<p role="status">Loading slides…</p>}</>}</dialog></section>;
}
