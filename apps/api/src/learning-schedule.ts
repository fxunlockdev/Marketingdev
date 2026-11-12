import {collect,type SyncClient,type SyncResult} from './learning-sync.js';
import type {Queryable} from './learning-observations.js';

/** How often the worker collects Post for Me metrics for published posts. */
export const LEARNING_SYNC_INTERVAL_MS=15*60*1000;

/** One collection run at a time: a tick that finds the previous run still going does nothing.
 * Errors are reported, never thrown, so a timer can call this safely. Resolves null when skipped or failed. */
export function learningSyncTick(deps:{pool:Queryable;client:SyncClient;onError:(error:unknown)=>void;now?:()=>Date}):()=>Promise<SyncResult|null>{
 let running=false;
 return async()=>{
  if(running)return null;
  running=true;
  try{return await collect({pool:deps.pool,client:deps.client,...(deps.now?{now:deps.now()}:{})});}
  catch(error){deps.onError(error);return null;}
  finally{running=false;}
 };
}
