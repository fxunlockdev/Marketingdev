import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout} from 'node:timers/promises';
import {createServer,createConnection} from 'node:net';
import {Pool} from 'pg';
import sharp from 'sharp';
import {Connection,Client} from '@temporalio/client';
import {createApplication} from '../../dist/app.js';
import {ObjectStore,digest} from '../../dist/object-store.js';
import {AssetJobs,JobDispatcher,assertJobRole} from '../../dist/jobs.js';
import {MalwareScanner} from '../../dist/file-validation.js';
import {startMailbox,messageLink} from './smtp.mjs';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
const store=new ObjectStore(config.storage),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl}),dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl});
let runtime,smtp,base,alice,bob,org,brand,connection,client,dispatcher,worker,output='',proxy,proxyPort,hold=false,held=0,unavailable=false;const sockets=new Set();
const png=await sharp({create:{width:32,height:32,channels:3,background:'#663399'}}).png().toBuffer();
async function request(path,{cookie=alice?.cookie,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{origin:config.origin,...(cookie?{cookie}:{}),...(method==='POST'?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:method==='POST'?JSON.stringify(body??{}):undefined});return{status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
async function signup(label){const email=`${label}@example.test`;const r=await request('/api/auth/sign-up/email',{method:'POST',body:{name:label,email,password:'strong-assets-password-2026'}});assert.equal(r.status,200);while(await runtime.mailWorker.runOnce()){}const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===email));await fetch(base+link.pathname+link.search,{redirect:'manual'});const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email,password:'strong-assets-password-2026'}});assert.equal(login.status,200);return{id:r.body.user.id,cookie:login.cookie};}
const path=()=>`/api/v1/workspaces/${org.id}/brands/${brand.id}`;
async function reserve(bytes=png,hash=digest(bytes),key=randomUUID()){const r=await request(path()+'/uploads',{method:'POST',key,body:{filename:'brand.png',contentType:'image/png',bytes:bytes.length,sha256:hash}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function upload(asset,bytes=png){const r=await fetch(asset.upload.url,{method:'PUT',headers:asset.upload.headers,body:bytes});assert.equal(r.status,200,await r.text());}
async function complete(asset){const r=await request(`${path()}/assets/${asset.id}/complete`,{method:'POST'});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function status(job){const r=await request(`${path()}/jobs/${job.id}`);assert.equal(r.status,200);return r.body;}
async function waitStatus(job,expected,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const s=await status(job);if(expected.includes(s.status))return s;if(['succeeded','failed','rejected','canceled'].includes(s.status))throw new Error(`Unexpected terminal status ${s.status}: ${s.error_code}`);await setTimeout(200);}throw new Error(`Job did not reach ${expected}; ${(await status(job)).status}; ${output.slice(-2000)}`);}
function startWorker(){
  const env={...process.env,APP_MODE:'test',APP_ORIGIN:config.origin,AUTH_SECRET:config.authSecret,AUTH_DATABASE_URL:config.authDatabaseUrl,APP_DATABASE_URL:config.appDatabaseUrl,MAIL_DATABASE_URL:config.mailDatabaseUrl,MAIL_ENCRYPTION_KEY:config.mailEncryptionKey,
    SMTP_HOST:config.smtp.host,SMTP_PORT:String(config.smtp.port),SMTP_SECURE:'false',SMTP_FROM:config.smtp.from,S3_ENDPOINT:config.storage.endpoint,S3_REGION:config.storage.region,S3_BUCKET:config.storage.bucket,S3_ACCESS_KEY_ID:config.storage.accessKeyId,S3_SECRET_ACCESS_KEY:config.storage.secretAccessKey,
    CLAMD_HOST:'127.0.0.1',CLAMD_PORT:String(proxyPort),WORKER_DATABASE_URL:config.jobs.workerDatabaseUrl,DISPATCHER_DATABASE_URL:config.jobs.dispatcherDatabaseUrl,TEMPORAL_ADDRESS:config.jobs.address,TEMPORAL_NAMESPACE:config.jobs.namespace,TEMPORAL_TASK_QUEUE:config.jobs.taskQueue};
  worker=spawn(process.execPath,['dist/worker-main.js'],{env,stdio:['ignore','pipe','pipe']});worker.stdout.on('data',b=>output=(output+b).slice(-10000));worker.stderr.on('data',b=>output=(output+b).slice(-10000));
}
async function stopWorker(){if(worker&&worker.exitCode===null&&worker.signalCode===null){const done=once(worker,'exit');worker.kill('SIGKILL');await done;}}
before(async()=>{
  smtp=await startMailbox();config.smtp.port=smtp.port;runtime=await createApplication(config);await runtime.app.listen(0,'127.0.0.1');base=await runtime.app.getUrl();alice=await signup('asset-alice');bob=await signup('asset-bob');
  org=(await request('/api/v1/workspaces',{method:'POST',body:{name:'Asset client'}})).body;
  brand=(await request(`/api/v1/workspaces/${org.id}/brands`,{method:'POST',key:randomUUID(),body:{name:'Brand A'}})).body;
  connection=await Connection.connect({address:config.jobs.address});client=new Client({connection,namespace:config.jobs.namespace});dispatcher=new JobDispatcher(dispatchPool,client,config.jobs.taskQueue);
  await assertJobRole(workerPool,'desvio_worker');await assertJobRole(dispatchPool,'desvio_dispatcher');
  proxy=createServer(incoming=>{if(unavailable){incoming.destroy();return;}const outgoing=createConnection(config.scanner);sockets.add(incoming);sockets.add(outgoing);incoming.on('error',()=>{});outgoing.on('error',()=>incoming.destroy());incoming.pipe(outgoing);outgoing.on('data',bytes=>{if(hold){held++;return;}incoming.write(bytes);});outgoing.on('end',()=>{if(!hold)incoming.end();});incoming.on('close',()=>{sockets.delete(incoming);outgoing.destroy();});outgoing.on('close',()=>sockets.delete(outgoing));});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));proxyPort=proxy.address().port;
});
beforeEach(async()=>{await admin.query('DELETE FROM auth."rateLimit"');});
after(async()=>{await stopWorker();for(const s of sockets)s.destroy();await new Promise(r=>proxy?.close(r));await connection?.close();await runtime?.close();await smtp?.close();store.close();await Promise.all([admin.end(),workerPool.end(),dispatchPool.end()]);});

test('authenticated reservation is private, idempotent, format bounded and tenant scoped',async()=>{
  const key=randomUUID(),a=await reserve(png,digest(png),key),b=await reserve(png,digest(png),key);assert.equal(a.id,b.id);
  const conflict=await request(path()+'/uploads',{method:'POST',key,body:{filename:'different.png',contentType:'image/png',bytes:png.length,sha256:digest(png)}});assert.equal(conflict.status,409);
  assert.equal((await request(path()+'/uploads',{method:'POST',key:randomUUID(),body:{filename:'bad.html',contentType:'text/html',bytes:2,sha256:'a'.repeat(64)}})).status,400);
  assert.equal((await request(path()+'/assets',{cookie:bob.cookie})).status,404);
  assert.equal((await request(`${path()}/assets/${a.id}/download`,{method:'POST'})).status,409);
  const foreign=new URL(a.upload.url);foreign.pathname=foreign.pathname.replace(org.id,randomUUID());assert.equal((await fetch(foreign,{method:'PUT',headers:a.upload.headers,body:png})).status,403);
  assert.equal((await fetch(a.upload.url,{method:'PUT',headers:{...a.upload.headers,'content-type':'text/html'},body:png})).status,403);
  await upload(a);const unsigned=new URL(a.upload.url);unsigned.search='';assert.equal((await fetch(unsigned)).status,403);
  const job=await complete(a);assert.deepEqual(await complete(a),job);
  assert.equal((await request(`${path()}/jobs/${job.id}`,{cookie:bob.cookie})).status,404);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.job_dispatch WHERE job_id=$1',[job.id])).rows[0].n,1);
  await dispatcher.runOnce();startWorker();const done=await waitStatus(job,['succeeded']);assert.equal(done.attempt,1);
  const download=await request(`${path()}/assets/${a.id}/download`,{method:'POST'});assert.equal(download.status,201);const r=await fetch(download.body.url);assert.equal(r.status,200);assert.equal(digest(Buffer.from(await r.arrayBuffer())),digest(png));assert.match(r.headers.get('content-disposition'),/^attachment;/);
  const canonical=(await admin.query('SELECT canonical_key FROM app.assets WHERE id=$1',[a.id])).rows[0].canonical_key;
  assert.equal(await store.persist(canonical,png,'image/png',digest(png)),'existing-verified');
  const alternate=Buffer.from('must not overwrite validated bytes');
  await assert.rejects(store.persist(canonical,alternate,'image/png',digest(alternate)),/CANONICAL_INTEGRITY_CONFLICT/);
  assert.equal(digest(await store.read(canonical)),digest(png));
  // The old upload grant cannot alter validated canonical bytes.
  const changed=await sharp({create:{width:32,height:32,channels:3,background:'#993366'}}).png().toBuffer();
  if(changed.length===png.length)await upload(a,changed);else await upload(a,png);
  assert.equal(digest(Buffer.from(await(await fetch(download.body.url)).arrayBuffer())),digest(png));
});

test('real scanner, checksum and image decoding reject unsafe uploads',async()=>{
  const cases=[{bytes:png,hash:'a'.repeat(64),code:'CHECKSUM_MISMATCH'},{bytes:Buffer.from('not an image'),code:'INVALID_IMAGE'},
    {bytes:Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),code:'MALWARE_DETECTED'}];
  for(const item of cases){const a=await reserve(item.bytes,item.hash??digest(item.bytes));await upload(a,item.bytes);const job=await complete(a);const result=await waitStatus(job,['rejected']);assert.equal(result.error_code,item.code);assert.equal((await request(`${path()}/assets/${a.id}/download`,{method:'POST'})).status,409);}
});

