/** Agent Reach (github.com/Panniantong/Agent-Reach, MIT) as an onboarding research source.
 * Pure: no process, network or database access. Only login-free channels exist here: web search
 * (Exa's hosted search), web page reads (Jina Reader, then Exa) and YouTube search, info and
 * subtitles (yt-dlp). Every channel that needs a login or browser cookies is refused. */
import {canonicalJSON,hash} from './brand-brain.js';
import {IntakeError,websiteURL} from './safe-web.js';
import type {WebsitePage} from './website-evidence.js';

export const AGENT_REACH_PIN={repository:'https://github.com/Panniantong/Agent-Reach',commit:'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',version:'1.6.1'} as const;
/** brand_sources.parser_version of every Agent Reach source. */
export const AGENT_REACH_VERSION='agent-reach-v1';
export const RUNNER_VERSION='agent-reach-runner-v1';

export type ReachChannel='web'|'youtube';
export type ReachAction='search'|'read'|'subtitle';
export type ReachPurpose='own_page'|'business_search'|'competitor_page'|'competitor_search'|'video_search'|'video_subtitle';
/** The only (channel, action) pairs that can ever run. YouTube transcription is left out: it would
 * need a model key inside a networked sandbox that handles untrusted pages. */
export const ALLOWED_ACTIONS:readonly (readonly [ReachChannel,ReachAction])[]=[['web','search'],['web','read'],['youtube','search'],['youtube','read'],['youtube','subtitle']];
/** Agent Reach channels that need a login, browser cookies or a paid key. Never used. */
export const REFUSED_CHANNELS=['twitter','reddit','facebook','instagram','linkedin','xiaohongshu','bilibili','boss','xueqiu','xiaoyuzhou','v2ex','github'] as const;
/** Sites behind those logins. Their URLs are never read, not even through the web channel. */
const LOGIN_HOSTS=['instagram.com','facebook.com','fb.com','fb.me','x.com','twitter.com','t.co','reddit.com','redd.it','linkedin.com','lnkd.in','xiaohongshu.com','xhslink.com','tiktok.com','threads.net','bilibili.com','zhipin.com','xueqiu.com'];

export const REACH_LIMITS={
 searches:3,reads:8,videos:3,videoSearches:2,subtitles:1,
 /** Whole Agent Reach step, and the extra wait allowed once the other research has settled. */
 totalMs:45000,graceMs:2500,taskSeconds:15,concurrency:4,
 pageChars:4000,chunkChars:2000,snippetChars:600,subtitleChars:2000,totalChars:24000,
 itemsPerEnvelope:10,itemChars:20000,
} as const;

export class AgentReachRefused extends Error{constructor(readonly code:string){super(code);}}

export type ReachTask={id:number;channel:ReachChannel;action:ReachAction;params:{target?:string;query?:string;limit?:number};purpose:ReachPurpose;subject:string;timeout:number};
export type ReachItem={title:string|null;url:string|null;author:string|null;published_at:string|null;text:string|null};
export type ReachEnvelope={ok:boolean;channel:ReachChannel;action:ReachAction;backend:string|null;items:ReachItem[];error:{code:string;message:string}|null;attempts:{backend:string;result:string}[]};
export type ReachPage=Omit<WebsitePage,'coverage'>&{coverage:'agent_reach_page_text'|'agent_reach_market';origin:'own'|'market';channel:ReachChannel;action:ReachAction;provider:string;title:string|null;retrievedAt:string;purpose:ReachPurpose};

const bare=(host:string)=>host.toLowerCase().replace(/^www\./,'');
export const hostOf=(url:string):string=>{try{return bare(new URL(url).hostname);}catch{return '';}};
const sameSite=(a:string,b:string)=>!!a&&!!b&&(a===b||a.endsWith('.'+b)||b.endsWith('.'+a));
export function loginWalled(url:string):boolean{const host=hostOf(url);return LOGIN_HOSTS.some(h=>host===h||host.endsWith('.'+h));}
const clean=(value:unknown,max:number):string|null=>typeof value==='string'&&value.trim()?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max):null;

/** A public URL with tracking parameters and the fragment removed: the cache and dedupe key. */
export function normalizeTarget(raw:string):string{
 const url=websiteURL(raw,true);
 for(const name of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(name))url.searchParams.delete(name);
 if(url.pathname.length>1&&url.pathname.endsWith('/'))url.pathname=url.pathname.slice(0,-1);
 return url.href;
}
const youtubeVideo=(raw:string):string|null=>{
 try{const u=new URL(raw),host=bare(u.hostname),id=host==='youtu.be'?u.pathname.slice(1):host.endsWith('youtube.com')?u.searchParams.get('v'):null;
  return id&&/^[A-Za-z0-9_-]{11}$/.test(id)?`https://www.youtube.com/watch?v=${id}`:null;}catch{return null;}
};

