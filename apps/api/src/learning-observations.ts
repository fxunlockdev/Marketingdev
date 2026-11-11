/** Published Post for Me posts as analysis observations. Preserve provider values; never infer zeros, daily deltas or growth. */
export type Queryable={query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
export type PostFormat='static'|'carousel'|'video'|'story';
export type FeedPost={id:string;account_id:string;caption:string;posted_at:string|null;url:string|null;metrics:Record<string,number>};
export type FeedRow={account_id:string;posts:unknown;updated_at:string|Date};
export type PublishedRow={publication_id:string;caption:string;scheduled_at:string|Date;release_url:string|null;account_id:string;provider:string;account_name:string;slot_format?:string|null;carousel_version_id?:string|null;video_version_id?:string|null;placement?:string|null}&Record<string,unknown>;
export type MetricSeries={label:string;points:{date:string;value:number}[]};
export type Observation={id:string;publication_id:string;source:'postforme';caption:string;scheduled_at:string;posted_at:string|null;provider:string;account_name:string;format:PostFormat;semantics:'lifetime';metrics:Record<string,number>;series:MetricSeries[];collected_at:string;hours_since_publish:number|null};

export const OBSERVATION_LIMIT=20;
const MATCH_WINDOW_MS=6*3600000;
/** Latest published posts with their destination account. Row-level security scopes this to the current business. */
export const postformePublishedSQL=`SELECT p.id AS publication_id,p.caption,p.scheduled_at,p.release_url,p.account_id,a.platform AS provider,a.username AS account_name,s.format AS slot_format,s.carousel_version_id,s.video_version_id,p.proof->>'placement' AS placement FROM app.postforme_publications p JOIN app.postforme_accounts a ON a.id=p.account_id JOIN app.content_slots s ON s.id=p.slot_id WHERE p.phase='accepted' AND p.observed_state='published' ORDER BY p.scheduled_at DESC,p.id LIMIT ${OBSERVATION_LIMIT}`;
export const postformeFeedsSQL='SELECT account_id,posts,updated_at FROM app.postforme_analytics ORDER BY account_id';

const iso=(value:unknown):string|null=>{const time=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)?new Date(time).toISOString():null;};
export function normaliseProviderURL(value:unknown):string|null{
 try{const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password)return null;return `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/,'')}`;}catch{return null;}
}
function feedMetrics(value:unknown):Record<string,number>{
 const metrics:Record<string,number>={};if(!value||typeof value!=='object'||Array.isArray(value))return metrics;
 for(const [key,v] of Object.entries(value))if(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key)&&typeof v==='number'&&Number.isFinite(v)&&v>=0)metrics[key]=v;
 return metrics;
}
/** Re-validate stored feed JSON: it is provider data, not a trusted shape. */
export function feedPosts(row:FeedRow):FeedPost[]{
 if(!Array.isArray(row.posts))return [];
 return row.posts.flatMap((raw:unknown):FeedPost[]=>{
  if(!raw||typeof raw!=='object')return [];const p=raw as Record<string,unknown>;if(typeof p.id!=='string'||!p.id)return [];
  return [{id:p.id,account_id:typeof p.account_id==='string'?p.account_id:row.account_id,caption:typeof p.caption==='string'?p.caption:'',posted_at:iso(p.posted_at),url:typeof p.url==='string'?p.url:null,metrics:feedMetrics(p.metrics)}];
 });
}
/** The release link identifies the post. Without one, accept only a single same-account post with the same caption near the scheduled time. */
export function matchFeedPost(published:PublishedRow,posts:FeedPost[]):FeedPost|null{
 const own=posts.filter(p=>p.account_id===published.account_id),link=normaliseProviderURL(published.release_url);
 if(link)return own.find(p=>normaliseProviderURL(p.url)===link)??null;
 const at=Date.parse(iso(published.scheduled_at)??''),caption=published.caption.trim();if(!caption||!Number.isFinite(at))return null;
 const candidates=own.filter(p=>p.caption.trim()===caption&&p.posted_at!==null&&Math.abs(Date.parse(p.posted_at)-at)<=MATCH_WINDOW_MS);
 return candidates.length===1?candidates[0]:null;
}
export function publishedFormat(row:PublishedRow):PostFormat{return row.carousel_version_id?'carousel':row.video_version_id||row.slot_format==='video'?'video':row.placement==='story'?'story':'static';}
export function metricSeries(metrics:Record<string,number>,collectedAt:string):MetricSeries[]{
 return Object.keys(metrics).sort().map(label=>({label,points:[{date:collectedAt.slice(0,10),value:metrics[label]}]}));
}
function hoursBetween(from:string|null,to:string):number|null{if(!from)return null;const hours=(Date.parse(to)-Date.parse(from))/3600000;return hours>=0?Math.round(hours*10)/10:null;}

export type Measurement={metrics:Record<string,number>;collected_at:string;posted_at:string|null};
export function observation(row:PublishedRow,measured:Measurement):Observation|null{
 const scheduled=iso(row.scheduled_at);if(!scheduled||!Object.keys(measured.metrics).length)return null;
 return {id:row.publication_id,publication_id:row.publication_id,source:'postforme',caption:row.caption,scheduled_at:scheduled,posted_at:measured.posted_at,provider:row.provider,account_name:row.account_name,format:publishedFormat(row),semantics:'lifetime',metrics:measured.metrics,series:metricSeries(measured.metrics,measured.collected_at),collected_at:measured.collected_at,hours_since_publish:hoursBetween(measured.posted_at??scheduled,measured.collected_at)};
}
export function feedMeasurements(published:PublishedRow[],feeds:FeedRow[]):Map<string,Measurement>{
 const out=new Map<string,Measurement>();
 for(const row of feeds){const collected=iso(row.updated_at);if(!collected)continue;const posts=feedPosts(row);
  for(const p of published){if(p.account_id!==row.account_id)continue;const hit=matchFeedPost(p,posts);if(hit)out.set(p.publication_id,{metrics:hit.metrics,collected_at:collected,posted_at:hit.posted_at});}
 }
 return out;
}
export function postformeObservations(published:PublishedRow[],feeds:FeedRow[]):Observation[]{
 const measured=feedMeasurements(published,feeds);
 return published.flatMap(row=>{const m=measured.get(row.publication_id),o=m?observation(row,m):null;return o?[o]:[];});
}
export async function readPostformeObservations(db:Queryable):Promise<{published:number;observations:Observation[]}>{
 const published=(await db.query(postformePublishedSQL)).rows as PublishedRow[];if(!published.length)return {published:0,observations:[]};
 const feeds=(await db.query(postformeFeedsSQL)).rows as FeedRow[];
 return {published:published.length,observations:postformeObservations(published,feeds)};
}
