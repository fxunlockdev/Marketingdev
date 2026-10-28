"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {creativeDimensions} from '../../api/src/campaign-formats';
export function PostThumbnail({businessId,post}:{businessId:string;post:any}){
 const host=useRef<HTMLSpanElement>(null),[url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 const dimensions=post.design??(post.creative_spec?creativeDimensions(post.creative_spec):null);
 const design=post.design,media=design?.background_media_id,video=post.video_version_id,carousel=post.carousel_version_id,project=post.project_id,exportId=post.export_id??post.slides?.[0]?.export_id;
 useEffect(()=>{
  setUrl('');setFailed(false);if(!media&&!video&&!carousel&&!exportId)return;
  let active=true,objectUrl='';const controller=new AbortController(),root=`/api/v1/businesses/${businessId}`;
  const observer=new IntersectionObserver(entries=>{
   if(!entries.some(e=>e.isIntersecting))return;observer.disconnect();
   void(async()=>{
    let endpoint=media?`${root}/creative-media/${media}`:'';
    if(exportId)endpoint=`${root}/creative-exports/${exportId}/download`;
    else if(video)endpoint=`${root}/video-versions/${video}/poster`;
    else if(carousel){
     if(!project)throw new Error('Carousel preview unavailable');
     const result=await api(`${root}/carousels/${project}`);
     if(!active)return;
     const version=result.versions.find((v:any)=>v.id===carousel),cover=version?.pages?.find((p:any)=>p.position===0);
     if(!cover)throw new Error('Carousel preview unavailable');
     endpoint=`${root}/creative-exports/${cover.export_id}/download`;
    }
    const grant=await api(endpoint);if(!active)return;
    const response=await fetch(grant.url,{credentials:'omit',cache:'no-store',signal:controller.signal});
    const mime=response.headers.get('content-type')?.split(';')[0];
    if(!response.ok||!['image/png','image/jpeg'].includes(mime??'')||!response.body)throw new Error('Preview unavailable');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(video?2:20)*1024*1024)throw new Error('Preview too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(!active)return;
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(grant.bytes!==undefined&&Number(grant.bytes)!==size)throw new Error('Preview integrity check failed');
    if(grant.sha256){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==grant.sha256)throw new Error('Preview integrity check failed');}
    if(!active)return;objectUrl=URL.createObjectURL(new Blob([bytes],{type:mime}));setUrl(objectUrl);
   })().catch(()=>{if(active)setFailed(true);});
  },{rootMargin:'100px'});
  if(host.current)observer.observe(host.current);
  return()=>{active=false;controller.abort();observer.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[businessId,media,video,carousel,project,exportId]);

 return <span ref={host} className="post-thumbnail" style={dimensions?{aspectRatio:`${dimensions.width} / ${dimensions.height}`}:undefined} aria-hidden="true">{url?(video||carousel||exportId?<img src={url} alt="" className="post-cover" onError={()=>{setUrl('');setFailed(true);}}/>:design?<svg viewBox={`0 0 ${design.width} ${design.height}`}><image href={url} width={design.width} height={design.height}/>{design.layers?.map((l:any)=><foreignObject key={l.id} x={l.x-(l.backing?.padding??0)} y={l.y-(l.backing?.padding??0)} width={l.width+2*(l.backing?.padding??0)} height={design.height-l.y+(l.backing?.padding??0)}><div style={{fontFamily:l.fontFamily,fontSize:l.fontSize,fontWeight:l.fontWeight??400,boxSizing:'border-box',padding:l.backing?.padding??0,background:l.text.trim()&&l.backing?`${l.backing.fill}${Math.round(l.backing.opacity*255).toString(16).padStart(2,'0')}`:undefined,color:l.fill,textAlign:l.align,whiteSpace:'pre-wrap',lineHeight:1.16}}>{l.text}</div></foreignObject>)}</svg>:null):<><span className="post-format-mark">{post.format==='video'?'▷':'▧'}</span><span>{failed?'Preview unavailable':media||video||carousel||exportId?'Loading preview…':post.format==='video'?'Video storyline':post.format==='carousel'?'Carousel':'Image idea'}</span></>}</span>;
}
