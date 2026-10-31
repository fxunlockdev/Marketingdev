"use client";
import {memo,useEffect,useRef,useState} from 'react';
import {CreativeEditor,type Design} from './creative-editor';

type SavedImage={id:string;project_id:string;design:Design;created_at:string;version_number:number};
const noop=()=>{};
// Immutable version IDs keep polling from repainting saved artwork. Release offscreen
// canvases so a long conversation does not retain hundreds of full-size image buffers.
export const SavedChatImage=memo(function SavedChatImage({businessId,image}:{businessId:string;image:SavedImage}){
 const host=useRef<HTMLElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'300px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 return <figure ref={host} className="conversation-saved-image" aria-label={`Saved image · Version ${image.version_number}`} data-version-id={image.id}>
   <figcaption><strong>Changes saved</strong><span>Version {image.version_number} · Saved to this conversation</span></figcaption>
   <div className="conversation-saved-preview" style={{aspectRatio:`${image.design.width} / ${image.design.height}`}}>
    {visible&&<CreativeEditor businessId={businessId} design={image.design} onChange={noop} onExportReady={noop} readOnly previewOnly/>}
   </div>
 </figure>;
},(previous,next)=>previous.businessId===next.businessId&&previous.image.id===next.image.id);
