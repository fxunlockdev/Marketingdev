import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {StockAssets} from '../../dist/stock-assets.js';
import {AssetJobs} from '../../dist/jobs.js';
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
