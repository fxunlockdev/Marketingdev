import {createHash} from 'node:crypto';
import {websiteURL} from './safe-web.js';
import {VideoProviderError} from './video-provider.js';
export const RUNWAY_VIDEO_MODEL='runway/router'; // Entitlement, not a model sent to Runway.
export const RUNWAY_API_VERSION='2024-11-06';
export class RunwayError extends VideoProviderError {}
export type RunwayIntent={kind:'image';model:typeof RUNWAY_VIDEO_MODEL;idempotencyKey:string;referenceURL:string;prompt:string;durationSeconds:number;sound:'off';aspectRatio:'9:16'|'16:9'|'1:1'|'3:4'|'4:3';maxCredits?:number};
export const validRunwaySecret=(v:unknown):v is string=>typeof v==='string'&&/^[\x21-\x7e]{1,2048}$/.test(v);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=():never=>{throw Error('invalid');};
const record=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail();
const id=(v:any):string=>typeof v==='string'&&uuid.test(v)?v:fail();
const url=(v:any)=>{if(typeof v!=='string'||/[\s\x00-\x1f\x7f\\]/.test(v))return fail();const u=websiteURL(v,true);if(u.protocol!=='https:'||u.hash)return fail();return u;};
/** Audited HTTP transport: no implicit SDK retries, redirects or unbounded JSON.
 * Router creation is non-generative; only /generate/video can incur a video charge.
 * A lost paid POST is held unknown, never retried. See ADR 0052. */
