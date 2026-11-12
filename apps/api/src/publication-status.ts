/** What Post for Me says about one submitted post. Shared by the customer's "Check status" and the worker's timer. */
import {PostformeError,safeProviderURL} from './postforme-client.js';
import type {Queryable} from './learning-observations.js';

export type StatusClient={call(path:string,method?:string,body?:unknown):Promise<unknown>};
export type ObservedState='scheduled'|'processing'|'published'|'failed';
export type LocalPublication={id:string;caption:string;scheduled_at:string|Date;remote_account:string;remote_id:string|null};
export type StatusOutcome=
 {kind:'unconfirmed'}|
 {kind:'observed';remote_id:string;state:ObservedState;release_url:string|null;failure_reason:string|null;scheduled_at:string};
type RemotePost={id:string;external_id:string;caption:string;scheduled_at:string;status:string;social_accounts:{id:string}[]};

const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const time=(value:string|Date):number=>value instanceof Date?value.getTime():Date.parse(value);
function remotePost(value:unknown):RemotePost|null{
 const v=record(value);if(!v||typeof v.id!=='string'||typeof v.external_id!=='string'||typeof v.caption!=='string'||typeof v.scheduled_at!=='string'||!Number.isFinite(Date.parse(v.scheduled_at))||!Array.isArray(v.social_accounts))return null;
 return {id:v.id,external_id:v.external_id,caption:v.caption,scheduled_at:v.scheduled_at,status:typeof v.status==='string'?v.status:'',social_accounts:v.social_accounts.map(a=>({id:String(record(a)?.id??'')}))};
}
/** The provider's own words for a failure, bounded and stripped of control characters. Never an access token or a URL query. */
export function failureReason(value:unknown):string|null{
 const v=record(value),raw=typeof value==='string'?value:typeof v?.message==='string'?v.message:typeof v?.error==='string'?v.error:null;
 if(!raw)return null;
 const text=raw.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').replace(/https?:\/\/\S+/g,'[link]').replace(/\b(access_token|token|key|secret)=\S+/gi,'$1=[hidden]').trim();
 return text?text.slice(0,500):null;
}
/** Identify the post: by its remote id once known (it may have been rescheduled), otherwise by our external id plus
 * the exact caption, time and single account we submitted. Anything else stays unconfirmed. */
async function findPost(client:StatusClient,op:LocalPublication):Promise<RemotePost|null>{
 const ours=(p:RemotePost|null):p is RemotePost=>!!p&&p.external_id===op.id&&p.caption===op.caption&&p.social_accounts.length===1&&p.social_accounts[0].id===op.remote_account;
 if(op.remote_id){const p=remotePost(await client.call(`/v1/social-posts/${encodeURIComponent(op.remote_id)}`));return ours(p)&&p.id===op.remote_id?p:null;}
 const found=record(await client.call(`/v1/social-posts?external_id=${encodeURIComponent(op.id)}&limit=100`));
 if(!Array.isArray(found?.data))throw new PostformeError('POSTFORME_INVALID_RESPONSE');
 const matches=found.data.map(remotePost).filter(ours).filter(p=>Date.parse(p.scheduled_at)===time(op.scheduled_at));
 return matches.length===1?matches[0]:null;
}
export async function observePublication(client:StatusClient,op:LocalPublication):Promise<StatusOutcome>{
 const post=await findPost(client,op);if(!post)return {kind:'unconfirmed'};
 const results=record(await client.call(`/v1/social-post-results?post_id=${encodeURIComponent(post.id)}&social_account_id=${encodeURIComponent(op.remote_account)}&limit=100`));
 const mine=(Array.isArray(results?.data)?results.data:[]).map(record).filter((r):r is Record<string,unknown>=>!!r&&r.post_id===post.id&&r.social_account_id===op.remote_account);
 const success=mine.find(r=>r.success===true),failure=mine.find(r=>r.success===false);
 const state:ObservedState=success?'published':failure?'failed':post.status==='scheduled'?'scheduled':'processing';
 return {kind:'observed',remote_id:post.id,state,release_url:safeProviderURL(record(success?.platform_data)?.url),failure_reason:state==='failed'?failureReason(failure?.error)??'The social network rejected this post':null,scheduled_at:new Date(Date.parse(post.scheduled_at)).toISOString()};
}

/** Worker status checks: accepted or uncertain submissions whose time is near or past, oldest check first. */
export const STATUS_RUN_LIMIT=25;
export const statusCandidatesSQL=`SELECT p.id,p.caption,p.scheduled_at,p.remote_id,a.remote_id AS remote_account FROM app.postforme_publications p JOIN app.postforme_accounts a ON a.id=p.account_id
 WHERE p.phase IN ('accepted','unknown') AND p.observed_state IN ('unconfirmed','scheduled','processing') AND (p.observed_state='unconfirmed' OR p.scheduled_at<=$1::timestamptz+interval '10 minutes')
 AND (p.last_checked_at IS NULL OR p.last_checked_at<$1::timestamptz-interval '10 minutes') ORDER BY p.last_checked_at NULLS FIRST,p.scheduled_at,p.id LIMIT ${STATUS_RUN_LIMIT}`;
/** An uncertain submission becomes accepted only when exactly our post is found; nothing is ever resubmitted here. */
export const statusObservedSQL="UPDATE app.postforme_publications SET phase='accepted',remote_id=$2,observed_state=$3,release_url=$4,failure_reason=$5,scheduled_at=$6,error_code=NULL,last_checked_at=$7 WHERE id=$1 AND phase IN ('accepted','unknown')";
export const statusUnconfirmedSQL="UPDATE app.postforme_publications SET error_code='POSTFORME_OUTCOME_UNCONFIRMED',last_checked_at=$2 WHERE id=$1";
export type StatusRun={checked:number;changed:number;unconfirmed:number;failed:number;rate_limited:boolean};
export async function checkStatuses(deps:{pool:Queryable;client:StatusClient;now?:Date}):Promise<StatusRun>{
 const now=deps.now??new Date(),rows=(await deps.pool.query(statusCandidatesSQL,[now.toISOString()])).rows as (LocalPublication&{remote_id:string|null})[];
 const run:StatusRun={checked:0,changed:0,unconfirmed:0,failed:0,rate_limited:false};
 for(const op of rows){
  let outcome:StatusOutcome;
  try{outcome=await observePublication(deps.client,op);}
  catch(error){if(error instanceof PostformeError&&error.code==='POSTFORME_RATE_LIMITED'){run.rate_limited=true;break;}if(!(error instanceof PostformeError))throw error;run.failed++;continue;}
  run.checked++;
  if(outcome.kind==='unconfirmed'){run.unconfirmed++;await deps.pool.query(statusUnconfirmedSQL,[op.id,now.toISOString()]);continue;}
  run.changed++;await deps.pool.query(statusObservedSQL,[op.id,outcome.remote_id,outcome.state,outcome.release_url,outcome.failure_reason,outcome.scheduled_at,now.toISOString()]);
 }
 return run;
}
