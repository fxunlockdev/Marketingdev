import {createRequire} from 'node:module';
import {SafeWeb,IntakeError,websiteURL} from './safe-web.js';
const robotsParser=createRequire(import.meta.url)('robots-parser');
export type RenderRequest={id:number;url:string;method:string;resourceType:string};
export type RenderResponse={id:number;status:number;headers:Record<string,string>;body:string};
/** No browser headers, credentials, cookies, POST body or host addresses cross
 * this broker. The browser child has network:none, including DNS. */
export class WebsiteRenderBroker{
 readonly started=Date.now();requests=0;bytes=0;private reserved=0;
 readonly rules=new Map<string,any>();
 private readonly pendingRules=new Map<string,Promise<void>>();
 private inFlight=0;private readonly waiting:Array<()=>void>=[];
 readonly images=new Map<string,Buffer>();
 readonly documents=new Set<string>();
 readonly root:URL;
 constructor(url:string,readonly web:Pick<SafeWeb,'fetch'>=new SafeWeb(),readonly permitted:()=>Promise<boolean>=async()=>true){this.root=websiteURL(url);}
 private async fetch(url:URL,max:number,accept:string){
  // Queue browser bursts instead of reserving the whole byte budget at once.
  // Every admitted request still uses the original deadline and byte limits.
  if(this.inFlight>=4)await new Promise<void>(resolve=>this.waiting.push(resolve));
  else this.inFlight++;
  try{return await this.fetchBounded(url,max,accept);}
  finally{const next=this.waiting.shift();if(next)next();else this.inFlight--;}
 }
 private async fetchBounded(url:URL,max:number,accept:string){
  if(!await this.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  const remaining=45000-(Date.now()-this.started);
  if(remaining<=0||++this.requests>80||this.bytes>=20*1024*1024)throw new IntakeError('WEBSITE_RENDER_LIMIT');
  const allowance=Math.min(max,20*1024*1024-this.bytes-this.reserved);
  if(allowance<=0)throw new IntakeError('WEBSITE_RENDER_LIMIT');this.reserved+=allowance;
  try{const r=await this.web.fetch(url,allowance,accept,Math.min(4000,remaining));this.bytes+=r.bytes.length;return r;}finally{this.reserved-=allowance;}
 }
 private async allowed(url:URL){
  if(!this.rules.has(url.origin)){
   let pending=this.pendingRules.get(url.origin);
   if(!pending){
    pending=(async()=>{
     const robots=new URL('/robots.txt',url),r=await this.fetch(robots,256*1024,'text/plain');
     if(r.status===200)this.rules.set(url.origin,robotsParser(robots.href,r.bytes.toString('utf8')));
     else if([404,410].includes(r.status))this.rules.set(url.origin,null);
     else throw new IntakeError('WEBSITE_TEXT_ROBOTS_UNAVAILABLE');
    })();
    this.pendingRules.set(url.origin,pending);
   }
   try{await pending;}finally{if(this.pendingRules.get(url.origin)===pending)this.pendingRules.delete(url.origin);}
  }
  if(this.rules.get(url.origin)?.isAllowed(url.href,'DesvioBot')===false)throw new IntakeError('WEBSITE_TEXT_DISALLOWED');
 }
 async request(input:RenderRequest):Promise<RenderResponse>{
  if(!input||!Number.isSafeInteger(input.id)||input.id<1||input.id>500||input.method!=='GET'||typeof input.url!=='string'||input.url.length>2048)throw new IntakeError('WEBSITE_RENDER_REQUEST_INVALID');
  const types:Record<string,{accept:string;max:number;mime:RegExp}>={
   document:{accept:'text/html',max:2*1024*1024,mime:/^text\/html(?:;|$)/i},
   script:{accept:'text/javascript,application/javascript',max:2*1024*1024,mime:/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i},
   stylesheet:{accept:'text/css',max:512*1024,mime:/^text\/css(?:;|$)/i},
   image:{accept:'image/jpeg,image/png,image/webp,image/svg+xml',max:4*1024*1024,mime:/^image\/(?:jpeg|png|webp|svg\+xml)(?:;|$)/i},
   font:{accept:'font/woff2,font/woff,application/font-woff',max:512*1024,mime:/^(?:font\/(?:woff2?|ttf|otf)|application\/font-woff)(?:;|$)/i},
   fetch:{accept:'application/json,text/plain',max:1024*1024,mime:/^(?:application\/json|text\/plain)(?:;|$)/i},
   xhr:{accept:'application/json,text/plain',max:1024*1024,mime:/^(?:application\/json|text\/plain)(?:;|$)/i},
  };
  const policy=Object.hasOwn(types,input.resourceType)?types[input.resourceType]:undefined;if(!policy)throw new IntakeError('WEBSITE_RENDER_RESOURCE_DENIED');
  let url=websiteURL(input.url,true);
  for(let hop=0;hop<4;hop++){
   // Documents and dynamic APIs stay within the entered site. Passive assets
   // may use public CDNs, but still require DNS pinning and robots permission.
   if(['document','fetch','xhr'].includes(input.resourceType)&&url.hostname.replace(/^www\./,'')!==this.root.hostname.replace(/^www\./,''))throw new IntakeError('WEBSITE_RENDER_ORIGIN_DENIED');
   await this.allowed(url);const r=await this.fetch(url,policy.max,policy.accept);
   if([301,302,303,307,308].includes(r.status)){
    if(typeof r.headers.location!=='string')throw new IntakeError('WEBSITE_TEXT_REDIRECT_LIMIT');
    // Return the redirect only after checking its target on the next request;
    // never forward cookies or arbitrary headers to the child.
    const next=websiteURL(new URL(r.headers.location,url).href,true);
    if(next.hostname.replace(/^www\./,'')!==url.hostname.replace(/^www\./,''))throw new IntakeError('WEBSITE_RENDER_ORIGIN_DENIED');
    return {id:input.id,status:r.status,headers:{location:next.href},body:''};
   }
   const mime=String(r.headers['content-type']??'');
   if(r.status!==200||!policy.mime.test(mime))throw new IntakeError('WEBSITE_RENDER_RESPONSE_INVALID');
   if(input.resourceType==='document')this.documents.add(url.href);
   if(input.resourceType==='image'&&/^image\/(jpeg|png|webp)(?:;|$)/i.test(mime)&&this.images.size<24)this.images.set(url.href,r.bytes);
   return {id:input.id,status:200,headers:{'content-type':mime,'access-control-allow-origin':'*'},body:r.bytes.toString('base64')};
  }
  throw new IntakeError('WEBSITE_TEXT_REDIRECT_LIMIT');
 }
}