test('worker and dispatcher database roles deny cross-job reads and identity mutations',async()=>{
  const a=await reserve(),job=await complete(a);const scoped=new AssetJobs(workerPool,store,new MalwareScanner(config.scanner));
  assert.equal((await workerPool.query('SELECT * FROM app.assets')).rowCount,0);
  await scoped.transaction({organizationId:org.id,brandId:brand.id,jobId:job.id},async db=>{assert.equal((await db.query('SELECT * FROM app.assets')).rowCount,1);assert.equal((await db.query('SELECT * FROM app.jobs')).rowCount,1);});
  await assert.rejects(scoped.transaction({organizationId:org.id,brandId:randomUUID(),jobId:job.id},async()=>{}),/JOB_SCOPE_DENIED/);
  await assert.rejects(workerPool.query('UPDATE app.jobs SET organization_id=$1',[randomUUID()]),/permission denied/);
  await assert.rejects(workerPool.query('SELECT * FROM auth.session'),/permission denied/);await assert.rejects(dispatchPool.query('SELECT * FROM app.assets'),/permission denied/);
  await request(`${path()}/jobs/${job.id}/cancel`,{method:'POST'});await waitStatus(job,['canceled']);
});

test('cancellation and removed requester prevent queued asset promotion',async()=>{
  await stopWorker();const a=await reserve();await upload(a);const job=await complete(a);await request(`${path()}/jobs/${job.id}/cancel`,{method:'POST'});startWorker();await waitStatus(job,['canceled']);
  await stopWorker();const b=await reserve();await upload(b);const jobB=await complete(b);await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[org.id,alice.id]);startWorker();
  try{for(let i=0;i<100;i++){const r=await admin.query('SELECT status FROM app.jobs WHERE id=$1',[jobB.id]);if(r.rows[0].status==='canceled')break;await setTimeout(200);}assert.equal((await admin.query('SELECT status FROM app.jobs WHERE id=$1',[jobB.id])).rows[0].status,'canceled');}
  finally{await admin.query('UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2',[org.id,alice.id]);}
});

