import {postMetrics} from './post-analytics.js';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
export const POSTIZ_CONTRACT_COMMIT='651876e24317c2d8e717262cf98267ec6f699180';
export type RemoteOutcome='not_sent'|'rejected'|'unknown';
export class PostizError extends Error {
 constructor(readonly code:string,readonly outcome:RemoteOutcome='not_sent',readonly retryAfterSeconds?:number){super(code);this.name='PostizError';}
}
export type PostizConfig={baseURL:string;mediaOrigins:string[];callbackOrigin:string;mode:'test'|'development'|'staging';timeoutMs?:number};
export type PostizBinding={organizationId:string;brandId:string;remoteOrganizationId:string;apiKey:string};
export type PostizIntegration={id:string;name:string;provider:string;disabled:boolean;profile:string|null;picture:string|null};
export type PostizPost={id:string;integrationId:string;provider:string;content:string;publishDate:string;state:'queued'|'published'|'failed'|'draft'|'unknown';remoteState:string;releaseId:string|null;releaseURL:string|null};
const fail=()=>{throw new PostizError('POSTIZ_RESPONSE_INVALID');};
const record=(v:unknown):Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as any:fail();
const str=(v:unknown,max=200):string=>typeof v==='string'&&v.length>0&&v.length<=max?v:fail();
export const remoteId=(v:unknown):string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(v)?v:fail();
const optionalURL=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;try{const u=new URL(str(v,2048));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const nullableId=(v:unknown)=>v===null||v===undefined||v===''?null:str(v,256);
const iso=(v:unknown)=>{const s=str(v,40);if(!/^\d{4}-\d{2}-\d{2}T/.test(s)||!Number.isFinite(Date.parse(s)))return fail();return new Date(s).toISOString();};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const bool=(v:unknown)=>typeof v==='boolean'?v:fail();
const exactOrigin=(s:string)=>{const u=new URL(s);if(u.origin!==s||u.username||u.password)throw new PostizError('POSTIZ_CONFIG_INVALID');return u;};
/** Server-only transport. Every operation checks the credential's real org; caller
 * headers, redirect destinations and arbitrary API paths are never accepted. */
export class PostizClient {
 #key:string;#remoteOrg:string;#base:URL;#origins:Set<string>;#callback:URL;#timeout:number;
 constructor(config:PostizConfig,binding:PostizBinding,private readonly transport:typeof fetch=fetch){
  try{
   this.#base=new URL(config.baseURL);this.#callback=exactOrigin(config.callbackOrigin);
   const local=config.mode==='test'&&['127.0.0.1','localhost','[::1]'].includes(this.#base.hostname);
   const privateRailway=this.#base.hostname.endsWith('.railway.internal');
   if(!['','/','/api','/api/'].includes(this.#base.pathname)||this.#base.search||this.#base.hash||this.#base.username||this.#base.password||!['https:','http:'].includes(this.#base.protocol)||this.#base.protocol==='http:'&&!local&&!privateRailway)throw new Error();
   if(this.#callback.protocol!=='https:'&&!(config.mode==='test'&&this.#callback.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(this.#callback.hostname)))throw new Error();
   this.#base.pathname=this.#base.pathname.replace(/\/$/,'')+'/';
   this.#remoteOrg=remoteId(binding.remoteOrganizationId);this.#key=binding.apiKey;
   if(!/^[0-9a-f-]{36}$/i.test(binding.organizationId)||!/^[0-9a-f-]{36}$/i.test(binding.brandId)||typeof this.#key!=='string'||this.#key.length<20||this.#key.length>4096||/[\s\x00-\x1f\x7f]/.test(this.#key))throw new Error();
   if(!config.mediaOrigins.length||config.mediaOrigins.length>10)throw new Error();
   this.#origins=new Set(config.mediaOrigins.map(s=>{const u=exactOrigin(s);if(u.protocol!=='https:'&&!(config.mode==='test'&&u.origin===this.#base.origin))throw new Error();return u.origin;}));
   this.#timeout=config.timeoutMs??15000;if(!Number.isInteger(this.#timeout)||this.#timeout<10||this.#timeout>30000)throw new Error();
  }catch{throw new PostizError('POSTIZ_CONFIG_INVALID');}
 }
 private async request(path:string,method='GET',body?:BodyInit,contentType?:string,mutating=method!=='GET'):Promise<any>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
  try{
   let response:Response;
   try{response=await this.transport(new URL(path,this.#base),{method,headers:{Authorization:this.#key,...(contentType?{'Content-Type':contentType}:{})},body,redirect:'error',signal:controller.signal,cache:'no-store'});}catch{throw new PostizError(controller.signal.aborted?'POSTIZ_TIMEOUT':'POSTIZ_NETWORK_ERROR',mutating?'unknown':'not_sent');}
   if(!response.ok){await response.body?.cancel();const raw=response.headers.get('retry-after');const retry=raw===null||raw.trim()===''?NaN:/^\d+$/.test(raw)?Number(raw):(Date.parse(raw)-Date.now())/1000;const bounded=Number.isFinite(retry)&&retry>=0?Math.min(Math.ceil(retry),3600):undefined;
    throw new PostizError(response.status===401||response.status===403?'POSTIZ_AUTH_REJECTED':response.status===429?'POSTIZ_RATE_LIMITED':response.status>=500?'POSTIZ_UNAVAILABLE':'POSTIZ_REQUEST_REJECTED',mutating&&!([400,401,403,404,422,429].includes(response.status))?'unknown':'rejected',bounded);
   }
   try{
    if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))return fail();
    const reader=response.body?.getReader();if(!reader)return fail();let length=0;const parts:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024)return fail();parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
   }catch{throw new PostizError('POSTIZ_RESPONSE_INVALID',mutating?'unknown':'not_sent');}
  }finally{clearTimeout(timer);}
 }
 private checked<T>(value:any,parse:(v:any)=>T,mutating=false):T{try{return parse(value);}catch{throw new PostizError('POSTIZ_RESPONSE_INVALID',mutating?'unknown':'not_sent');}}
 async identity(){const value=await this.request('public/v1/me');const identity=this.checked(value,v=>{const org=record(record(v).organization);return {id:remoteId(org.id),name:str(org.name,500)};});if(identity.id!==this.#remoteOrg)throw new PostizError('POSTIZ_TENANT_MISMATCH');return identity;}
 private async verify(){try{await this.identity();}catch(e){if(e instanceof PostizError)throw e;throw new PostizError('POSTIZ_IDENTITY_UNVERIFIED');}}
 private integrations(value:any):PostizIntegration[]{return this.checked(value,v=>{if(!Array.isArray(v)||v.length>500)return fail();const seen=new Set<string>();return v.map(raw=>{const r=record(raw),id=remoteId(r.id);if(seen.has(id))return fail();seen.add(id);return {id,name:str(r.name,300),provider:str(r.identifier,100),disabled:bool(r.disabled),profile:optionalURL(r.profile),picture:optionalURL(r.picture)};});});}
 async listIntegrations(){await this.verify();return this.integrations(await this.request('public/v1/integrations'));}
 // First OAuth flow is LinkedIn member. Page/account selection remains a separate
 // verified workflow; no arbitrary provider URL is accepted here.
 async beginLinkedIn(){await this.verify();const value=await this.request('public/v1/social/linkedin','GET',undefined,undefined,true);return this.checked(value,v=>{
  const url=new URL(str(record(v).url,8000));if(url.origin!=='https://www.linkedin.com'||url.pathname!=='/oauth/v2/authorization'||url.username||url.password||url.hash)return fail();
  const state=url.searchParams.getAll('state'),redirect=url.searchParams.getAll('redirect_uri');
  if(state.length!==1||!/^[a-zA-Z0-9_-]{6,256}$/.test(state[0])||redirect.length!==1||redirect[0]!==`${this.#callback.origin}/integrations/social/linkedin`||url.searchParams.get('response_type')!=='code'||!url.searchParams.get('client_id'))return fail();
  return {url:url.href,state:state[0]};
 },true);}
 async completeLinkedIn(state:string,code:string,timezone:string){
  if(!/^[a-zA-Z0-9_-]{6,256}$/.test(state)||!code||code.length>8000||/[\x00-\x1f]/.test(code)||! /^-?\d{1,4}$/.test(timezone)||Math.abs(Number(timezone))>840)throw new PostizError('POSTIZ_CALLBACK_INVALID');
  await this.verify();const value=await this.request('integrations/social-connect/linkedin','POST',JSON.stringify({state,code,timezone}),'application/json');
  return this.checked(value,v=>{const r=record(v);if(r.organizationId!==this.#remoteOrg||r.providerIdentifier!=='linkedin'||r.inBetweenSteps===true||r.isBetweenSteps===true||r.pages&&(!Array.isArray(r.pages)||r.pages.length))return fail();return {id:remoteId(r.id),internalId:remoteId(r.internalId),name:str(r.name,300)};},true);
 }
 private media(value:any,extension='png'){return this.checked(value,v=>{const r=record(v),url=new URL(str(r.path,2048));if(!this.#origins.has(url.origin)||url.username||url.password||url.hash||!url.pathname.toLowerCase().endsWith('.'+extension))return fail();return {id:remoteId(r.id),path:url.href};},true);}
 async uploadPNG(bytes:Buffer,expectedSHA:string){
  if(bytes.length<24||bytes.length>20*1024*1024||! /^[a-f0-9]{64}$/.test(expectedSHA)||sha(bytes)!==expectedSHA)throw new PostizError('POSTIZ_MEDIA_INVALID');
  try{const m=await sharp(bytes,{limitInputPixels:1536*1536}).metadata();if(m.format!=='png'||!m.width||!m.height||![[1024,1024],[1536,1024],[1024,1536]].some(([w,h])=>m.width===w&&m.height===h))throw new Error();}catch{throw new PostizError('POSTIZ_MEDIA_INVALID');}
  await this.verify();const form=new FormData();form.set('adjust','false');form.set('file',new Blob([Uint8Array.from(bytes)],{type:'image/png'}),`desvio-${expectedSHA}.png`);
  return this.media(await this.request('public/v1/upload','POST',form));
 }
 // Caller supplies the hash-bound canonical output of the isolated video renderer.
 async uploadMP4(bytes:Buffer,expectedSHA:string){
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>64*1024*1024||bytes.subarray(4,8).toString()!=='ftyp'||!/^[a-f0-9]{64}$/.test(expectedSHA)||sha(bytes)!==expectedSHA)throw new PostizError('POSTIZ_MEDIA_INVALID');
  await this.verify();const form=new FormData();form.set('adjust','false');form.set('file',new Blob([Uint8Array.from(bytes)],{type:'video/mp4'}),`desvio-${expectedSHA}.mp4`);
  return this.media(await this.request('public/v1/upload','POST',form),'mp4');
 }
 async submitLinkedIn(input:{integrationId:string;caption:string;media:{id:string;path:string};mediaType?:'image'|'video';scheduledAt:string}){
  let id:string,date:string,media:{id:string;path:string};
  try{id=remoteId(input.integrationId);date=iso(input.scheduledAt);if(input.mediaType!==undefined&&! ['image','video'].includes(input.mediaType))throw new Error();media=this.media(input.media,input.mediaType==='video'?'mp4':'png');if(typeof input.caption!=='string'||input.caption.length>3000)throw new Error();}catch{throw new PostizError('POSTIZ_POST_INVALID');}
  const integrations=await this.listIntegrations(),target=integrations.find(i=>i.id===id);
  if(!target||target.provider!=='linkedin'||target.disabled)throw new PostizError('POSTIZ_CHANNEL_UNAVAILABLE');
  const body={type:'schedule',date,shortLink:false,tags:[],posts:[{integration:{id},value:[{content:input.caption,image:[media]}],settings:{__type:'linkedin',post_as_images_carousel:false}}]};
  const value=await this.request('public/v1/posts','POST',JSON.stringify(body),'application/json');
  return this.checked(value,v=>{if(!Array.isArray(v)||v.length!==1)return fail();const r=record(v[0]);if(r.integration!==id)return fail();return {postId:remoteId(r.postId),integrationId:id,status:'accepted' as const};},true);
 }
 async postAnalytics(postId:string,days=30){
  remoteId(postId);if(!Number.isInteger(days)||days<1||days>90)throw new PostizError('POSTIZ_DATE_RANGE_INVALID');
  await this.verify();return postMetrics(await this.request(`public/v1/analytics/post/${encodeURIComponent(postId)}?date=${days}`));
 }
 async listPosts(start:string,end:string):Promise<PostizPost[]>{
  let from:string,to:string;try{from=iso(start);to=iso(end);if(Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>31*86400000)throw new Error();}catch{throw new PostizError('POSTIZ_DATE_RANGE_INVALID');}
  await this.verify();const value=await this.request('public/v1/posts?'+new URLSearchParams({startDate:from,endDate:to}));
  return this.checked(value,v=>{const posts=record(v).posts;if(!Array.isArray(posts)||posts.length>10000)return fail();return posts.map(raw=>{
   const r=record(raw),i=record(r.integration),state=str(r.state,100),releaseId=nullableId(r.releaseId),releaseURL=optionalURL(r.releaseURL);
   const normalized:PostizPost['state']=state==='QUEUE'?'queued':state==='DRAFT'?'draft':state==='ERROR'?'failed':state==='PUBLISHED'&&releaseId?'published':'unknown';
   return {id:remoteId(r.id),integrationId:remoteId(i.id),provider:str(i.providerIdentifier,100),content:typeof r.content==='string'&&r.content.length<=50000?r.content:fail(),publishDate:iso(r.publishDate),state:normalized,remoteState:state,releaseId,releaseURL};
  });});
 }
}
