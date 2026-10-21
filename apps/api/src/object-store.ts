import {S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createHash} from 'node:crypto';
import type {Readable} from 'node:stream';
import type {Config} from './config.js';

export const MAX_UPLOAD_BYTES=20*1024*1024;
export const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export class InvalidAsset extends Error {constructor(readonly code:string){super(code);}}
export class ObjectStore {
  readonly client:S3Client;
  constructor(readonly config:Config['storage']) {
    this.client=new S3Client({endpoint:config.endpoint,region:config.region,forcePathStyle:true,maxAttempts:1,
      credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  }
  async uploadURL(key:string,bytes:number,type:string) {
    return getSignedUrl(this.client,new PutObjectCommand({Bucket:this.config.bucket,Key:key,ContentLength:bytes,ContentType:type}),
      {expiresIn:120,signableHeaders:new Set(['content-type','content-length'])});
  }
  async downloadURL(key:string,filename:string,type:string) {
    return getSignedUrl(this.client,new GetObjectCommand({Bucket:this.config.bucket,Key:key,
      ResponseContentDisposition:`attachment; filename="${filename}"`,ResponseContentType:type}),{expiresIn:60});
  }
  async read(key:string,limit=MAX_UPLOAD_BYTES):Promise<Buffer> {
    const result=await this.client.send(new GetObjectCommand({Bucket:this.config.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
    const stream=result.Body as Readable;
    if(!stream) throw new InvalidAsset('EMPTY_OBJECT');
    if((result.ContentLength??0)>limit){stream.destroy();throw new InvalidAsset('FILE_TOO_LARGE');}
    const chunks:Buffer[]=[];let bytes=0;
    try {for await(const chunk of stream){bytes+=chunk.length;if(bytes>limit)throw new InvalidAsset('FILE_TOO_LARGE');chunks.push(Buffer.from(chunk));}}
    finally {stream.destroy();}
    return Buffer.concat(chunks);
  }
  async persist(key:string,bytes:Buffer,type:string,hash:string) {
    // Content-addressed canonical keys: every permitted writer of this key must
    // supply exactly these bytes. Some S3-compatible services ignore If-None-Match.
    if(digest(bytes)!==hash || key.split('/').at(-1)!==hash)throw new InvalidAsset('CANONICAL_INTEGRITY_CONFLICT');
    try {
      const existing=await this.read(key);
      if(digest(existing)!==hash)throw new InvalidAsset('CANONICAL_INTEGRITY_CONFLICT');
      return 'existing-verified';
    }catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw error;}
    try {
      const result=await this.client.send(new PutObjectCommand({Bucket:this.config.bucket,Key:key,Body:bytes,ContentLength:bytes.length,
        ContentType:type,IfNoneMatch:'*',Metadata:{sha256:hash}}),{abortSignal:AbortSignal.timeout(15000)});
      return result.ETag??'';
    } catch(error) {
      if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412) throw error;
      // A worker may have persisted the object before losing its DB commit/heartbeat.
      if(digest(await this.read(key))!==hash) throw new InvalidAsset('CANONICAL_INTEGRITY_CONFLICT');
      return 'existing-verified';
    }
  }
  async removeQuarantine(key:string) {
    await this.client.send(new DeleteObjectCommand({Bucket:this.config.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
  }
  close(){this.client.destroy();}
}
