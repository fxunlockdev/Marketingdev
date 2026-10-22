"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';

export function PrivateVisual({businessId,visualId,label,alt}:{businessId:string;visualId:string;label:string;alt:string}){
 const [preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const current=useRef<{controller?:AbortController;url?:string}>({});
 useEffect(()=>{setPreview('');setBusy(false);setError(undefined);return()=>{current.current.controller?.abort();if(current.current.url)URL.revokeObjectURL(current.current.url);current.current={};};},[businessId,visualId]);
 async function load(){
  current.current.controller?.abort();
  const controller=new AbortController();current.current.controller=controller;
  setBusy(true);setError(undefined);
  try{
   const grant=await api<{url:string;bytes:number;sha256:string}>(`/api/v1/businesses/${businessId}/visuals/${visualId}`);
   if(!Number.isSafeInteger(grant.bytes)||grant.bytes<1||grant.bytes>6*1024*1024||!/^[a-f0-9]{64}$/.test(grant.sha256))throw new Error('The visual reference could not be verified.');
   const response=await fetch(grant.url,{cache:'no-store',signal:controller.signal});
   if(!response.ok||!response.body)throw new Error('The visual reference could not be loaded. Please try again.');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>grant.bytes)throw new Error('The visual reference failed its size check.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(size!==grant.bytes||sha!==grant.sha256)throw new Error('The visual reference failed its integrity check.');
   if(controller.signal.aborted)return;
   if(current.current.url)URL.revokeObjectURL(current.current.url);
   const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));current.current.url=url;setPreview(url);
  }catch(e){if(!controller.signal.aborted)setError(e);}finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <div aria-busy={busy}><button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Loading reference…':label}</button><Notice error={error}/>{preview&&<div style={{maxHeight:600,overflow:'auto',marginTop:16}}><img src={preview} alt={alt} style={{width:'100%',height:'auto'}}/></div>}</div>;
}
