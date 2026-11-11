import test from 'node:test';
import assert from 'node:assert/strict';
import {dueForSync,collect,SYNC_CHECKPOINTS,syncCandidatesSQL,syncSnapshotSQL} from '../../dist/learning-sync.js';
import {PostformeError} from '../../dist/postforme-client.js';
import {postformeObservations} from '../../dist/learning-observations.js';

const now=new Date('2026-11-12T12:00:00.000Z'),ago=hours=>new Date(now.getTime()-hours*3600000).toISOString();
const post=(id,hours,collected=[])=>({publication_id:id,published_at:ago(hours),collected});
test('the policy collects at 1h, 24h, 72h, 7d and 30d after publishing',()=>{
 assert.deepEqual(SYNC_CHECKPOINTS.map(c=>[c.id,c.hours]),[['1h',1],['24h',24],['72h',72],['7d',168],['30d',720]]);
 const due=dueForSync([post('a',0.5),post('b',2),post('c',30),post('d',80),post('e',200),post('f',800)],now);
 assert.deepEqual(Object.fromEntries(due.map(d=>[d.publication_id,d.checkpoint])),{b:'1h',c:'24h',d:'72h',e:'7d',f:'30d'});
});
test('a collected checkpoint is not due again and missed earlier checkpoints are not backfilled',()=>{
 assert.deepEqual(dueForSync([post('a',30,['24h'])],now),[]);
 assert.deepEqual(dueForSync([post('a',30,['1h'])],now).map(d=>d.checkpoint),['24h']);
 assert.deepEqual(dueForSync([post('a',200,[])],now).map(d=>d.checkpoint),['7d'],'only the latest elapsed checkpoint');
 assert.deepEqual(dueForSync([post('a',900,['30d'])],now),[]);
 assert.deepEqual(dueForSync([post('a',46*24)],now),[],'outside the collection window');
 assert.deepEqual(dueForSync([{publication_id:'x',published_at:'garbage',collected:[]},post('future',-5)],now),[]);
});
test('a run is bounded, oldest due first, deterministic, and does not mutate its input',()=>{
 const posts=[post('b',3),post('a',3),post('c',30),post('d',200)],frozen=JSON.stringify(posts);
 const due=dueForSync(posts,now,3);
 assert.deepEqual(due.map(d=>d.publication_id),['d','c','a']);assert.equal(JSON.stringify(posts),frozen);assert.deepEqual(dueForSync(posts,now,0),[]);
});

const candidate=(id,remote,hours,over={})=>({publication_id:id,organization_id:'org',brand_id:'brand',account_id:'local-'+remote,remote_id:remote,caption:'Caption '+id,scheduled_at:ago(hours),published_at:ago(hours),release_url:`https://instagram.com/p/${id}`,collected:[],...over});
const pool=rows=>{const writes=[];return {writes,query:async(sql,params)=>{if(sql===syncCandidatesSQL)return {rows};assert.equal(sql,syncSnapshotSQL);writes.push(params);return {rows:[]};}};};
const feedItem=(id,remote,metrics)=>({social_account_id:remote,platform_post_id:'pp-'+id,platform:'instagram',caption:'Caption '+id,posted_at:ago(30),platform_url:`https://instagram.com/p/${id}/`,metrics});
test('collect fetches each account feed once and appends one snapshot per due post',async()=>{
 const db=pool([candidate('a','r1',30),candidate('b','r1',30),candidate('c','r2',2),candidate('done','r2',30,{collected:['24h']})]),paths=[];
 const client={call:async path=>{paths.push(path);return path.includes('/r1?')?{data:[feedItem('a','r1',{likes:4,views:90,junk:'x'}),{broken:true}]}:{data:[feedItem('c','r2',{})]};}};
 const result=await collect({pool:db,client,now});
 assert.deepEqual(result,{due:3,collected:1,missing:2,accounts:2,failed_accounts:0,rate_limited:false});
 assert.deepEqual(paths.sort(),['/v1/social-account-feeds/r1?limit=50&expand=metrics','/v1/social-account-feeds/r2?limit=50&expand=metrics']);
 const rows=Object.fromEntries(db.writes.map(w=>[w[0],w]));
 assert.deepEqual(rows.a.slice(1,7),['org','brand','local-r1','24h','available','{"likes":4,"views":90}']);
 assert.deepEqual(rows.b.slice(4,7),['24h','missing','{}'],'a post absent from the feed is recorded as missing, never as zero');
 assert.deepEqual(rows.c.slice(4,7),['1h','missing','{}'],'a matched post without metrics is missing too');
 assert.match(syncSnapshotSQL,/ON CONFLICT\(publication_id,checkpoint\) DO NOTHING/);
});
test('a rate limit stops the run; other provider failures skip that account for a later retry',async()=>{
 const rows=[candidate('a','r1',200),candidate('b','r2',30),candidate('c','r3',2)];
 let db=pool(rows),calls=0;
 let result=await collect({pool:db,now,client:{call:async()=>{calls++;throw new PostformeError('POSTFORME_RATE_LIMITED');}}});
 assert.equal(calls,1);assert.equal(result.rate_limited,true);assert.equal(db.writes.length,0);
 db=pool(rows);
 result=await collect({pool:db,now,client:{call:async path=>{if(path.includes('/r1?'))throw new PostformeError('POSTFORME_UNREACHABLE');if(path.includes('/r2?'))return {nope:true};return {data:[feedItem('c','r3',{likes:1})]};}}});
 assert.deepEqual(result,{due:3,collected:1,missing:0,accounts:1,failed_accounts:2,rate_limited:false});assert.equal(db.writes.length,1);
 await assert.rejects(collect({pool:pool(rows),now,client:{call:async()=>{throw new TypeError('bug');}}}),TypeError);
});
test('runs are bounded by post and account limits',async()=>{
 const rows=Array.from({length:8},(_,i)=>candidate('p'+i,'r'+i,30));let calls=0;
 const result=await collect({pool:pool(rows),now,limit:5,maxAccounts:2,client:{call:async()=>{calls++;return {data:[]};}}});
 assert.equal(result.due,5);assert.equal(calls,2);assert.equal(result.missing,2);
});
test('observations use the newest reading between a scheduled snapshot and the refreshed feed, never a sum',()=>{
 const published=[{publication_id:'p',caption:'C',scheduled_at:ago(200),release_url:'https://instagram.com/p/p',account_id:'acc',provider:'instagram',account_name:'S'}];
 const feeds=[{account_id:'acc',updated_at:ago(100),posts:[{id:'x',account_id:'acc',caption:'C',posted_at:ago(200),url:'https://instagram.com/p/p',metrics:{likes:5}}]}];
 const snap=(hours,metrics)=>({publication_id:'p',metrics,posted_at:ago(200),collected_at:ago(hours)});
 assert.deepEqual(postformeObservations(published,feeds,[snap(150,{likes:3}),snap(30,{likes:9})])[0].metrics,{likes:9});
 assert.deepEqual(postformeObservations(published,feeds,[snap(150,{likes:3})])[0].metrics,{likes:5});
 assert.deepEqual(postformeObservations(published,[],[snap(32,{likes:9})])[0].hours_since_publish,168);
});
