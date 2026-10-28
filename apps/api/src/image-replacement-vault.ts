import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {JobScope} from './jobs.js';
export class ImageReplacementError extends Error { constructor(readonly code:string){super(code);this.name='ImageReplacementError';} }
export class ImageReplacementVault {
 #key:Buffer;
 constructor(key:string){if(!/^[a-f0-9]{64}$/.test(key))throw new ImageReplacementError('IMAGE_REPLACEMENT_KEY_INVALID');this.#key=Buffer.from(key,'hex');}
 private aad(scope:JobScope,purpose:'intent'|'output'|'reference'){
  for(const value of [scope.organizationId,scope.brandId,scope.jobId])if(!/^[a-f0-9-]{36}$/i.test(value))throw new ImageReplacementError('IMAGE_REPLACEMENT_SCOPE_INVALID');
  return Buffer.from(JSON.stringify(['desvio-image-replacement-v1',scope.organizationId.toLowerCase(),scope.brandId.toLowerCase(),scope.jobId.toLowerCase(),purpose]));
 }
 seal(scope:JobScope,purpose:'intent'|'output'|'reference',value:unknown){
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>60000)throw new ImageReplacementError('IMAGE_REPLACEMENT_STATE_TOO_LARGE');
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.#key,iv);c.setAAD(this.aad(scope,purpose));
  const ciphertext=Buffer.concat([c.update(bytes),c.final()]);return Buffer.concat([Buffer.from([1]),iv,c.getAuthTag(),ciphertext]);
 }
 open(scope:JobScope,purpose:'intent'|'output'|'reference',value:Buffer):unknown{
  try{if(!Buffer.isBuffer(value)||value.length<30||value.length>65536||value[0]!==1)throw new Error();
   const c=createDecipheriv('aes-256-gcm',this.#key,value.subarray(1,13));c.setAAD(this.aad(scope,purpose));c.setAuthTag(value.subarray(13,29));
   return JSON.parse(Buffer.concat([c.update(value.subarray(29)),c.final()]).toString('utf8'));
  }catch{throw new ImageReplacementError('IMAGE_REPLACEMENT_STATE_INVALID');}
 }
}
