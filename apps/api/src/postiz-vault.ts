import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {PostizError} from './postiz-client.js';
export type CredentialScope={organization_id:string;brand_id:string;remote_organization_id:string;revision:number};
const aad=(s:CredentialScope)=>Buffer.from(JSON.stringify(['desvio-postiz-v1',s.organization_id.toLowerCase(),s.brand_id.toLowerCase(),s.remote_organization_id,s.revision]));
export class PostizVault {
 #key:Buffer;
 constructor(key:string){if(!/^[a-f0-9]{64}$/i.test(key))throw new PostizError('POSTIZ_KEY_INVALID');this.#key=Buffer.from(key,'hex');}
 seal(scope:CredentialScope,key:string){if(typeof key!=='string'||key.length<20||key.length>4096||/[\s\x00-\x1f\x7f]/.test(key))throw new PostizError('POSTIZ_CREDENTIAL_INVALID');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(aad(scope));const ciphertext=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),ciphertext]);}
 open(scope:CredentialScope,encrypted:Buffer){try{if(!Buffer.isBuffer(encrypted)||encrypted.length<49||encrypted.length>4200||encrypted[0]!==1)throw new Error();const d=createDecipheriv('aes-256-gcm',this.#key,encrypted.subarray(1,13));d.setAAD(aad(scope));d.setAuthTag(encrypted.subarray(13,29));return Buffer.concat([d.update(encrypted.subarray(29)),d.final()]).toString('utf8');}catch{throw new PostizError('POSTIZ_CREDENTIAL_INVALID');}}
}
