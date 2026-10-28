import {Parser} from 'htmlparser2';
import {createRequire} from 'node:module';
const robotsParser=createRequire(import.meta.url)('robots-parser') as (url:string,text:string)=>{isAllowed:(url:string,agent:string)=>boolean|undefined};
import sharp from 'sharp';
import {SafeWeb,IntakeError,websiteURL} from './safe-web.js';
import {digest} from './object-store.js';
import type {VisualCapture} from './website-evidence.js';
export const PHOTO_VERSION='website-photos-v3';
type PhotoBudget={requests:number;started:number;maxRequests:number;maxMs:number;maxImages:number;rules:Map<string,ReturnType<typeof robotsParser>|null>;seen:Set<string>};
const photoBudget=(maxRequests:number,maxMs:number,maxImages:number):PhotoBudget=>({requests:0,started:Date.now(),maxRequests,maxMs,maxImages,rules:new Map(),seen:new Set()});
export function websitePhotoCandidates(html:string,page:string){
 const items=new Map<string,string>();
 const add=(raw:string|undefined,label='')=>{if(!raw||items.size>=24)return;try{const url=websiteURL(new URL(raw,page).href,true);if(!items.has(url.href))items.set(url.href,label.replace(/[\u0000-\u001f]/g,' ').slice(0,140));}catch{/* Ignore non-public URL forms. DNS is checked before fetching. */}};
 const responsive=(set:string|undefined,label:string)=>{
  if(!set)return;
  const choices=set.split(',').map(s=>s.trim().split(/\s+/)).filter(s=>s.length===2&&/^\d+(?:\.\d+)?(w|x)$/.test(s[1])).sort((a,b)=>parseFloat(b[1])-parseFloat(a[1]));
  add(choices[0]?.[0],label);
 };
 const parser=new Parser({onopentag(name,a){
  // Inline hero backgrounds and picture sources are common on brand sites.
  // These are candidate URLs only: the same DNS, robots, size and raster checks apply.
  if(name==='source'&&(!a.type||/^image\/(jpeg|png|webp)$/i.test(a.type)))responsive(a['data-srcset']??a.srcset,'Website image');
  if(a.style){for(const declaration of a.style.split(';')){
   if(!/^\s*background(?:-image)?\s*:/i.test(declaration))continue;
   for(const match of declaration.matchAll(/url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^)'"\s]+))\s*\)/gi))add(match[1]??match[2]??match[3],a['aria-label']??'Website image');
  }}
  if(name==='meta'&&['og:image','twitter:image'].includes(a.property??a.name))add(a.content,'Website image');
  if(name==='img'){
   if((a.width&&Number(a.width)<160)||(a.height&&Number(a.height)<160))return;
   add(a['data-src']??a['data-lazy-src']??a.src,a.alt);
   const set=a['data-srcset']??a.srcset;
   responsive(set,a.alt??'');
  }
 }},{decodeEntities:true});parser.end(html);return [...items].map(([url,label])=>({url,label}));
}
export class WebsitePhotos{
 constructor(readonly web:Pick<SafeWeb,'fetch'>=new SafeWeb()){}
 async capture(page:string){return this.capturePage(page,photoBudget(18,45000,6));}
 async capturePages(pages:string[],beforePage?:()=>Promise<void>){
  const budget=photoBudget(48,60000,20),captures:VisualCapture[]=[];
  for(const page of [...new Set(pages)].slice(0,4)){
   if(budget.requests>=budget.maxRequests||Date.now()-budget.started>=budget.maxMs||budget.seen.size>=budget.maxImages)break;
   await beforePage?.();captures.push(await this.capturePage(page,budget));
  }
  return captures;
 }
 private async capturePage(page:string,budget:PhotoBudget){
  const {rules,seen}=budget,initialRequests=budget.requests;
  const failures:{url:string;reason:string}[]=[],snapshots:VisualCapture['snapshots']=[];
  const fetch=async(url:URL,max:number,accept:string)=>{const remaining=budget.maxMs-(Date.now()-budget.started);if(budget.requests>=budget.maxRequests||remaining<=0)throw new IntakeError('WEBSITE_PHOTO_LIMIT');budget.requests++;return this.web.fetch(url,max,accept,Math.min(5000,remaining));};
  const permitted=async(url:URL)=>{
   if(!rules.has(url.origin)){
    const robot=new URL('/robots.txt',url),r=await fetch(robot,256*1024,'text/plain');
    if(r.status===404||r.status===410)rules.set(url.origin,null);
    else if(r.status===200)rules.set(url.origin,robotsParser(robot.href,r.bytes.toString('utf8')));
    else throw new IntakeError('WEBSITE_PHOTO_ACCESS_UNAVAILABLE');
   }
   if(rules.get(url.origin)?.isAllowed(url.href,'DesvioBot')===false)throw new IntakeError('WEBSITE_PHOTO_DISALLOWED');
  };
  const get=async(input:string,max:number,accept:string)=>{
   let url=websiteURL(input,true);
   for(let i=0;i<4;i++){
    await permitted(url);const r=await fetch(url,max,accept);
    if([301,302,303,307,308].includes(r.status)){const location=r.headers.location;if(typeof location!=='string')throw new IntakeError('WEBSITE_PHOTO_REDIRECT_INVALID');url=websiteURL(new URL(location,url).href,true);continue;}
    if(r.status!==200)throw new IntakeError('WEBSITE_PHOTO_FETCH_FAILED');return {response:r,url:url.href};
   }
   throw new IntakeError('WEBSITE_PHOTO_REDIRECT_LIMIT');
  };
  try{
   const source=await get(page,2*1024*1024,'text/html');
   if(!String(source.response.headers['content-type']??'').toLowerCase().startsWith('text/html'))throw new IntakeError('WEBSITE_PHOTO_HTML_REQUIRED');
   for(const candidate of websitePhotoCandidates(source.response.bytes.toString('utf8'),source.url)){
    if(snapshots.length>=6||seen.size>=budget.maxImages||budget.requests>=budget.maxRequests||Date.now()-budget.started>=budget.maxMs)break;
    try{
     const fetched=await get(candidate.url,6*1024*1024,'image/jpeg,image/png,image/webp');
     if(!/^image\/(jpeg|png|webp)(;|$)/i.test(String(fetched.response.headers['content-type']??'')))throw new IntakeError('WEBSITE_PHOTO_TYPE_UNSUPPORTED');
     const pipeline=sharp(fetched.response.bytes,{limitInputPixels:32_000_000,failOn:'error'}),meta=await pipeline.metadata();
     if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1||!meta.width||!meta.height||meta.width<240||meta.height<160)throw new IntakeError('WEBSITE_PHOTO_NOT_SUITABLE');
     const {data,info}=await pipeline.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer({resolveWithObject:true});
     const sha256=digest(data);if(seen.has(sha256))continue;seen.add(sha256);
     snapshots.push({label:'photo',viewport:{width:info.width,height:info.height},height:info.height,truncated:false,sha256,screenshot:data.toString('base64'),observations:{kind:'website_photo',source_url:fetched.url,page_url:source.url,label:candidate.label,images:[]}});
    }catch(e){failures.push({url:candidate.url,reason:e instanceof IntakeError?e.code:'WEBSITE_PHOTO_INVALID'});}
   }
  }catch(e){failures.push({url:page,reason:e instanceof IntakeError?e.code:'WEBSITE_PHOTO_UNAVAILABLE'});}
  return {version:PHOTO_VERSION,url:page,coverage:'website_photos_only',requests:budget.requests-initialRequests,failures,snapshots} satisfies VisualCapture;
 }
}
