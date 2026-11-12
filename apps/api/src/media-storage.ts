import {GetObjectCommand,PutObjectCommand,type S3Client} from '@aws-sdk/client-s3';
import type {Readable} from 'node:stream';
import type {PreviewPersistence} from './image-previews.js';
import {MAX_PREVIEW_BYTES} from './media-variants.js';

const PREFIX='previews/';
const guard=(key:string):void=>{if(!key.startsWith(PREFIX)||key.includes('..'))throw new Error('Preview storage is limited to the previews prefix');};
const status=(error:unknown):number|undefined=>(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode;

/** Derived previews in the same private bucket as the originals. This adapter can neither read nor
 * overwrite an original: every key must sit under `previews/`. Nothing here is ever public or signed. */
export function s3PreviewPersistence(client:Pick<S3Client,'send'>,bucket:string):PreviewPersistence{
 return {
  async read(key:string):Promise<Buffer|null>{
   guard(key);
   let result;
   try{result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(5000)});}
   catch(error){if(status(error)===404)return null;throw error;}
   const stream=result.Body as Readable|undefined;
   if(!stream)return null;
   const chunks:Buffer[]=[];let bytes=0;
   try{
    if((result.ContentLength??0)>MAX_PREVIEW_BYTES)throw new Error('Stored preview exceeds size limit');
    for await(const chunk of stream){bytes+=chunk.length;if(bytes>MAX_PREVIEW_BYTES)throw new Error('Stored preview exceeds size limit');chunks.push(Buffer.from(chunk));}
   }finally{stream.destroy();}
   return Buffer.concat(chunks);
  },
  async write(key:string,bytes:Buffer):Promise<void>{
   guard(key);
   if(bytes.length<1||bytes.length>MAX_PREVIEW_BYTES)throw new Error('Preview exceeds size limit');
   await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentLength:bytes.length,ContentType:'image/webp'}),{abortSignal:AbortSignal.timeout(15000)});
  },
 };
}
