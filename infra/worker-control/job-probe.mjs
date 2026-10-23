// Evaluated inside a short-lived administrative acceptance container, never the worker.
// Credentials arrive through stdin. Only explicitly-created probe identities are touched.
import {Pool} from 'pg';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {TenantDatabase} from './dist/database.js';
import {Workspaces} from './dist/workspaces.js';
import {Assets} from './dist/assets.js';
import {ObjectStore,digest} from './dist/object-store.js';
let raw='';for await(const part of process.stdin)raw+=part;
const input=JSON.parse(raw);raw='';
const admin=new Pool({connectionString:input.admin_url,connectionTimeoutMillis:10000}),pool=new Pool({connectionString:input.app_url,connectionTimeoutMillis:10000}),db=new TenantDatabase(pool),store=new ObjectStore(input.storage),assets=new Assets(db,store),workspaces=new Workspaces(db);
let stage='scope',org,brand,job;
try{
 assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,input.database_name);
 await db.assertRuntimeRole();
 stage='fixture';
 for(const id of [input.owner,input.foreign])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',[id,'Desvio dev acceptance '+input.run_id,`${id}@desvio-probe.invalid`]);
 org=await workspaces.create(input.owner,{name:'Dev acceptance '+input.run_id});
 brand=await workspaces.createBrand(input.owner,org.id,{name:'Private upload probe'},input.run_id);
 stage='reservation';
 const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#337788'}}).png().toBuffer();
 const body={filename:'dev-acceptance-'+input.run_id+'.png',contentType:'image/png',bytes:bytes.length,sha256:digest(bytes)};
 const reserved=await assets.reserve(input.owner,org.id,brand.id,body,input.run_id);
 assert.equal((await assets.reserve(input.owner,org.id,brand.id,body,input.run_id)).id,reserved.id);
 await assert.rejects(assets.list(input.foreign,org.id,brand.id),e=>e.getStatus?.()===404);
 stage='upload';
 const put=await fetch(reserved.upload.url,{method:'PUT',headers:reserved.upload.headers,body:bytes,signal:AbortSignal.timeout(20000)});assert.ok(put.ok);
 const unsigned=new URL(reserved.upload.url);unsigned.search='';assert.ok([401,403,404].includes((await fetch(unsigned,{signal:AbortSignal.timeout(15000)})).status));
 job=await assets.complete(input.owner,org.id,brand.id,reserved.id);
 assert.equal((await assets.complete(input.owner,org.id,brand.id,reserved.id)).id,job.id);
 await assert.rejects(assets.job(input.foreign,org.id,brand.id,job.id),e=>e.getStatus?.()===404);
 stage='worker';
 if(input.recovery){await delay(5000);const queued=await assets.job(input.owner,org.id,brand.id,job.id);assert.equal(queued.status,'queued');assert.equal(queued.attempt,0);assert.equal((await admin.query('SELECT dispatched_at FROM app.job_dispatch WHERE job_id=$1',[job.id])).rows[0].dispatched_at,null);}
 let result;for(let n=0;n<60;n++){result=await assets.job(input.owner,org.id,brand.id,job.id);if(!['queued','running','retrying'].includes(result.status))break;await delay(2000);}
 assert.equal(result.status,'succeeded',result.error_code??result.status);
 stage='download';
 const download=await assets.download(input.owner,org.id,brand.id,reserved.id),response=await fetch(download.url,{signal:AbortSignal.timeout(15000)});assert.ok(response.ok);assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(bytes));
 await assert.rejects(assets.download(input.foreign,org.id,brand.id,reserved.id),e=>e.getStatus?.()===404);
 const visual=(await admin.query('SELECT object_key,sha256 FROM app.uploaded_visuals WHERE asset_id=$1',[reserved.id])).rows[0];assert.ok(visual);assert.equal(digest(await store.read(visual.object_key)),visual.sha256);
 const dispatch=(await admin.query('SELECT dispatched_at FROM app.job_dispatch WHERE job_id=$1',[job.id])).rows;assert.equal(dispatch.length,1);assert.ok(dispatch[0].dispatched_at);
 console.log(JSON.stringify({passed:true,run_id:input.run_id,owner:input.owner,foreign:input.foreign,organization_id:org.id,brand_id:brand.id,asset_id:reserved.id,job_id:job.id,job_status:result.status,attempts:result.attempt,...(input.recovery?{queued_during_outage:true,recovered_after_restart:true}:{}),reservation_replay:true,submission_replay:true,anonymous_denied:true,foreign_service_denied:true,canonical_readback:true,normalized_visual_readback:true,fixture_cleanup_pending:true}));
}catch(e){console.log(JSON.stringify({passed:false,stage,run_id:input.run_id,organization_id:org?.id,brand_id:brand?.id,job_id:job?.id,error_code:/^[A-Z_]+$/.test(e.code??'')?e.code:'ACCEPTANCE_ASSERTION_OR_SERVICE_FAILURE',fixture_cleanup_pending:true}));process.exitCode=1;}
finally{store.close();await Promise.all([admin.end(),pool.end()]);}
