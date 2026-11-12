import {PostformeError,providerFeed} from './postforme-client.js';
import {matchFeedPost,type FeedPost,type PublishedRow,type Queryable} from './learning-observations.js';
/** Scheduled collection of Post for Me metrics for published posts. Each snapshot is the provider's lifetime total at that moment. */
export const SYNC_CHECKPOINTS=[{id:'1h',hours:1},{id:'24h',hours:24},{id:'72h',hours:72},{id:'7d',hours:168},{id:'30d',hours:720}] as const;
export type CheckpointId=typeof SYNC_CHECKPOINTS[number]['id'];
export const SYNC_RUN_LIMIT=50;
export const SYNC_ACCOUNT_LIMIT=10;
/** Posts older than this are never collected for the first time: their 30-day window has passed. */
export const SYNC_WINDOW_DAYS=45;
export type SyncPost={publication_id:string;published_at:string|Date;collected:readonly string[]};
export type DuePost<T extends SyncPost>=T&{checkpoint:CheckpointId;due_at:string};
export type SyncClient={call(path:string):Promise<unknown>};
export type SyncResult={due:number;collected:number;missing:number;accounts:number;failed_accounts:number;rate_limited:boolean};
type Candidate=SyncPost&PublishedRow&{organization_id:string;brand_id:string;remote_id:string};

const time=(value:string|Date):number=>value instanceof Date?value.getTime():Date.parse(value);
/**
 * A post is due when its most recent elapsed checkpoint has not been collected. Earlier checkpoints that were
 * missed are not backfilled, because a later reading cannot stand in for an earlier one. Oldest due first; bounded per run.
 */
export function dueForSync<T extends SyncPost>(posts:readonly T[],now:Date,limit:number=SYNC_RUN_LIMIT):DuePost<T>[]{
 const due=posts.flatMap((post):DuePost<T>[]=>{
  const published=time(post.published_at),age=now.getTime()-published;if(!Number.isFinite(published)||age>SYNC_WINDOW_DAYS*86400000)return [];
  const reached=SYNC_CHECKPOINTS.filter(c=>age>=c.hours*3600000).at(-1);if(!reached||post.collected.includes(reached.id))return [];
  return [{...post,checkpoint:reached.id,due_at:new Date(published+reached.hours*3600000).toISOString()}];
 });
 return [...due].sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.publication_id.localeCompare(b.publication_id)).slice(0,Math.max(0,limit));
}
export const syncCandidatesSQL=`SELECT p.id AS publication_id,p.organization_id,p.brand_id,p.account_id,p.caption,p.scheduled_at,p.scheduled_at AS published_at,p.release_url,a.remote_id,COALESCE((SELECT array_agg(m.checkpoint) FROM app.postforme_post_metrics m WHERE m.publication_id=p.id),'{}') AS collected FROM app.postforme_publications p JOIN app.postforme_accounts a ON a.id=p.account_id WHERE p.phase='accepted' AND p.observed_state='published' AND a.status='connected' AND p.scheduled_at<=$1 AND p.scheduled_at>$1::timestamptz-interval '${SYNC_WINDOW_DAYS} days' ORDER BY p.scheduled_at DESC,p.id LIMIT 500`;
export const syncSnapshotSQL='INSERT INTO app.postforme_post_metrics(publication_id,organization_id,brand_id,account_id,checkpoint,state,metrics,posted_at,collected_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(publication_id,checkpoint) DO NOTHING';

function accountFeed(value:unknown,remote:string,local:string):FeedPost[]|null{
 const data=(value as {data?:unknown}|null)?.data;if(!Array.isArray(data))return null;
 return data.flatMap((raw:unknown):FeedPost[]=>{try{return [providerFeed(raw,remote,local)];}catch{return [];}});
}
function byAccount<T extends {remote_id:string}>(posts:readonly T[]):Map<string,T[]>{
 const groups=new Map<string,T[]>();for(const post of posts)groups.set(post.remote_id,[...(groups.get(post.remote_id)??[]),post]);return groups;
}
/**
 * Fetch each due account's feed once through the existing client (its fixed origin, timeout and response bound apply)
 * and append one snapshot per due post. Safe to run concurrently or repeat: a checkpoint is written at most once.
 * A rate limit ends the run; any other account failure is skipped and retried on the next run.
 */
export async function collect(deps:{pool:Queryable;client:SyncClient;now?:Date;limit?:number;maxAccounts?:number}):Promise<SyncResult>{
 const now=deps.now??new Date(),candidates=(await deps.pool.query(syncCandidatesSQL,[now.toISOString()])).rows as Candidate[];
 const due=dueForSync(candidates,now,deps.limit??SYNC_RUN_LIMIT),accounts=[...byAccount(due)].slice(0,deps.maxAccounts??SYNC_ACCOUNT_LIMIT);
 const result={due:due.length,collected:0,missing:0,accounts:0,failed_accounts:0,rate_limited:false};
 for(const [remote,posts] of accounts){
  let feed:FeedPost[]|null;
  try{feed=accountFeed(await deps.client.call(`/v1/social-account-feeds/${encodeURIComponent(remote)}?limit=50&expand=metrics`),remote,posts[0].account_id);}
  catch(error){if(error instanceof PostformeError&&error.code==='POSTFORME_RATE_LIMITED'){result.rate_limited=true;break;}if(!(error instanceof PostformeError))throw error;feed=null;}
  if(!feed){result.failed_accounts++;continue;}
  result.accounts++;
  for(const post of posts){
   const hit=matchFeedPost(post,feed),available=!!hit&&Object.keys(hit.metrics).length>0;
   await deps.pool.query(syncSnapshotSQL,[post.publication_id,post.organization_id,post.brand_id,post.account_id,post.checkpoint,available?'available':'missing',JSON.stringify(available?hit.metrics:{}),hit?.posted_at??null,now.toISOString()]);
   if(available)result.collected++;else result.missing++;
  }
 }
 return result;
}
