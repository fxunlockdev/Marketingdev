import test from 'node:test';
import assert from 'node:assert/strict';
import {observePublication,failureReason,checkStatuses,statusCandidatesSQL,statusObservedSQL,statusUnconfirmedSQL} from '../../dist/publication-status.js';
import {zonedInstant,inPublishWindow} from '../../dist/publication-time.js';
import {PostformeError} from '../../dist/postforme-client.js';

const id='00000000-0000-4000-8000-0000000000aa',at='2027-03-01T09:00:00.000Z';
const op={id,caption:'Spring menu',scheduled_at:at,remote_account:'spc_1',remote_id:null};
const post=(over={})=>({id:'sp_1',external_id:id,caption:'Spring menu',scheduled_at:at,status:'scheduled',social_accounts:[{id:'spc_1'}],...over});
const client=(posts,results=[])=>({calls:[],async call(path){this.calls.push(path);if(path.startsWith('/v1/social-post-results'))return {data:results};if(path.startsWith('/v1/social-posts/'))return posts[0]??null;return {data:posts};}});

test('a post is identified only by our external id, caption, time and single account',async()=>{
 assert.deepEqual(await observePublication(client([post({social_accounts:[{id:'other'}]})]),op),{kind:'unconfirmed'});
 assert.deepEqual(await observePublication(client([post({caption:'Changed'})]),op),{kind:'unconfirmed'});
 assert.deepEqual(await observePublication(client([post(),post({id:'sp_2'})]),op),{kind:'unconfirmed'},'two matches are never guessed between');
 const seen=await observePublication(client([post()]),op);
 assert.equal(seen.kind,'observed');assert.equal(seen.state,'scheduled');assert.equal(seen.remote_id,'sp_1');
});
test('a known remote id follows a rescheduled post and adopts its new time',async()=>{
 const c=client([post({scheduled_at:'2027-03-02T10:00:00.000Z'})]);
 const seen=await observePublication(c,{...op,remote_id:'sp_1'});
 assert.deepEqual(c.calls[0],'/v1/social-posts/sp_1');assert.equal(seen.scheduled_at,'2027-03-02T10:00:00.000Z');
});
test('results decide published or failed, with the provider reason kept short and free of links and secrets',async()=>{
 const ok=await observePublication(client([post({status:'processed'})],[{post_id:'sp_1',social_account_id:'spc_1',success:true,platform_data:{url:'https://social.example/p/1'}}]),op);
 assert.equal(ok.state,'published');assert.equal(ok.release_url,'https://social.example/p/1');assert.equal(ok.failure_reason,null);
 const bad=await observePublication(client([post({status:'processed'})],[{post_id:'sp_1',social_account_id:'spc_1',success:false,error:{message:'Media aspect ratio not supported https://x.example/a?token=abc'}}]),op);
 assert.equal(bad.state,'failed');assert.equal(bad.failure_reason,'Media aspect ratio not supported [link]');
 assert.equal(failureReason('bad\u0000 access_token=abc123'),'bad access_token=[hidden]');
 assert.equal(failureReason('x'.repeat(900)).length,500);
 const silent=await observePublication(client([post({status:'processed'})],[{post_id:'sp_1',social_account_id:'spc_1',success:false}]),op);
 assert.equal(silent.failure_reason,'The social network rejected this post');
 const other=await observePublication(client([post({status:'processing'})],[{post_id:'sp_1',social_account_id:'someone-else',success:true}]),op);
 assert.equal(other.state,'processing','results for another account are ignored');
});
test('worker status checks never resubmit, record unconfirmed outcomes and stop at a rate limit',async()=>{
 const writes=[];const rows=[{...op},{...op,id:'00000000-0000-4000-8000-0000000000bb'}];
 const pool={query:async(sql,params)=>{if(sql===statusCandidatesSQL)return {rows};writes.push([sql,params[0]]);return {rows:[]};}};
 let n=0;const limited={call:async()=>{n++;throw new PostformeError('POSTFORME_RATE_LIMITED');}};
 assert.equal((await checkStatuses({pool,client:limited})).rate_limited,true);assert.equal(n,1);assert.equal(writes.length,0);
 const mixed={call:async path=>path.includes('external_id=00000000-0000-4000-8000-0000000000aa')?{data:[post()]}:path.includes('social-post-results')?{data:[]}:{data:[]}};
 const run=await checkStatuses({pool,client:mixed});
 assert.deepEqual(run,{checked:2,changed:1,unconfirmed:1,failed:0,rate_limited:false});
 assert.deepEqual(writes.map(w=>w[0]),[statusObservedSQL,statusUnconfirmedSQL]);
 assert.ok(!/\bINSERT\b/.test(statusObservedSQL+statusUnconfirmedSQL));
});
test('publishing times are wall-clock times in the business time zone',()=>{
 assert.equal(zonedInstant('2027-01-15T09:30','Europe/Riga').toISOString(),'2027-01-15T07:30:00.000Z');
 assert.equal(zonedInstant('2027-07-15T09:30','America/New_York').toISOString(),'2027-07-15T13:30:00.000Z');
 assert.equal(zonedInstant('2027-03-14T02:30','America/New_York'),null,'a skipped wall time is refused');
 for(const bad of ['2027-02-30T09:00','2027-01-15 09:30',42,'2027-01-15T24:00'])assert.equal(zonedInstant(bad,'UTC'),null);
 assert.equal(zonedInstant('2027-01-15T09:30','Not/AZone'),null);
 const now=Date.parse('2027-01-01T00:00:00Z');
 assert.equal(inPublishWindow(now+30000,now),false);assert.equal(inPublishWindow(now+120000,now),true);assert.equal(inPublishWindow(now+32*86400000,now),false);
});
test('a remote post that is gone is reported as gone, never as published or failed',async()=>{
 const gone={call:async path=>{if(path.startsWith('/v1/social-posts/'))throw new PostformeError('POSTFORME_NOT_FOUND');if(path.startsWith('/v1/social-posts?'))return {data:[]};return {data:[]};}};
 assert.deepEqual(await observePublication(gone,{...op,remote_id:'sp_1'}),{kind:'gone'});
 const moved={call:async path=>{if(path.startsWith('/v1/social-posts/'))throw new PostformeError('POSTFORME_NOT_FOUND');return {data:[post({id:'sp_9'})]};}};
 assert.deepEqual(await observePublication(moved,{...op,remote_id:'sp_1'}),{kind:'unconfirmed'},'a different remote post for our id is never adopted silently');
});
test('a worker reading never overwrites a time changed after it was read',()=>{
 assert.match(statusObservedSQL,/scheduled_at=\$8/);
});