/** Validate one task against the allow-list. Throws AgentReachRefused for anything else. */
export function reachTask(input:{id:number;channel:string;action:string;params:Record<string,unknown>;purpose:ReachPurpose;subject?:string;timeout?:number}):ReachTask{
 if(!ALLOWED_ACTIONS.some(([c,a])=>c===input.channel&&a===input.action))throw new AgentReachRefused('AGENT_REACH_CHANNEL_REFUSED');
 if(!Number.isSafeInteger(input.id)||input.id<1||input.id>64)throw new AgentReachRefused('AGENT_REACH_TASK_INVALID');
 const channel=input.channel as ReachChannel,action=input.action as ReachAction,timeout=Math.min(REACH_LIMITS.taskSeconds,Math.max(1,Math.floor(input.timeout??REACH_LIMITS.taskSeconds)));
 const subject=clean(input.subject??'',200)??'';
 if(action==='search'){
  const query=clean(input.params.query,200),limit=Number(input.params.limit??3);
  if(!query||!Number.isInteger(limit)||limit<1||limit>5)throw new AgentReachRefused('AGENT_REACH_TASK_INVALID');
  return {id:input.id,channel,action,params:{query,limit},purpose:input.purpose,subject,timeout};
 }
 const raw=typeof input.params.target==='string'?input.params.target:'';
 let target:string;
 try{target=channel==='youtube'?youtubeVideo(raw)??'':normalizeTarget(raw);}catch{target='';}
 if(!target||loginWalled(target))throw new AgentReachRefused('AGENT_REACH_TARGET_REFUSED');
 return {id:input.id,channel,action,params:{target},purpose:input.purpose,subject,timeout};
}
/** The cache and ledger key of a task: what it asks, never who asked. */
export function taskTarget(task:ReachTask):string{return task.params.target??`${task.params.query} [limit ${task.params.limit}]`;}
export function taskKey(task:ReachTask):string{return hash(canonicalJSON({channel:task.channel,action:task.action,target:taskTarget(task)}));}

/** Strict parse of one Agent Reach result envelope (schema_version 1) for the task that asked. */
export function parseEnvelope(value:unknown,task:Pick<ReachTask,'channel'|'action'>):ReachEnvelope{
 const v=value as Record<string,unknown>|null;
 if(!v||typeof v!=='object'||Array.isArray(v)||v.schema_version!==1||typeof v.ok!=='boolean'||v.channel!==task.channel||v.action!==task.action||!Array.isArray(v.items))throw new IntakeError('AGENT_REACH_OUTPUT_INVALID');
 const meta=v.meta as {attempts?:unknown}|undefined,error=v.error as {code?:unknown;message?:unknown}|null|undefined;
 const attempts=(Array.isArray(meta?.attempts)?meta!.attempts:[]).slice(0,8).flatMap(a=>{const r=a as {backend?:unknown;result?:unknown};const backend=clean(r?.backend,60),result=clean(r?.result,60);return backend&&result?[{backend,result}]:[];});
 if(!v.ok){
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z_]{1,40}$/.test(error.code)?error.code:'UPSTREAM_BROKEN';
  return {ok:false,channel:task.channel,action:task.action,backend:null,items:[],error:{code,message:clean(error?.message,300)??''},attempts};
 }
 const items=v.items.slice(0,REACH_LIMITS.itemsPerEnvelope).map(raw=>{
  const i=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
  return {title:clean(i.title,300),url:clean(i.url,2048),author:clean(i.author,200),published_at:clean(i.published_at,60),text:clean(i.text,REACH_LIMITS.itemChars)};
 });
 return {ok:true,channel:task.channel,action:task.action,backend:clean(v.backend,40),items,error:null,attempts};
}
/** Which outside service answered: Jina or Exa for the web, yt-dlp (YouTube itself) for video. */
export function reachProvider(envelope:Pick<ReachEnvelope,'channel'|'backend'>):'jina'|'exa'|'yt-dlp'{
 if(envelope.channel==='youtube')return 'yt-dlp';
 return envelope.backend==='jina'?'jina':'exa';
}

