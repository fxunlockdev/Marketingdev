import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import sharp from 'sharp';
import {WebsiteRenderBroker} from './website-render-broker.js';
import {IntakeError,websiteURL} from './safe-web.js';
import {digest} from './object-store.js';
import type {AssetJobs,JobScope} from './jobs.js';
import type {VisualCapture,WebsitePage} from './website-evidence.js';
const VERSION='website-renderer-v1';
export function renderMessage(line:string):any{
 let value:any;try{value=JSON.parse(line);}catch{throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');}
 if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='error'&&value.error==='WEBSITE_RENDER_FAILED')throw new IntakeError('WEBSITE_RENDER_FAILED');
 if(!value||typeof value!=='object'||Array.isArray(value)||!['request','result'].includes(value.type))throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');
 return value;
}
export class WebsiteRenderer{
 constructor(readonly image?:string,readonly createBroker:(url:string,permitted:()=>Promise<boolean>)=>WebsiteRenderBroker=(url,permitted)=>new WebsiteRenderBroker(url,undefined,permitted)){}
 get configured(){return /^sha256:[a-f0-9]{64}$/.test(this.image??'');}
 async capture(jobs:AssetJobs,scope:JobScope,url:string){
  if(!this.configured)throw new IntakeError('WEBSITE_RENDER_NOT_CONFIGURED');
  websiteURL(url);
  const permitted=()=>jobs.transaction(scope,async(db,j)=>j.kind==='website.extract'&&await jobs.permitted(db,j));
  if(!await permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  const broker=this.createBroker(url,permitted),name=`desvio-website-${randomUUID()}`;
  let raw:any;
  try{
   raw=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['run','--rm','-i','--name',name,'--label','desvio.purpose=website-render-sandbox','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--memory-swap','1g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=128m',this.image!],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
    let settled=false,pending='',total=0,result:any;const decoder=new StringDecoder('utf8');const ids=new Set<number>();
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin.destroy();if(error){child.kill('SIGKILL');reject(error);}else resolve(result);};
    const timer=setTimeout(()=>finish(new IntakeError('WEBSITE_RENDER_TIMEOUT')),50000);
    child.on('error',()=>finish(new IntakeError('WEBSITE_RENDER_UNAVAILABLE')));child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{
     if(settled)return;
     total+=chunk.length;if(total>12*1024*1024)return finish(new IntakeError('WEBSITE_RENDER_OUTPUT_LIMIT'));pending+=decoder.write(chunk);
     let newline;
     while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);let message:any;
      try{message=renderMessage(line);}catch(error){return finish(error instanceof IntakeError?error:new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID'));}
      if(message.type==='result'){if(result)return finish(new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID'));result=message;continue;}
      if(message.type!=='request'||ids.has(message.id)||ids.size>=80)return finish(new IntakeError('WEBSITE_RENDER_REQUEST_INVALID'));
      ids.add(message.id);
      void broker.request(message).then(reply=>{if(!settled)child.stdin.write(JSON.stringify(reply)+'\n');},error=>{if(!settled)child.stdin.write(JSON.stringify({id:message.id,error:'RESOURCE_DENIED'})+'\n');if(error instanceof IntakeError&&error.code==='ACCESS_REVOKED_OR_CANCELED')finish(error);});
     }
    });
    child.on('close',code=>{if(code!==0||!result)return finish(new IntakeError('WEBSITE_RENDER_FAILED'));finish();});
    child.stdin.write(JSON.stringify({url})+'\n');
   });
  }finally{await promisify(execFile)('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});}
  if(!await permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  return normalizeRenderedCapture(raw,url,broker);
 }
}
export async function normalizeRenderedCapture(raw:any,root:string,broker:WebsiteRenderBroker){
 if(raw?.version!==VERSION||!Array.isArray(raw.pages)||raw.pages.length>3)throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');
 const allowedFailures=new Set(['DOCUMENT_UNAVAILABLE','DOCUMENT_PROVENANCE_MISSING','DOM_LOAD_TIMEOUT','DOCUMENT_CHANGED','INSUFFICIENT_TEXT','NAVIGATION_TIMEOUT','NAVIGATION_FAILED','DOM_CAPTURE_TIMEOUT','DOM_CAPTURE_FAILED','SCREENSHOT_TIMEOUT','SCREENSHOT_FAILED']);
 const diagnostics=Array.isArray(raw.failures)?raw.failures.slice(0,24).filter((f:any)=>f&&Number.isInteger(f.page)&&f.page>=0&&f.page<3&&allowedFailures.has(f.code)).map((f:any)=>({page:f.page,code:f.code})):[];
 const pages:WebsitePage[]=[],captures=new Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture['snapshots'][number]}[]}>(),visualErrors:{url:string;code:string}[]=[];
 const seen=new Set<string>();let photos=0,screenshots=0;
 for(const entry of raw.pages){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.url!=='string')throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');
  const url=websiteURL(entry.url,true).href;
  if(!broker.documents.has(url))throw new IntakeError('WEBSITE_RENDER_PROVENANCE_INVALID');
  if(new URL(url).hostname.replace(/^www\./,'')!==new URL(root).hostname.replace(/^www\./,''))throw new IntakeError('WEBSITE_RENDER_ORIGIN_DENIED');
  if(typeof entry.text!=='string'||entry.text.length>24000||!Array.isArray(entry.images)||entry.images.length>24||!Array.isArray(entry.links)||entry.links.length>80||(entry.screenshot!==undefined&&(typeof entry.screenshot!=='string'||entry.screenshot.length>3*1024*1024)))throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');
  if(entry.text.trim().length<160||seen.has(url))continue;seen.add(url);
  const links:string[]=[];for(const value of entry.links){try{const parsed=websiteURL(value);if(parsed.hostname===new URL(url).hostname)links.push(parsed.href);}catch{}}
  const capture:VisualCapture={version:VERSION,url,coverage:entry.screenshot===undefined?'website_photos_only':'rendered_desktop',requests:broker.requests,failures:[],snapshots:[]};
  if(entry.screenshot!==undefined){
   const screenshot=Buffer.from(entry.screenshot,'base64');
   const decoded=await sharp(screenshot,{limitInputPixels:2_000_000,failOn:'error'}).metadata();
   if(decoded.format!=='jpeg'||decoded.width!==1440||decoded.height!==1000||screenshot.toString('base64')!==entry.screenshot)throw new IntakeError('WEBSITE_RENDER_OUTPUT_INVALID');
   await sharp(screenshot,{limitInputPixels:2_000_000}).raw().toBuffer();
   capture.snapshots.push({label:'visible',viewport:{width:1440,height:1000},height:1000,truncated:true,sha256:digest(screenshot),screenshot:entry.screenshot,observations:{captureKind:'visible',title:typeof entry.title==='string'?entry.title.slice(0,300):'',text:entry.text,links,images:[],typography:[],colors:[]}});
   screenshots++;
  }
  for(const candidate of entry.images){
   if(photos>=12)break;
   try{
    const imageUrl=websiteURL(candidate.url,true).href,bytes=broker.images.get(imageUrl);if(!bytes)continue;
    const pipe=sharp(bytes,{limitInputPixels:32_000_000,failOn:'error'}),meta=await pipe.metadata();
    if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1||!meta.width||!meta.height||meta.width<240||meta.height<160)continue;
    const {data,info}=await pipe.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer({resolveWithObject:true});
    const hash=digest(data);if(seen.has(hash))continue;seen.add(hash);photos++;
    capture.snapshots.push({label:'photo',viewport:{width:info.width,height:info.height},height:info.height,truncated:false,sha256:hash,screenshot:data.toString('base64'),observations:{kind:'website_photo',source_url:imageUrl,page_url:url,label:typeof candidate.label==='string'?candidate.label.slice(0,140):'Website image',images:[]}});
   }catch{visualErrors.push({url,code:'WEBSITE_PHOTO_INVALID'});}
  }
  if(capture.snapshots.length)captures.set(url,{capture,objects:[]});
  const text=entry.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  pages.push({url,parserVersion:VERSION,sha256:digest(Buffer.from(JSON.stringify({text,images:capture.snapshots.map(s=>s.sha256)}))),chunks:Array.from({length:Math.ceil(text.length/8000)},(_,i)=>({text:text.slice(i*8000,(i+1)*8000),anchor:`rendered:${i*8000}`})),links,truncated:text.length===24000,coverage:'rendered_provider'});
 }
 if(!pages.length)throw Object.assign(new IntakeError('AI_RESEARCH_NO_SOURCES'),{captureDiagnostics:diagnostics});
 return {pages,captures,visualErrors,captureDiagnostics:diagnostics,coverage:{provider:'self_hosted_browser',method:'rendered_desktop',pages:pages.map(p=>p.url),screenshotsAvailable:screenshots>0,photosAvailable:photos,partial:true}};
}
