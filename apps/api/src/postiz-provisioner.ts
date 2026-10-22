import {SignJWT} from 'jose';
import {PostizError,remoteId,type PostizConfig} from './postiz-client.js';
export const provisionedName=(brand:string)=>`Desvio business###${brand.toLowerCase()}`;
/** The enterprise signing secret belongs only in the isolated provisioner process. */
export class PostizProvisioner {
 #secret:Uint8Array;#url:URL;#timeout:number;
 constructor(config:Pick<PostizConfig,'baseURL'|'mode'|'timeoutMs'>,secret:string,private readonly transport:typeof fetch=fetch){
  try{const u=new URL(config.baseURL),local=config.mode==='test'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);if(!['','/','/api','/api/'].includes(u.pathname)||u.search||u.hash||u.username||u.password||!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!local&&!u.hostname.endsWith('.railway.internal')||typeof secret!=='string'||secret.length<32||secret.length>4096)throw new Error();u.pathname=u.pathname.replace(/\/$/,'')+'/enterprise/create-user';this.#url=u;this.#secret=new TextEncoder().encode(secret);this.#timeout=config.timeoutMs??15000;if(!Number.isInteger(this.#timeout)||this.#timeout<10||this.#timeout>30000)throw new Error();}catch{throw new PostizError('POSTIZ_PROVISIONING_CONFIG_INVALID');}
 }
 async create(brandId:string,attemptId:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(brandId)||!/^[a-f0-9-]{36}$/i.test(attemptId))throw new PostizError('POSTIZ_PROVISIONING_INPUT_INVALID');
  const brand=brandId.toLowerCase(),params=await new SignJWT({id:brand,name:'Desvio business',saasName:'Desvio',email:`business-${brand}@desvio.invalid`}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuedAt().setExpirationTime('60s').setJti(attemptId).sign(this.#secret);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
  try{
   let response:Response;try{response=await this.transport(this.#url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({params}),redirect:'error',signal:controller.signal,cache:'no-store'});}catch{throw new PostizError(controller.signal.aborted?'POSTIZ_PROVISIONING_TIMEOUT':'POSTIZ_PROVISIONING_NETWORK_ERROR','unknown');}
   if(!response.ok){await response.body?.cancel();throw new PostizError('POSTIZ_PROVISIONING_UNAVAILABLE',[401,403,404,429].includes(response.status)?'rejected':'unknown');}
   let result:any;try{if(!response.headers.get('content-type')?.includes('application/json'))throw new Error();const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const parts:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new Error();parts.push(value);}}finally{await reader.cancel().catch(()=>{});}result=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new PostizError('POSTIZ_PROVISIONING_RESPONSE_INVALID','unknown');}
   if(result&&typeof result==='object'&&Object.keys(result).length===1&&result.success===false)throw new PostizError('POSTIZ_PROVISIONING_REJECTED','rejected');
   // create:false can mean a previous uncertain request already created the
   // deterministic internal email. It is not proof that retrying is safe.
   try{const id=remoteId(result?.id),apiKey=result?.apiKey;if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>4096||/[\s\x00-\x1f\x7f]/.test(apiKey))throw new Error();return {id,apiKey};}catch{throw new PostizError('POSTIZ_PROVISIONING_RESPONSE_INVALID','unknown');}
  }finally{clearTimeout(timer);}
 }
}