export class RunwayClient {
 readonly providerName='runway';
 #secret:string;#base='https://api.dev.runwayml.com';#origins:Set<string>;#timeout:number;
 constructor(config:{mode:'test'|'development'|'staging';secret:string;referenceOrigins:string[];timeoutMs?:number;testBaseURL?:string},private transport:typeof fetch=fetch){
  try{
   if(!['test','development','staging'].includes(config.mode)||!validRunwaySecret(config.secret))fail();this.#secret=config.secret;
   if(config.testBaseURL){const u=new URL(config.testBaseURL);if(config.mode!=='test'||u.origin!==config.testBaseURL||u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port)fail();this.#base=u.origin;}
   if(!Array.isArray(config.referenceOrigins)||!config.referenceOrigins.length||config.referenceOrigins.length>10)fail();
   this.#origins=new Set(config.referenceOrigins.map(s=>{const u=url(s);if(u.origin!==s)fail();return s;}));
   this.#timeout=config.timeoutMs??30000;if(!Number.isInteger(this.#timeout)||this.#timeout<10||this.#timeout>60000)fail();
  }catch{throw new RunwayError('RUNWAY_CONFIG_INVALID');}
 }
 withBudget(intent:RunwayIntent,maxMicros:number):RunwayIntent{
  // Official Runway credits cost $0.01 = 10,000 USD micros. Round down, never up.
  const maxCredits=Math.floor(maxMicros/10000);
  if(!Number.isSafeInteger(maxMicros)||maxCredits<1||maxCredits>10000)throw new RunwayError('RUNWAY_BUDGET_TOO_LOW');
  return {...intent,maxCredits};
 }
 prepare(intent:RunwayIntent){
  try{
   record(intent);id(intent.idempotencyKey);
   if(intent.kind!=='image'||intent.model!==RUNWAY_VIDEO_MODEL||intent.sound!=='off'||!this.#origins.has(url(intent.referenceURL).origin)||typeof intent.prompt!=='string'||!intent.prompt.trim()||intent.prompt.length>26000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(intent.prompt)||!Number.isInteger(intent.durationSeconds)||intent.durationSeconds<3||intent.durationSeconds>15||!['9:16','16:9','1:1','3:4','4:3'].includes(intent.aspectRatio)||!Number.isInteger(intent.maxCredits)||intent.maxCredits!<1||intent.maxCredits!>10000)fail();
   if(Object.keys(intent).some(k=>!['kind','model','idempotencyKey','referenceURL','prompt','durationSeconds','sound','aspectRatio','maxCredits'].includes(k)))fail();
   const configId=`desvio-video-quality-v1-${intent.maxCredits}`;
   const body=JSON.stringify({configId,input:{referenceImages:[{uri:intent.referenceURL,role:'first'}],promptText:intent.prompt,duration:intent.durationSeconds,aspectRatio:intent.aspectRatio,resolution:'1080p',audio:false}});
   return {model:intent.model,idempotencyKey:intent.idempotencyKey,body,configId,sha256:createHash('sha256').update(body).digest('hex')};
  }catch{throw new RunwayError('RUNWAY_INPUT_INVALID');}
 }
 private async request(path:string,method:'GET'|'POST'|'DELETE',body?:unknown,paid=false):Promise<any>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout),outcome=paid?'unknown':'not_sent';
  try{
   let r:Response;try{r=await this.transport(new URL(path,this.#base),{method,body:body===undefined?undefined:JSON.stringify(body),headers:{Authorization:`Bearer ${this.#secret}`,'X-Runway-Version':RUNWAY_API_VERSION,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},signal:controller.signal,redirect:'error',cache:'no-store',credentials:'omit'});}catch{throw new RunwayError(controller.signal.aborted?'RUNWAY_TIMEOUT':'RUNWAY_NETWORK_ERROR',outcome);}
   if(!r.ok){await r.body?.cancel().catch(()=>{});const code=r.status===401?'AUTH_REJECTED':r.status===403?'ACCESS_OR_CREDITS_REJECTED':r.status===429?'RATE_LIMITED':r.status===404?'NOT_FOUND':r.status===409?'CONFLICT':r.status>=500?'UNAVAILABLE':'REQUEST_REJECTED';throw new RunwayError(`RUNWAY_${code}`,[400,401,403,404,409,422,429].includes(r.status)?'rejected':outcome);}
   if(method==='DELETE'&&[200,204].includes(r.status)){await r.body?.cancel().catch(()=>{});return null;}
   try{
    if(!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')??''))fail();
    if(Number(r.headers.get('content-length')??0)>262144)fail();
    const reader=r.body?.getReader();if(!reader)fail();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>262144)fail();chunks.push(value);}}finally{await reader!.cancel().catch(()=>{});}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   }catch{await r.body?.cancel().catch(()=>{});throw new RunwayError('RUNWAY_RESPONSE_INVALID',outcome);}
  }finally{clearTimeout(timer);}
 }
 private validRouter(router:any,slug:string,cap:number){
  const s=router?.settings;
  return router?.slug===slug&&s?.optimizeFor==='quality'&&s?.models?.mode==='allow_new_except'&&Array.isArray(s.models.ids)&&s.models.ids.length===0&&s?.maxCreditsPerGeneration?.video===cap;
 }
 private async findRouter(slug:string){
  let cursor:string|undefined;
  for(let page=0;page<100;page++){
   const r=record(await this.request('/v1/routers?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),'GET'));
   if(!Array.isArray(r.data))throw new RunwayError('RUNWAY_ROUTER_RESPONSE_INVALID');
   const found=r.data.find((v:any)=>v.slug===slug);if(found)return found;
   if(!r.hasMore)return null;
   if(typeof r.nextCursor!=='string'||!r.nextCursor||r.nextCursor===cursor)throw new RunwayError('RUNWAY_ROUTER_RESPONSE_INVALID');cursor=r.nextCursor;
  }throw new RunwayError('RUNWAY_ROUTER_RESPONSE_INVALID');
 }
 private async ensureRouter(slug:string,cap:number){
  let router=await this.findRouter(slug);
  if(!router){
   try{router=await this.request('/v1/routers','POST',{slug,name:`Desvio video · Quality · ${cap} credits`,settings:{optimizeFor:'quality',models:{mode:'allow_new_except',ids:[]},maxCreditsPerGeneration:{video:cap}}});}
   catch(error){if(error instanceof RunwayError&&error.code==='RUNWAY_CONFLICT')router=await this.findRouter(slug);else throw error;}
  }
  if(!this.validRouter(router,slug,cap))throw new RunwayError('RUNWAY_ROUTER_CONFIGURATION_CHANGED');
 }
 async submit(intent:RunwayIntent,expectedSHA:string){
  const p=this.prepare(intent);if(p.sha256!==expectedSHA)throw new RunwayError('RUNWAY_REPLAY_MISMATCH');
  // Nothing paid has been sent if router preparation fails; release safely.
  try{await this.ensureRouter(p.configId,intent.maxCredits!);}catch(e){throw new RunwayError(e instanceof RunwayError?e.code:'RUNWAY_ROUTER_UNAVAILABLE','rejected');}
  const value=await this.request('/v1/generate/video','POST',JSON.parse(p.body),true);
  try{
   const r=record(value),requestId=id(r.id),route=record(r.routing),settings=record(route.resolvedSettings),credits=record(route.estimatedCost).credits;
   if(r.dryRun!==false||route.configId!==p.configId||settings.optimizeFor!=='quality'||settings.priceCeiling!==intent.maxCredits||typeof credits!=='number'||!Number.isFinite(credits)||credits<0||credits>intent.maxCredits!||typeof route.model!=='string'||!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(route.model)||typeof route.provider!=='string'||!/^[a-zA-Z0-9_. -]{1,100}$/.test(route.provider))fail();
   return {requestId,routing:{model:route.model,provider:route.provider,config_id:p.configId,optimize_for:'quality',estimated_credits:credits,max_credits:intent.maxCredits}};
  }catch{throw new RunwayError('RUNWAY_RECEIPT_INVALID','unknown');}
 }
 async status(requestId:string){
  try{id(requestId);}catch{throw new RunwayError('RUNWAY_REQUEST_ID_INVALID');}
  const r=await this.request(`/v1/tasks/${requestId}`,'GET');
  try{
   const states:Record<string,string>={PENDING:'queued',THROTTLED:'queued',RUNNING:'in_progress',SUCCEEDED:'completed',FAILED:'failed',CANCELLED:'canceled'};
   if(id(r.id)!==requestId||!Object.hasOwn(states,r.status))fail();
   const videoURL=r.status==='SUCCEEDED'?url(Array.isArray(r.output)&&r.output.length===1?r.output[0]:null).href:null;
   return {state:states[r.status]!,videoURL,errorCode:r.status==='FAILED'?'RUNWAY_GENERATION_FAILED':null,...(typeof r.progress==='number'&&Number.isFinite(r.progress)&&r.progress>=0&&r.progress<=1?{progress:r.progress}:{})};
  }catch{throw new RunwayError('RUNWAY_RESPONSE_INVALID');}
 }
 async cancel(requestId:string){try{id(requestId);}catch{throw new RunwayError('RUNWAY_REQUEST_ID_INVALID');}await this.request(`/v1/tasks/${requestId}`,'DELETE');return {requestId,state:'cancel_requested'};}
}
