import {collect,type SyncClient,type SyncResult} from './learning-sync.js';
import {checkStatuses,type StatusClient,type StatusRun} from './publication-status.js';
import type {Queryable} from './learning-observations.js';

/** How often the worker checks publishing status and collects Post for Me metrics for published posts. */
export const LEARNING_SYNC_INTERVAL_MS=15*60*1000;
export type TickResult=SyncResult&{status:StatusRun};

/** One run at a time: a tick that finds the previous run still going does nothing. Each run first checks the status of
 * scheduled posts (so a post published since the last run is collected in this one), then collects metrics.
 * Errors are reported, never thrown, so a timer can call this safely. Resolves null when skipped or failed. */
export function learningSyncTick(deps:{pool:Queryable;client:SyncClient&StatusClient;onError:(error:unknown)=>void;now?:()=>Date}):()=>Promise<TickResult|null>{
 let running=false;
 return async()=>{
  if(running)return null;
  running=true;
  try{
   const now=deps.now?.(),at=now?{now}:{};
   const status=await checkStatuses({pool:deps.pool,client:deps.client,...at});
   return {...await collect({pool:deps.pool,client:deps.client,...at}),status};
  }
  catch(error){deps.onError(error);return null;}
  finally{running=false;}
 };
}
