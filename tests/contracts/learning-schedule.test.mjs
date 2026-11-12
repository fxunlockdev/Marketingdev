import test from 'node:test';
import assert from 'node:assert/strict';
import {learningSyncTick,LEARNING_SYNC_INTERVAL_MS} from '../../dist/learning-schedule.js';

test('scheduled learning sync runs every 15 minutes, one run at a time, and reports errors instead of throwing',async()=>{
 assert.equal(LEARNING_SYNC_INTERVAL_MS,900000);
 let release,queries=0;const errors=[];
 const gate=new Promise(resolve=>{release=resolve;});
 const pool={query:async()=>{queries++;await gate;return {rows:[]};}};
 const tick=learningSyncTick({pool,client:{call:async()=>({data:[]})},onError:e=>errors.push(e)});
 const first=tick(),second=await tick();
 assert.equal(second,null,'a tick during a running collection is skipped');assert.equal(queries,1);
 release();
 assert.deepEqual(await first,{due:0,collected:0,missing:0,accounts:0,failed_accounts:0,rate_limited:false});
 assert.notEqual(await tick(),null,'the next tick runs again');assert.equal(queries,2);
 const failing=learningSyncTick({pool:{query:async()=>{throw new Error('database down');}},client:{call:async()=>({})},onError:e=>errors.push(e)});
 assert.equal(await failing(),null);assert.equal(errors.length,1);assert.match(errors[0].message,/database down/);
});
