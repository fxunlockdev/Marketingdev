import test from 'node:test';
import assert from 'node:assert/strict';
import {learningSyncTick,LEARNING_SYNC_INTERVAL_MS} from '../../dist/learning-schedule.js';
import {statusCandidatesSQL} from '../../dist/publication-status.js';

const idle={checked:0,changed:0,unconfirmed:0,failed:0,rate_limited:false};
test('scheduled learning sync runs every 15 minutes, one run at a time, and reports errors instead of throwing',async()=>{
 assert.equal(LEARNING_SYNC_INTERVAL_MS,900000);
 let release,queries=0;const errors=[];
 const gate=new Promise(resolve=>{release=resolve;});
 const pool={query:async()=>{queries++;await gate;return {rows:[]};}};
 const tick=learningSyncTick({pool,client:{call:async()=>({data:[]})},onError:e=>errors.push(e)});
 const first=tick(),second=await tick();
 assert.equal(second,null,'a tick during a running collection is skipped');assert.equal(queries,1);
 release();
 assert.deepEqual(await first,{due:0,collected:0,missing:0,accounts:0,failed_accounts:0,rate_limited:false,status:idle});
 assert.notEqual(await tick(),null,'the next tick runs again');assert.equal(queries,4);
 const failing=learningSyncTick({pool:{query:async()=>{throw new Error('database down');}},client:{call:async()=>({})},onError:e=>errors.push(e)});
 assert.equal(await failing(),null);assert.equal(errors.length,1);assert.match(errors[0].message,/database down/);
});
test('each tick checks publishing status before collecting metrics, so newly published posts are collected in the same run',async()=>{
 const order=[];
 const pool={query:async sql=>{order.push(sql===statusCandidatesSQL?'status':sql.startsWith('UPDATE')?'update':'metrics');return {rows:sql===statusCandidatesSQL?[{id:'00000000-0000-4000-8000-000000000001',caption:'Hello',scheduled_at:'2027-01-01T09:00:00.000Z',remote_id:'sp_1',remote_account:'spc_1'}]:[]};}};
 const client={call:async path=>path.startsWith('/v1/social-posts/sp_1')?{id:'sp_1',external_id:'00000000-0000-4000-8000-000000000001',caption:'Hello',scheduled_at:'2027-01-01T09:00:00.000Z',status:'processed',social_accounts:[{id:'spc_1'}]}:path.startsWith('/v1/social-post-results')?{data:[{post_id:'sp_1',social_account_id:'spc_1',success:true,platform_data:{url:'https://social.example/p/1'}}]}:{data:[]}};
 const result=await learningSyncTick({pool,client,onError:e=>{throw e;}})();
 assert.deepEqual(order,['status','update','metrics']);
 assert.deepEqual(result.status,{checked:1,changed:1,unconfirmed:0,failed:0,rate_limited:false});
});
