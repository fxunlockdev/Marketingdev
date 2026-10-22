import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {JobScope} from './jobs.js';
export class VideoStateError extends Error { constructor(readonly code:string){super(code);this.name='VideoStateError';} }
export class VideoVault {
 #key:Buffer;
 constructor(key:string){if(!/^[a-f0-9]{64}$/.test(key))throw new VideoStateError('VIDEO_KEY_INVALID');this.#key=Buffer.from(key,'hex');}
 private aad(scope:JobScope,purpose:'intent'|'output'){
  for(const value of [scope.organizationId,scope.brandId,scope.jobId])if(!/^[a-f0-9-]{36}$/i.test(value))throw new VideoStateError('VIDEO_SCOPE_INVALID');
  return Buffer.from(JSON.stringify(['desvio-video-v1',scope.organizationId.toLowerCase(),scope.brandId.toLowerCase(),scope.jobId.toLowerCase(),purpose]));
 }
 seal(scope:JobScope,purpose:'intent'|'output',value:unknown){
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>60000)throw new VideoStateError('VIDEO_STATE_TOO_LARGE');
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.#key,iv);c.setAAD(this.aad(scope,purpose));
  const ciphertext=Buffer.concat([c.update(bytes),c.final()]);return Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),ciphertext]);
 }
 open(scope:JobScope,purpose:'intent'|'output',value:Buffer):unknown{
  try{if(!Buffer.isBuffer(value)||value.length<30||value.length>65536||value[0]!==1)throw new Error();
   const c=createDecipheriv('aes-256-gcm',this.#key,value.subarray(1,13));c.setAAD(this.aad(scope,purpose));c.setAuthTag(value.subarray(13,29));
   return JSON.parse(Buffer.concat([c.update(value.subarray(29)),c.final()]).toString('utf8'));
  }catch{throw new VideoStateError('VIDEO_STATE_INVALID');}
 }
}
