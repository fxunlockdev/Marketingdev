// Upload a large archive in parts so one dropped connection costs a single part, not the whole bundle.
import {open} from 'node:fs/promises';
import {CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand} from '@aws-sdk/client-s3';
export const PART_BYTES=64*1024*1024;
export async function uploadInParts(client,{Bucket,Key,path,bytes,metadata},{partBytes=PART_BYTES,attempts=4,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const {UploadId}=await client.send(new CreateMultipartUploadCommand({Bucket,Key,ContentType:'application/gzip',Metadata:metadata}));
 if(!UploadId)throw Error('TRANSFER_MULTIPART_NOT_STARTED');
 const file=await open(path,'r');
 try{
  const parts=[];
  for(let offset=0,number=1;offset<bytes;offset+=partBytes,number++){
   const length=Math.min(partBytes,bytes-offset),body=Buffer.alloc(length);
   const {bytesRead}=await file.read(body,0,length,offset);
   if(bytesRead!==length)throw Error('TRANSFER_ARCHIVE_CHANGED');
   for(let attempt=1;;attempt++){
    try{
     const {ETag}=await client.send(new UploadPartCommand({Bucket,Key,UploadId,PartNumber:number,Body:body,ContentLength:length}),{abortSignal:AbortSignal.timeout(300000)});
     if(!ETag)throw Error('missing ETag');
     parts.push({PartNumber:number,ETag});break;
    }catch(e){if(attempt>=attempts)throw Error('TRANSFER_PART_FAILED');await pause(2000*attempt);}
   }
  }
  await client.send(new CompleteMultipartUploadCommand({Bucket,Key,UploadId,MultipartUpload:{Parts:parts}}));
  return parts.length;
 }catch(e){
  await client.send(new AbortMultipartUploadCommand({Bucket,Key,UploadId})).catch(()=>{});
  throw e;
 }finally{await file.close();}
}
