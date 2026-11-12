import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {StockAssets} from '../../dist/stock-assets.js';
import {AssetJobs} from '../../dist/jobs.js';
import {StockError} from '../../dist/vecteezy-client.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
const admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl}),app=new Pool({connectionString:config.appDatabaseUrl});
after(async()=>{await Promise.all([admin.end(),worker.end(),app.end()]);});
const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#467899'}}).jpeg().toBuffer();
async function fixture(){
 const user=randomUUID(),org=randomUUID(),brand=randomUUID();
 await admin.query(`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Stock user',$2,true,now(),now())`,[user,`${user}@example.test`]);
 await admin.query(`INSERT INTO app.organizations(id,name,created_by) VALUES($1,'Stock fixture',$2)`,[org,user]);
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[org,user]);
 await admin.query(`INSERT INTO app.brands(id,organization_id,name) VALUES($1,$2,'Stock fixture')`,[brand,org]);
 await admin.query("INSERT INTO app.stock_grants VALUES($1,$2,true,true,1,now()+interval '1 hour')",[org,brand]);
 const job=async()=>{const id=randomUUID();await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'creative.generate')",[id,org,brand,user]);return {organizationId:org,brandId:brand,jobId:id};};
 return {org,brand,user,job};
}
test('stock daily cap serializes racing jobs and acquisition records stay private',async()=>{
 const a=await fixture(),b=await fixture(),one=await a.job(),two=await a.job(),foreign=await b.job();
 const objects=new Map();let downloads=0;
 const store={persist:async(k,v)=>objects.set(k,v),read:async k=>objects.get(k)};
 const jobs=new AssetJobs(worker,store,{scan:async()=>{}});
 const service=new StockAssets(jobs,{configured:true,download:async()=>{downloads++;return {url:'https://example.com/photo.jpg',requiresAttribution:false,attributionURL:null};}},{fetch:async()=>({status:200,bytes})});
 const outcomes=await Promise.allSettled([service.acquire(one,42),service.acquire(two,43)]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(outcomes.find(v=>v.status==='rejected').reason.code,'STOCK_DAILY_LIMIT');assert.equal(downloads,1);
 const success=outcomes[0].status==='fulfilled'?one:two;
 await service.acquire(success,outcomes[0].status==='fulfilled'?42:43);assert.equal(downloads,1);
 await jobs.transaction(foreign,async db=>{assert.equal((await db.query('SELECT * FROM app.stock_acquisitions')).rowCount,0);});
 await assert.rejects(app.query('SELECT * FROM app.stock_acquisitions'),{code:'42501'});
 await assert.rejects(jobs.transaction(foreign,async db=>db.query("INSERT INTO app.stock_acquisitions(job_id,organization_id,brand_id,resource_id,status) VALUES($1,$2,$3,9,'acquiring')",[two.jobId,a.org,a.brand])),{code:'42501'});
});

test('stock selection survives resume without repeating search or purchase',async()=>{
 const a=await fixture(),b=await fixture(),scope=await a.job(),foreign=await b.job();
 const objects=new Map();let searches=0,downloads=0;
 const jobs=new AssetJobs(worker,{persist:async(k,v)=>objects.set(k,v),read:async k=>objects.get(k)},{scan:async()=>{}});
 const service=new StockAssets(jobs,{configured:true,search:async()=>{searches++;return [{id:99,title:'Courtyard',previewURL:'https://example.com/temporary',aiGenerated:false}];},download:async()=>{downloads++;return {url:'https://example.com/photo.jpg',requiresAttribution:false,attributionURL:null};}},{fetch:async()=>({status:200,bytes})});
 const input={brand:{facts:[]}};
 const context={imagePrompt:'Quiet courtyard',orientation:'square'};
 const planner=async request=>({content:JSON.stringify(request.step===4?{queries:['modern courtyard']}:{resource_id:99}),tool_calls:[]});
 const first=await service.reference(scope,input,context,planner);assert.equal(first.use,'inspiration');assert.deepEqual(await service.reference(scope,input,context,planner),first);
 assert.equal(searches,1);assert.equal(downloads,1);
 await jobs.transaction(scope,async db=>{const row=(await db.query('SELECT * FROM app.stock_selections WHERE job_id=$1',[scope.jobId])).rows[0];assert.equal(row.candidates[0].previewURL,null);assert.deepEqual(row.queries,['modern courtyard']);assert.equal(row.outcome,'selected');assert.equal(Number(row.selected_resource_id),99);assert.equal(row.use_as,'inspiration');});
 await jobs.transaction(foreign,async db=>assert.equal((await db.query('SELECT * FROM app.stock_selections')).rowCount,0));
 await assert.rejects(app.query('SELECT * FROM app.stock_selections'),{code:'42501'});
 await admin.query('UPDATE app.stock_grants SET enabled=false WHERE organization_id=$1',[a.org]);
 // A revoked grant withholds the saved photo; the creative goes ahead without it and the reason is kept.
 assert.equal(await service.reference(scope,input,context,planner),null);
 assert.equal(downloads,1);assert.equal(searches,1);
 const skipped=(await admin.query('SELECT outcome,skip_reason,selected_resource_id FROM app.stock_selections WHERE job_id=$1',[scope.jobId])).rows[0];
 assert.deepEqual({...skipped,selected_resource_id:Number(skipped.selected_resource_id)},{outcome:'skipped',skip_reason:'STOCK_GRANT_REQUIRED',selected_resource_id:99});
 // Another job cannot rewrite this job's stock decision.
 await jobs.transaction(foreign,async db=>assert.equal((await db.query("UPDATE app.stock_selections SET outcome='skipped',skip_reason='STOCK_FAILED' WHERE job_id=$1",[scope.jobId])).rowCount,0));
 await assert.rejects(jobs.transaction(scope,async db=>db.query("UPDATE app.stock_selections SET candidates='[]' WHERE job_id=$1",[scope.jobId])),{code:'42501'});
 await assert.rejects(admin.query("UPDATE app.stock_selections SET outcome='selected',skip_reason=NULL,use_as=NULL WHERE job_id=$1",[scope.jobId]),/stock_selections_decision_check/);
});

test('a business without a stock grant, or with an uncertain download, generates without stock and records why',async()=>{
 const a=await fixture(),ungranted=await a.job(),uncertain=await a.job();
 const objects=new Map();let searches=0,downloads=0;
 const jobs=new AssetJobs(worker,{persist:async(k,v)=>objects.set(k,v),read:async k=>objects.get(k)},{scan:async()=>{}});
 const service=new StockAssets(jobs,{configured:true,search:async()=>{searches++;return [{id:7,title:'Courtyard',previewURL:null,aiGenerated:false}];},download:async()=>{downloads++;throw new StockError('STOCK_DOWNLOAD_UNKNOWN');}},{fetch:async()=>({status:200,bytes})});
 const input={brand:{facts:[]}},context={imagePrompt:'Quiet courtyard',orientation:'square'};
 const planner=async request=>({content:JSON.stringify(request.step===4?{queries:['modern courtyard','quiet patio']}:{resource_id:7}),tool_calls:[]});
 assert.equal(await service.reference(uncertain,input,context,planner),null);
 assert.equal(await service.reference(uncertain,input,context,planner),null);
 assert.equal(downloads,1);assert.equal(searches,2);
 const held=(await admin.query('SELECT a.status,a.error_code,s.outcome,s.skip_reason FROM app.stock_acquisitions a JOIN app.stock_selections s USING(job_id) WHERE a.job_id=$1',[uncertain.jobId])).rows[0];
 assert.deepEqual(held,{status:'unknown',error_code:'STOCK_DOWNLOAD_UNKNOWN',outcome:'skipped',skip_reason:'STOCK_DOWNLOAD_UNKNOWN'});
 await admin.query('DELETE FROM app.stock_grants WHERE organization_id=$1',[a.org]);
 assert.equal(await service.reference(ungranted,input,context,planner),null);
 assert.equal(searches,2);
 const row=(await admin.query('SELECT query,candidates,outcome,skip_reason FROM app.stock_selections WHERE job_id=$1',[ungranted.jobId])).rows[0];
 assert.deepEqual(row,{query:null,candidates:[],outcome:'skipped',skip_reason:'STOCK_GRANT_REQUIRED'});
});

test('later carousel slides reuse the first slide photo; other carousels and businesses stay invisible',async()=>{
 const a=await fixture(),b=await fixture(),parent=randomUUID(),first=await a.job(),second=await a.job(),lonely=await a.job(),foreign=await b.job();
 await admin.query('UPDATE app.stock_grants SET max_daily_downloads=5 WHERE organization_id=$1',[a.org]);
 // Only the slide links matter here; the carousel request itself is covered by the canvas suite.
 const link=await admin.connect();
 try{
  await link.query("SET session_replication_role=replica");
  for(const [position,job] of [[0,first],[1,second]])await link.query('INSERT INTO app.carousel_children(organization_id,brand_id,parent_job_id,position,generation_job_id,export_job_id) VALUES($1,$2,$3,$4,$5,$6)',[a.org,a.brand,parent,position,job.jobId,randomUUID()]);
  await link.query('INSERT INTO app.carousel_children(organization_id,brand_id,parent_job_id,position,generation_job_id,export_job_id) VALUES($1,$2,$3,1,$4,$5)',[a.org,a.brand,randomUUID(),lonely.jobId,randomUUID()]);
 }finally{await link.query("SET session_replication_role=DEFAULT");link.release();}
 const objects=new Map();let searches=0,downloads=0,plans=0;
 const jobs=new AssetJobs(worker,{persist:async(k,v)=>objects.set(k,v),read:async k=>objects.get(k)},{scan:async()=>{}});
 const service=new StockAssets(jobs,{configured:true,search:async()=>{searches++;return [{id:11,title:'Courtyard',previewURL:null,aiGenerated:false}];},download:async()=>{downloads++;return {url:'https://example.com/photo.jpg',requiresAttribution:false,attributionURL:null};}},{fetch:async()=>({status:200,bytes})});
 const input={brand:{facts:[]}},context={imagePrompt:'Quiet courtyard',orientation:'square'};
 const planner=async request=>{plans++;return {content:JSON.stringify(request.step===4?{queries:['modern courtyard']}:{resource_id:11}),tool_calls:[]};};
 const cover=await service.reference(first,input,{...context,carouselPosition:0},planner);
 const slide=await service.reference(second,input,{...context,carouselPosition:1},planner);
 assert.deepEqual(slide,cover);assert.deepEqual({searches,downloads,plans},{searches:1,downloads:1,plans:2});
 assert.deepEqual(await service.reference(second,input,{...context,carouselPosition:1},planner),cover);
 const reused=(await admin.query('SELECT outcome,source_job_id,use_as FROM app.stock_selections WHERE job_id=$1',[second.jobId])).rows[0];
 assert.deepEqual(reused,{outcome:'reused',source_job_id:first.jobId,use_as:'inspiration'});
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.stock_acquisitions WHERE organization_id=$1',[a.org])).rows[0].n,1);
 // A slide whose first slide has no photo goes ahead without stock.
 assert.equal(await service.reference(lonely,input,{...context,carouselPosition:1},planner),null);
 assert.equal((await admin.query('SELECT skip_reason FROM app.stock_selections WHERE job_id=$1',[lonely.jobId])).rows[0].skip_reason,'STOCK_SKIPPED_CAROUSEL_SLIDE');
 await jobs.transaction(foreign,async db=>assert.equal((await db.query('SELECT * FROM app.carousel_children')).rowCount,0));
 assert.deepEqual({searches,downloads},{searches:1,downloads:1});
});
