import {Parser} from 'htmlparser2';
import {createRequire} from 'node:module';
import {SafeWeb,IntakeError,websiteURL} from './safe-web.js';
import {hash} from './brand-brain.js';
import type {WebsitePage} from './website-evidence.js';
const robotsParser=createRequire(import.meta.url)('robots-parser');
// Public, server-rendered text only. Never execute page scripts or treat text as instructions.
export function websiteText(html:string,url:string):WebsitePage{
 const blocks:string[]=[];const links=new Set<string>();let text='';
 const stack:Array<{text:boolean;links:boolean}>=[];
 const flush=()=>{const clean=text.replace(/\s+/g,' ').trim();if(clean.length>=40)blocks.push(clean.slice(0,4000));text='';};
 const excluded=new Set(['script','style','noscript','svg','form','template']);
 const navigation=new Set(['nav','footer','header']);
 const boundaries=new Set(['p','div','section','article','main','h1','h2','h3','h4','h5','h6','li','ul','ol','blockquote','table','tr','td','br']);
 const parser=new Parser({onopentag(name,a){
  const parent=stack.at(-1);
  const hidden=excluded.has(name)||a.hidden!==undefined||a['aria-hidden']==='true';
  const state={text:!!parent?.text||hidden||navigation.has(name),links:!!parent?.links||hidden};
  stack.push(state);
  // Navigation is not brand evidence, but its visible links locate useful pages.
  if(!state.links&&name==='a'&&a.href){try{const u=websiteURL(new URL(a.href,url).href);u.hash='';if(u.origin===new URL(url).origin&&/about|project|residential|commercial|service|product/i.test(u.pathname)&&links.size<12)links.add(u.href);}catch{}}
  // Inline markup is part of the same sentence. Flushing at every span/strong
  // discarded short fragments and could make a content-rich site appear empty.
  if(!state.text&&boundaries.has(name))flush();
 },ontext(value){if(!stack.at(-1)?.text&&text.length<8000)text+=value+' ';},onclosetag(name){if(!stack.at(-1)?.text&&boundaries.has(name))flush();stack.pop();}},{decodeEntities:true});parser.end(html);flush();
 const unique=[...new Set(blocks)];let size=0;const chunks=unique.filter(t=>{size+=t.length;return size<=24000;}).map(text=>({text,anchor:'html:'+hash(text)}));
 return {parserVersion:'website-text-v3',url,sha256:hash(chunks.map(c=>c.text).join('\n')),chunks,links:[...links],truncated:size>24000,coverage:'server_html_only'};
}
export class WebsiteText{
 constructor(readonly web:Pick<SafeWeb,'fetch'>=new SafeWeb()){}
 async capture(input:string):Promise<WebsitePage[]>{
  const root=websiteURL(input),domain=root.hostname.replace(/^www\./,''),rules=new Map<string,any>();let requests=0;const started=Date.now();
  const fetch=async(u:URL,max:number,accept:string)=>{if(++requests>12||Date.now()-started>35000)throw new IntakeError('WEBSITE_TEXT_LIMIT');return this.web.fetch(u,max,accept,5000);};
  const get=async(raw:string)=>{
   let u=websiteURL(raw);
   for(let redirect=0;redirect<4;redirect++){
    if(u.hostname.replace(/^www\./,'')!==domain)throw new IntakeError('WEBSITE_TEXT_FOREIGN_REDIRECT');
    if(!rules.has(u.origin)){
     const robots=new URL('/robots.txt',u),r=await fetch(robots,256*1024,'text/plain');
     if(r.status===404||r.status===410)rules.set(u.origin,null);
     else if(r.status===200)rules.set(u.origin,robotsParser(robots.href,r.bytes.toString('utf8')));
     else throw new IntakeError('WEBSITE_TEXT_ROBOTS_UNAVAILABLE');
    }
    if(rules.get(u.origin)?.isAllowed(u.href,'DesvioBot')===false)throw new IntakeError('WEBSITE_TEXT_DISALLOWED');
    const r=await fetch(u,2*1024*1024,'text/html');
    if([301,302,303,307,308].includes(r.status)&&typeof r.headers.location==='string'){u=websiteURL(new URL(r.headers.location,u).href);continue;}
    if(r.status!==200||!/^text\/html(?:;|$)/i.test(String(r.headers['content-type']??'')))throw new IntakeError('WEBSITE_TEXT_UNAVAILABLE');
    return websiteText(r.bytes.toString('utf8'),u.href);
   }throw new IntakeError('WEBSITE_TEXT_REDIRECT_LIMIT');
  };
  const first=await get(root.href),pages:WebsitePage[]=[];
  if(first.chunks.reduce((n,c)=>n+c.text.length,0)>=160)pages.push(first);
  for(const link of first.links.slice(0,3)){
   if(link===first.url)continue;
   try{const page=await get(link);if(page.chunks.reduce((n,c)=>n+c.text.length,0)>=160&&!pages.some(p=>p.sha256===page.sha256))pages.push(page);}catch{/* Keep usable pages when another page is unavailable. */}
  }
  if(!pages.length)throw new IntakeError('AI_RESEARCH_NO_SOURCES');return pages;
 }
}
