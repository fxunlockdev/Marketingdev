import {api} from './api';

/** Authenticated grant on every attempt; never persist private URLs or image bytes. */
export async function loadPrivateImage(endpoint:string,signal:AbortSignal,maxBytes=20*1024*1024):Promise<Blob>{
 for(let attempt=0;attempt<2;attempt++){
  signal.throwIfAborted();
  try{
   const grant=await api<{url:string;bytes?:number;sha256?:string}>(endpoint);
   signal.throwIfAborted();
   const response=await fetch(grant.url,{credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
   const type=response.headers.get('content-type')?.split(';')[0];
   if(!response.ok||!response.body)throw new Error('Image download failed');
   if(!['image/png','image/jpeg','image/webp'].includes(type??''))throw new Error('Image type could not be verified');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('Image exceeds size limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(grant.bytes!==undefined&&size!==Number(grant.bytes))throw new Error('Image size could not be verified');
   if(grant.sha256){const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==grant.sha256)throw new Error('Image integrity could not be verified');}
   signal.throwIfAborted();return new Blob([bytes],{type});
  }catch(error){if(signal.aborted)throw error;if(attempt===1)throw new Error('This image could not load. Check your connection and retry.');}
 }
 throw new Error('This image could not load. Please retry.');
}
