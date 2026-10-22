import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
// Separate key and purpose from the worker-only Postiz organization credentials.
export class OAuthSecrets {
 #key:Buffer;
 constructor(key:string){if(!/^[a-f0-9]{64}$/i.test(key))throw new Error('OAUTH_KEY_INVALID');this.#key=Buffer.from(key,'hex');}
 seal(scope:string,purpose:'state'|'code',text:string){if(!text||text.length>8000)throw new Error('OAUTH_SECRET_INVALID');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.#key,iv);c.setAAD(Buffer.from(`desvio-oauth-v1:${scope}:${purpose}`));const bytes=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);}
 open(scope:string,purpose:'state'|'code',bytes:Buffer){try{if(!Buffer.isBuffer(bytes)||bytes.length<29||bytes.length>32028)throw new Error();const d=createDecipheriv('aes-256-gcm',this.#key,bytes.subarray(0,12));d.setAAD(Buffer.from(`desvio-oauth-v1:${scope}:${purpose}`));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');}catch{throw new Error('OAUTH_SECRET_INVALID');}}
}