/** Same-site page links in a page read (Jina returns Markdown), for the follow-up own-page reads. */
export function ownLinks(text:string,root:string):string[]{
 const host=hostOf(root),out:string[]=[];
 for(const match of text.matchAll(/\]\((https?:\/\/[^)\s]{1,2000})\)/g)){
  try{const url=normalizeTarget(match[1]),u=new URL(url);if(sameSite(bare(u.hostname),host)&&!u.search&&/about|product|service|menu|pric|shop|collection|offer|story|team/i.test(u.pathname)&&!out.includes(url)&&url!==normalizeTarget(root))out.push(url);}catch{/* not a public link */}
 }
 return out.slice(0,10);
}

function chunks(text:string,anchor:string):{text:string;anchor:string}[]{
 const out:{text:string;anchor:string}[]=[];let rest=text;
 while(rest.length&&out.length<4){
  let cut=rest.length<=REACH_LIMITS.chunkChars?rest.length:rest.lastIndexOf('\n\n',REACH_LIMITS.chunkChars);
  if(cut<REACH_LIMITS.chunkChars/2)cut=Math.min(rest.length,REACH_LIMITS.chunkChars);
  const piece=rest.slice(0,cut).trim();if(piece)out.push({text:piece,anchor:`${anchor}:${out.length}`});rest=rest.slice(cut);
 }
 return out;
}
const LABEL:Record<ReachPurpose,string>={own_page:"Public page text from the business's own website",business_search:'Web search result about the business',competitor_page:'Public page text from a competitor or third-party website',competitor_search:'Web search result about a competitor',video_search:'YouTube video listing',video_subtitle:'YouTube video subtitles'};
function page(task:ReachTask,envelope:ReachEnvelope,item:ReachItem,url:string,body:string,max:number,origin:'own'|'market',retrievedAt:string):ReachPage|null{
 const text=body.replace(/\n{3,}/g,'\n\n').trim().slice(0,max);
 if(text.length<40)return null;
 const provider=reachProvider(envelope),header=`${LABEL[task.purpose]} (Agent Reach ${task.channel} ${task.action} via ${provider}, retrieved ${retrievedAt}${task.subject?`, about ${task.subject}`:''}). ${origin==='own'?'Observed public text, not approved brand identity.':'Third-party evidence for analysis only: not a fact about this business and never wording to copy.'}\nTitle: ${item.title??'(none)'}\nURL: ${url}\n\n`;
 const anchor=`agent-reach:${task.channel}-${task.action}:${hash(url).slice(0,16)}`,parts=chunks(header+text,anchor);
 return {parserVersion:AGENT_REACH_VERSION,url,sha256:hash(canonicalJSON(parts.map(p=>p.text))),chunks:parts,links:[],truncated:body.length>max,coverage:origin==='own'?'agent_reach_page_text':'agent_reach_market',origin,channel:task.channel,action:task.action,provider,title:item.title,retrievedAt,purpose:task.purpose};
}
/** Turn one result into sized evidence pages. `ownSite` decides which pages are the business's own. */
export function sizeEvidence(task:ReachTask,envelope:ReachEnvelope,ownSite:string,retrievedAt:string):ReachPage[]{
 if(!envelope.ok)return [];
 const own=hostOf(ownSite),out:ReachPage[]=[];
 const originOf=(url:string)=>task.channel==='web'&&sameSite(hostOf(url),own)?'own':'market';
 for(const item of envelope.items){
  let url:string;
  try{url=task.channel==='youtube'?youtubeVideo(item.url??task.params.target??'')??'':normalizeTarget(task.action==='read'?task.params.target!:item.url??'');}catch{continue;}
  if(!url||loginWalled(url))continue;
  const body=task.action==='search'&&task.channel==='youtube'?[item.author?`Channel: ${item.author}`:'',item.text??''].filter(Boolean).join('\n'):item.text??'';
  const max=task.action==='read'&&task.channel==='web'?REACH_LIMITS.pageChars:task.action==='subtitle'?REACH_LIMITS.subtitleChars:REACH_LIMITS.snippetChars;
  const built=page(task,envelope,item,url,body,max,originOf(url),retrievedAt);
  if(built)out.push(built);
  if(task.action==='read'||task.action==='subtitle')break;
 }
 return out;
}
/** One page per URL (reads win over search snippets), no repeated content, and a total size cap. */
export function dedupePages(pages:ReachPage[],skipUrls:ReadonlySet<string>=new Set()):ReachPage[]{
 const rank=(p:ReachPage)=>p.action==='read'||p.action==='subtitle'?0:1;
 const sorted=[...pages].sort((a,b)=>rank(a)-rank(b)),byUrl=new Map<string,ReachPage>(),seen=new Set<string>();
 let total=0;
 for(const p of sorted){
  if(byUrl.has(p.url)||skipUrls.has(p.url)||seen.has(p.sha256))continue;
  const size=p.chunks.reduce((n,c)=>n+c.text.length,0);
  if(total+size>REACH_LIMITS.totalChars)continue;
  total+=size;seen.add(p.sha256);byUrl.set(p.url,p);
 }
 return [...byUrl.values()];
}

