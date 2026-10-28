import {IntakeError,websiteURL} from './safe-web.js';
import {digest} from './object-store.js';
export const MAXUN_CAPTURE_VERSION='maxun-cloud-v1/desvio-v1';
export type MaxunPageEvidence={url:string;sha256:string;text:string;markdown:string;html:string;links:string[];title:string;screenshotKeys:string[];truncated:boolean};
/** Normalize only recognized captured fields. Raw provider results are untrusted
 * evidence, never markup to render or instructions/tools to execute. */
export function maxunEvidence(output:unknown,target:string){
 const data=output as any,root=websiteURL(target);
 if(!data||!Array.isArray(data.crawlData)||data.crawlData.length>5)throw new IntakeError('MAXUN_RESPONSE_INVALID');
 const pages:MaxunPageEvidence[]=[],skipped:{url:string;code:string}[]=[];
 const seen=new Set<string>();
 for(const entry of data.crawlData){
  if(!entry||typeof entry!=='object')throw new IntakeError('MAXUN_RESPONSE_INVALID');
  const url=websiteURL(entry.metadata?.url??entry.url).href;
  if(new URL(url).hostname!==root.hostname)throw new IntakeError('MAXUN_SCOPE_MISMATCH');
  if(seen.has(url))continue;seen.add(url);
  if(entry.error||entry.metadata?.statusCode>=400){skipped.push({url,code:'MAXUN_PAGE_FAILED'});continue;}
  const field=(key:string,max:number)=>{const value=entry[key]??'';if(typeof value!=='string'||Buffer.byteLength(value)>max)throw new IntakeError('MAXUN_OUTPUT_TOO_LARGE');return value;};
  const text=field('text',2*1024*1024),markdown=field('markdown',2*1024*1024),html=field('html',4*1024*1024);
  if(!(text||markdown).trim()){skipped.push({url,code:'WEBSITE_NO_CONTENT'});continue;}
  if(entry.links!==undefined&&!Array.isArray(entry.links))throw new IntakeError('MAXUN_RESPONSE_INVALID');
  const links=(entry.links??[]).slice(0,100).flatMap((link:any)=>{
   const value=typeof link==='string'?link:link?.href;
   try{return typeof value==='string'?[websiteURL(new URL(value,url).href).href]:[];}catch{return [];}
  });
  const screenshotKeys=[entry.screenshotVisible,entry.screenshotFullpage].filter(x=>typeof x==='string'&&x.length>0&&x.length<=4096);
  const title=typeof entry.metadata?.title==='string'?entry.metadata.title.slice(0,1000):'';
  pages.push({url,text,markdown,html,links,title,screenshotKeys,truncated:(text||markdown).length>40000,sha256:digest(Buffer.from(JSON.stringify({url,text,markdown,html,links})))});
 }
 if(!pages.length)throw new IntakeError('WEBSITE_NO_CONTENT');
 return {pages,skipped};
}
