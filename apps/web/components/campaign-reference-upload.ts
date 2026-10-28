type UploadAPI=(path:string,body?:unknown,method?:string,key?:string)=>Promise<any>;
/** Reuse checked tenant uploads; only approved persisted visual IDs enter generation. */
export async function uploadCampaignReference({businessId,organizationId,file,requestKey,api,put=fetch,wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),onStatus=()=>{}}:{businessId:string;organizationId:string;file:File;requestKey:string;api:UploadAPI;put?:typeof fetch;wait?:(ms:number)=>Promise<void>;onStatus?:(status:string)=>void}){
 const type=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[file.name.split('.').at(-1)?.toLowerCase()??''];
 if(!type||file.size<1||file.size>20*1024*1024)throw new Error('Choose a PNG, JPEG or WebP up to 20 MB.');
 const path=`/api/v1/workspaces/${organizationId}/brands/${businessId}`,root=`/api/v1/businesses/${businessId}`;
 onStatus('Uploading image…');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const reserved=await api(path+'/uploads',{filename:file.name,contentType:type,bytes:file.size,sha256},'POST',requestKey);
 try{const response=await put(reserved.upload.url,{method:'PUT',headers:{'content-type':type},body:file,credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Upload failed');}catch{await api(`${path}/assets/${reserved.id}/abandon`,{}).catch(()=>{});throw new Error('The image could not upload. Please try again.');}
 await api(`${path}/assets/${reserved.id}/complete`,{});onStatus('Checking image…');
 for(let attempt=0;attempt<60;attempt++){
  const assets=await api(path+'/assets'),asset=assets.assets.find((a:any)=>a.id===reserved.id);
  if(asset&&['failed','rejected','canceled'].includes(asset.state))throw new Error('This image could not pass file checks. Choose another image.');
  if(asset?.state==='ready'){
   const intake=await api(root+'/intake'),visual=intake.visuals.find((v:any)=>v.viewport==='upload'&&v.source_id===reserved.id);
   if(visual){const reference=await api(root+'/canvas/references',{kind:'upload',visual_id:visual.id,label:file.name.replace(/[\u0000-\u001f]/g,'').slice(0,140)||'Uploaded image',consent:true});return reference.id as string;}
  }
  await wait(2000);
 }
 throw new Error('Your upload is saved and still being checked. Find it in Media Library once it is ready.');
}