test('actual worker process death resumes the durable activity and dispatch replay keeps one workflow',async()=>{
  hold=true;held=0;const a=await reserve();await upload(a);const job=await complete(a);await waitStatus(job,['running']);
  for(let i=0;i<100&&held===0;i++)await setTimeout(50);assert.ok(held>0,'scanner response must be in flight before kill');
  await stopWorker();hold=false;for(const s of sockets)s.destroy();startWorker();
  const result=await waitStatus(job,['succeeded']);assert.ok(result.attempt>=2);
  const handle=client.workflow.getHandle(`desvio-asset-${job.id}`),first=await handle.describe();
  await admin.query('UPDATE app.job_dispatch SET dispatched_at=NULL,leased_until=NULL WHERE job_id=$1',[job.id]);await dispatcher.runOnce();
  assert.equal((await handle.describe()).runId,first.runId);assert.equal((await status(job)).status,'succeeded');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.assets WHERE id=$1',[a.id])).rows[0].n,1);
});


test('upload limits serialize concurrent reservations and abandoning frees a slot',async()=>{
  const oldBrand=brand;brand=(await request(`/api/v1/workspaces/${org.id}/brands`,{method:'POST',key:randomUUID(),body:{name:'Quota brand'}})).body;
  try{
    assert.equal((await request(path()+'/uploads',{method:'POST',key:randomUUID(),body:{filename:'big.png',contentType:'image/png',bytes:20*1024*1024+1,sha256:digest(png)}})).status,400);
    const responses=await Promise.all(Array.from({length:12},()=>request(path()+'/uploads',{method:'POST',key:randomUUID(),body:{filename:'brand.png',contentType:'image/png',bytes:png.length,sha256:digest(png)}})));
    assert.equal(responses.filter(r=>r.status===201).length,10);assert.equal(responses.filter(r=>r.status===409).length,2);
    const asset=responses.find(r=>r.status===201).body;
    assert.equal((await request(`${path()}/assets/${asset.id}/abandon`,{method:'POST'})).status,201);
    assert.equal((await request(`${path()}/assets/${asset.id}/complete`,{method:'POST'})).status,409);
    await reserve();
    await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",[org.id,bob.id]);
    assert.equal((await request(path()+'/uploads',{method:'POST',cookie:bob.cookie,key:randomUUID(),body:{filename:'brand.png',contentType:'image/png',bytes:png.length,sha256:digest(png)}})).status,403);
    assert.equal((await request(`${path()}/assets/${asset.id}/abandon`,{method:'POST',cookie:bob.cookie})).status,403);
  }finally{brand=oldBrand;}
});


test('temporary scanner connection failure preserves work and retries safely',async()=>{
  unavailable=true;
  try{
    const asset=await reserve();await upload(asset);const job=await complete(asset);
    const pending=await waitStatus(job,['retrying']);assert.equal(pending.error_code,'VALIDATION_SERVICE_UNAVAILABLE');
    assert.equal((await request(`${path()}/assets/${asset.id}/download`,{method:'POST'})).status,409);
    unavailable=false;const result=await waitStatus(job,['succeeded']);assert.ok(result.attempt>=2);
  }finally{unavailable=false;}
});
