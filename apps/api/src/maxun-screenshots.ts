import sharp from 'sharp';
import {SafeWeb,IntakeError,websiteURL} from './safe-web.js';
import {digest} from './object-store.js';
/** Accept only the screenshot reference associated with this authenticated run.
 * No credentials follow the media URL. SafeWeb pins public DNS and rejects redirects. */
function screenshotReference(value:string,runId:string){
 const url=websiteURL(value,true),parts=url.pathname.split('/').map(decodeURIComponent),name=parts.at(-1)??'';
 if(url.protocol!=='https:'||parts.at(-2)!==runId||!(/^(?:crawl-\d{1,3}-screenshot-(?:visible|fullpage)|Crawl - \d{1,3} - (?:Visible|Full Page))$/.test(name)))throw new IntakeError('MAXUN_SCREENSHOT_REFERENCE_INVALID');
 return {url,name};
}
export function maxunScreenshotURL(media:unknown,key:string,runId:string){
 if(!Array.isArray(media)||media.length>20||! /^[a-f0-9-]{36}$/i.test(runId))throw new IntakeError('MAXUN_SCREENSHOT_REFERENCE_INVALID');
 let reference:ReturnType<typeof screenshotReference>|undefined;
 if(/^https:\/\//.test(key)){
  try{reference=screenshotReference(key,runId);}catch{throw new IntakeError('MAXUN_SCREENSHOT_REFERENCE_INVALID');}
 }else if(!/^crawl-\d{1,3}-screenshot-(visible|fullpage)$/.test(key))throw new IntakeError('MAXUN_SCREENSHOT_REFERENCE_INVALID');
 const matches=media.flatMap((item)=>{
  const value=typeof item==='string'?item:item&&typeof item==='object'&&['image/png','image/jpeg','image/webp'].includes(item.mimeType)?item.data:undefined;
  if(typeof value!=='string')return [];
  try{
   const parsed=screenshotReference(value,runId);
   return (reference?parsed.url.href===reference.url.href:parsed.name===key)?[parsed.url]:[];
  }catch{return [];}
 });
 if(matches.length!==1)throw new IntakeError('MAXUN_SCREENSHOT_REFERENCE_INVALID');
 return matches[0];
}
export async function maxunScreenshot(media:unknown,key:string,runId:string,web=new SafeWeb()){
 const url=maxunScreenshotURL(media,key,runId);
 const response=await web.fetch(url,20*1024*1024,'image/png,image/jpeg,image/webp');
 if(response.status!==200)throw new IntakeError('MAXUN_SCREENSHOT_UNAVAILABLE');
 try{
  const decoded=sharp(response.bytes,{limitInputPixels:64_000_000,animated:false}),meta=await decoded.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'')||!meta.width||!meta.height||meta.width>8192||meta.height>65536)throw Error();
  const bytes=await decoded.rotate().flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();
  if(bytes.length>6*1024*1024)throw Error();
  const normalized=await sharp(bytes).metadata();
  return {bytes,sha256:digest(bytes),width:normalized.width!,height:normalized.height!,kind:/(?:fullpage|Full Page)$/.test(decodeURIComponent(url.pathname))?'fullpage' as const:'visible' as const};
 }catch{throw new IntakeError('MAXUN_SCREENSHOT_INVALID');}
}