/** What to look up first, from the saved answers only: the business name and market, competitor
 * names, and the website. Nothing else about the business leaves Desvio. */
export type ReachInput={website:string;name:string;market:string;competitors:readonly string[]};
export function reachInput(website:string,brief:{market?:string;details?:{business_name?:string;competitors?:readonly string[]}}|null|undefined):ReachInput{
 const name=clean(brief?.details?.business_name,120)??hostOf(website);
 return {website:normalizeTarget(website),name,market:clean(brief?.market,120)??'',competitors:(brief?.details?.competitors??[]).flatMap(c=>clean(c,120)??[]).slice(0,3)};
}
const asSite=(value:string):string|null=>{
 const candidate=/^https?:\/\//i.test(value)?value:/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value)?`https://${value}`:null;
 if(!candidate)return null;
 try{const url=normalizeTarget(candidate);return loginWalled(url)?null:url;}catch{return null;}
};
type Draft=Omit<ReachTask,'id'|'timeout'>;
export function initialTasks(input:ReachInput):Draft[]{
 const q=(...parts:string[])=>parts.filter(Boolean).join(' ').slice(0,200);
 const drafts:Draft[]=[{channel:'web',action:'read',params:{target:input.website},purpose:'own_page',subject:input.name}];
 drafts.push({channel:'web',action:'search',params:{query:q(input.name,input.market),limit:5},purpose:'business_search',subject:input.name});
 input.competitors.forEach((c,i)=>{
  const site=asSite(c);
  if(site)drafts.push({channel:'web',action:'read',params:{target:site},purpose:'competitor_page',subject:c});
  if(i<REACH_LIMITS.searches-1)drafts.push({channel:'web',action:'search',params:{query:q(site?hostOf(site):c,input.market),limit:3},purpose:'competitor_search',subject:c});
 });
 const first=input.competitors[0];
 drafts.push({channel:'youtube',action:'search',params:{query:q(input.name,input.market),limit:first?2:3},purpose:'video_search',subject:input.name});
 if(first)drafts.push({channel:'youtube',action:'search',params:{query:q(asSite(first)?hostOf(asSite(first)!):first),limit:1},purpose:'video_search',subject:first});
 return drafts;
}
/** Follow-ups once a result is in: the own site's key pages, each competitor's site and the top
 * search hit, and the subtitles of the business's top video. */
export function followUps(task:ReachTask,envelope:ReachEnvelope,input:ReachInput):Draft[]{
 if(!envelope.ok)return [];
 if(task.purpose==='own_page')return ownLinks(envelope.items[0]?.text??'',input.website).slice(0,2).map(target=>({channel:'web',action:'read',params:{target},purpose:'own_page',subject:task.subject}));
 if(task.purpose==='competitor_search'){
  const own=hostOf(input.website),hits=envelope.items.flatMap(i=>{try{const u=normalizeTarget(i.url??'');return loginWalled(u)||sameSite(hostOf(u),own)?[]:[u];}catch{return [];}});
  return hits.slice(0,asSite(task.subject)?1:2).map(target=>({channel:'web',action:'read',params:{target},purpose:'competitor_page',subject:task.subject}));
 }
 if(task.purpose==='video_search'&&task.subject===input.name){
  const video=envelope.items.map(i=>youtubeVideo(i.url??'')).find(Boolean);
  return video?[{channel:'youtube',action:'subtitle',params:{target:video},purpose:'video_subtitle',subject:task.subject}]:[];
 }
 return [];
}
/** Whether a further task still fits the per-run bounds. */
export function withinBounds(done:readonly ReachTask[],next:Draft):boolean{
 const count=(f:(t:Draft)=>boolean)=>done.filter(f).length;
 if(next.channel==='web'&&next.action==='search')return count(t=>t.channel==='web'&&t.action==='search')<REACH_LIMITS.searches;
 if(next.channel==='web'&&next.action==='read')return count(t=>t.channel==='web'&&t.action==='read')<REACH_LIMITS.reads;
 if(next.action==='subtitle')return count(t=>t.action==='subtitle')<REACH_LIMITS.subtitles;
 if(next.channel==='youtube'&&next.action==='search')return count(t=>t.channel==='youtube'&&t.action==='search')<REACH_LIMITS.videoSearches;
 return false;
}
