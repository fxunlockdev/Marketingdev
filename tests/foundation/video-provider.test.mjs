// Real PostgreSQL/RLS and durable Temporal; every Higgsfield response is MOCK.
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Client,Connection} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {AssetJobs} from '../../dist/jobs.js';
import {HiggsfieldClient,HIGGSFIELD_MODELS} from '../../dist/higgsfield-client.js';
import {VideoProviderJobs} from '../../dist/video-provider-jobs.js';
import {VideoVault} from '../../dist/video-vault.js';

const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),app=new Pool({connectionString:config.appDatabaseUrl}),pool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const database=new TenantDatabase(app),workspaces=new Workspaces(database),jobs=new AssetJobs(pool,null,null),key=randomBytes(32).toString('hex');
const alice=randomUUID(),bob=randomUUID(),viewer=randomUUID(),selected=randomUUID();
let org,otherOrg,provider,client,handler,behavior='',state='queued',submits=0,polls=0,cancels=0,onSubmit;
const requests=new Map();
const reply=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
before(async()=>{
 for(const id of [alice,bob,viewer,selected])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)',[id,`${id}@example.test`]);
 org=await workspaces.create(alice,{name:'MOCK video account'});otherOrg=await workspaces.create(bob,{name:'Other video account'});
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'viewer','all'),($1,$3,'editor','selected')",[org.id,viewer,selected]);
 provider=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
  if(req.headers.authorization!=='Key MOCK:secret')return reply(res,{},401);
  if(req.url.startsWith('/kling-video/')){
   submits++;if(onSubmit)await onSubmit();
   if(behavior==='reject')return reply(res,{detail:'MOCK secret prompt'},401);
   const k=req.headers['idempotency-key'];if(!requests.has(k))requests.set(k,randomUUID());
   assert.ok(JSON.parse(body).prompt.includes('MOCK'));
   if(behavior==='lost'){req.socket.destroy();return;}
   return reply(res,{request_id:requests.get(k),status:'queued'});
  }
  if(req.url.endsWith('/cancel')){
   cancels++;if(behavior==='cancelLost'){req.socket.destroy();return;}
   if(state==='in_progress')return reply(res,{},400);
   state='canceled';res.writeHead(202);res.end();return;
  }
  polls++;if(behavior==='statusFail')return reply(res,{},503);
  const id=req.url.split('/')[2];reply(res,{request_id:id,status:state,video:{url:'https://cdn.example.com/fixture.mp4?MOCK-private-output'},error:'MOCK private echo'});
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 client=new HiggsfieldClient({mode:'test',credentials:'MOCK:secret',models:Object.values(HIGGSFIELD_MODELS),referenceOrigins:['https://media.example.com'],testBaseURL:`http://127.0.0.1:${provider.address().port}`});
 handler=new VideoProviderJobs(jobs,client,key);
});
afterEach(()=>{behavior='';state='queued';onSubmit=undefined;});
after(async()=>{provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));await Promise.all([pool.end(),app.end(),admin.end()]);});
async function fixture(user=alice,account){
 if(!account){account=await workspaces.create(user,{name:'Isolated MOCK video case'});
  if(user===alice)await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'viewer','all'),($1,$3,'editor','selected')",[account.id,viewer,selected]);
 }
 const b=await workspaces.createBrand(user,account.id,{name:'MOCK video'},randomUUID());
 await admin.query('INSERT INTO app.video_grants(organization_id,brand_id,enabled,models,budget_micros,max_create_micros,max_edit_micros,expires_at,operator_reference) VALUES($1,$2,true,$3,10000,100,200,now()+interval \'1 hour\',\'MOCK authorization only\')',[account.id,b.id,Object.values(HIGGSFIELD_MODELS)]);
 return {brand:b.id,org:account.id,user};
}
async function newJob(f,requested=f.user,kind='creative.video'){
 const id=randomUUID();await admin.query('INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,$5)',[id,f.org,f.brand,requested,kind]);
 return {organizationId:f.org,brandId:f.brand,jobId:id};
}
const intent=(kind='image')=>kind==='image'?{kind,model:HIGGSFIELD_MODELS.image,idempotencyKey:randomUUID(),referenceURL:'https://media.example.com/owned.png?MOCK-private-reference',prompt:'MOCK brand scene',durationSeconds:5,sound:'off'}:{kind,model:HIGGSFIELD_MODELS.edit,idempotencyKey:randomUUID(),referenceURL:'https://media.example.com/owned.mp4?MOCK-private-reference',prompt:'MOCK revise scene',quality:'std'};
const row=async s=>(await admin.query('SELECT o.*,j.status AS job_status,j.error_code AS job_error,r.state AS reservation_state,r.reserved_micros FROM app.video_operations o JOIN app.jobs j ON j.id=o.job_id JOIN app.video_reservations r ON r.job_id=o.job_id WHERE o.job_id=$1',[s.jobId])).rows[0];
const prepare=async(f,kind='image')=>{const s=await newJob(f),i=intent(kind);await handler.prepare(s,i);return {s,i};};

test('video provider stage freezes encrypted intent, reserves once and persists create/edit identity through polling',async()=>{
 const f=await fixture();
 for(const kind of ['image','edit']){
  const {s,i}=await prepare(f,kind),before=submits;
  await Promise.all(Array.from({length:4},()=>handler.prepare(s,i)));assert.equal((await row(s)).reserved_micros,kind==='image'?'100':'200');
  assert.ok(!(await row(s)).encrypted_intent.toString().includes('MOCK-private-reference'));
  await assert.rejects(handler.prepare(s,{...i,prompt:'MOCK different'}),/VIDEO_REPLAY_MISMATCH/);
  assert.equal(await handler.step(s),'accepted');state='in_progress';assert.equal(await handler.step(s),'accepted');
  state='completed';assert.equal(await new VideoProviderJobs(jobs,client,key).step(s),'completed');
  assert.equal(await handler.step(s),'completed');assert.equal(submits,before+1);
  const saved=await row(s);assert.ok(saved.remote_request_id);assert.equal(saved.job_status,'running');assert.equal(saved.reservation_state,'held');
  assert.equal((await handler.output(s)).url,'https://cdn.example.com/fixture.mp4?MOCK-private-output');
  assert.ok(!saved.encrypted_output.toString().includes('MOCK-private-output'));
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.video_observations WHERE job_id=$1',[s.jobId])).rows[0].n,2);
 }
 assert.ok(!JSON.stringify(handler).includes('secret'));assert.ok(!JSON.stringify(handler).includes(key));
});

test('concurrent preparation serializes per-business budget and never reserves beyond grant',async()=>{
 const f=await fixture();await admin.query('UPDATE app.video_grants SET budget_micros=100 WHERE brand_id=$1',[f.brand]);
 const a=await newJob(f),b=await newJob(f),results=await Promise.allSettled([handler.prepare(a,intent()),handler.prepare(b,intent())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/VIDEO_BUDGET_EXHAUSTED/);
 assert.equal((await admin.query('SELECT sum(reserved_micros)::int AS n FROM app.video_reservations WHERE brand_id=$1',[f.brand])).rows[0].n,100);
});

test('expired, disabled, wrong-model and changed grants reject before a paid request',async()=>{
 for(const change of ["enabled=false","expires_at=now()-interval '1 second'",`models=ARRAY['${HIGGSFIELD_MODELS.edit}']`]){
  const f=await fixture(),s=await newJob(f);await admin.query(`UPDATE app.video_grants SET ${change} WHERE brand_id=$1`,[f.brand]);
  await assert.rejects(handler.prepare(s,intent()),/VIDEO_STAGING_APPROVAL_REQUIRED/);
 }
 for(const change of ['enabled=false','max_create_micros=101','max_create_micros=99','budget_micros=1']){
  const f=await fixture(),{s}=await prepare(f),before=submits;await admin.query(`UPDATE app.video_grants SET ${change} WHERE brand_id=$1`,[f.brand]);
  assert.equal(await handler.step(s),'rejected');assert.equal(submits,before);assert.equal((await row(s)).reservation_state,'released');
 }
});

test('known rejection releases a never-accepted reservation; lost response holds it and never resubmits',async()=>{
 const f=await fixture(),{s}=await prepare(f);behavior='reject';const count=submits;
 assert.equal(await handler.step(s),'rejected');assert.equal((await row(s)).reservation_state,'released');
 assert.equal(await handler.step(s),'rejected');assert.equal(submits,count+1);
 const next=await prepare(f);behavior='lost';assert.equal(await handler.step(next.s),'unknown');
 assert.equal((await row(next.s)).reservation_state,'held');behavior='';assert.equal(await handler.step(next.s),'unknown');assert.equal(submits,count+2);
});

test('interrupted submission and failed receipt commit are held without a duplicate generation',async()=>{
 const f=await fixture(),a=await prepare(f),before=submits;
 await admin.query("UPDATE app.video_operations SET phase='submitting' WHERE job_id=$1",[a.s.jobId]);
 assert.equal(await handler.step(a.s),'unknown');assert.equal(submits,before);
 const b=await prepare(f);
 await admin.query("CREATE FUNCTION app.test_video_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.phase='accepted' THEN RAISE EXCEPTION 'TEST lost commit'; END IF; RETURN NEW; END$$");
 await admin.query('CREATE TRIGGER test_video_commit_failure BEFORE UPDATE ON app.video_operations FOR EACH ROW EXECUTE FUNCTION app.test_video_commit_failure()');
 try{await assert.rejects(handler.step(b.s),/TEST lost commit/);}finally{await admin.query('DROP TRIGGER test_video_commit_failure ON app.video_operations');await admin.query('DROP FUNCTION app.test_video_commit_failure()');}
 assert.equal((await row(b.s)).phase,'submitting');assert.equal(await handler.step(b.s),'unknown');assert.equal(submits,before+1);
});

test('concurrent activity copies produce at most one submission and a late valid receipt recovers its unknown marker',async()=>{
 const f=await fixture(),{s}=await prepare(f),before=submits;let release,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);onSubmit=async()=>{entered();await gate;};
 const first=handler.step(s);await started;assert.equal(await handler.step(s),'unknown');release();assert.equal(await first,'accepted');
 assert.equal(submits,before+1);assert.equal((await row(s)).phase,'accepted');
});

test('cancel before submission releases reservation; queued remote cancellation is reconciled exactly once',async()=>{
 const f=await fixture(),a=await prepare(f),before=submits;await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[a.s.jobId]);
 assert.equal(await handler.step(a.s),'canceled');assert.equal(submits,before);assert.equal((await row(a.s)).reservation_state,'released');
 const b=await prepare(f);await handler.step(b.s);await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[b.s.jobId]);const c=cancels;
 assert.equal(await handler.step(b.s),'canceled');assert.equal(await handler.step(b.s),'canceled');assert.equal(cancels,c+1);
 assert.equal((await row(b.s)).reservation_state,'held');await assert.rejects(handler.output(b.s),/VIDEO_ACCESS_REVOKED/);
});

test('processing may beat cancellation; output remains unavailable to a canceled requester',async()=>{
 const f=await fixture(),{s}=await prepare(f);await handler.step(s);state='in_progress';await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[s.jobId]);
 assert.equal(await handler.step(s),'accepted');assert.equal((await row(s)).cancel_phase,'rejected');const count=cancels;
 state='completed';assert.equal(await handler.step(s),'completed');assert.equal(cancels,count);
 await assert.rejects(handler.output(s),/VIDEO_ACCESS_REVOKED/);assert.equal((await row(s)).reservation_state,'held');
});

test('lost cancellation is never blindly repeated; authenticated reads can still determine the terminal state',async()=>{
 const f=await fixture(),{s}=await prepare(f);await handler.step(s);behavior='cancelLost';await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[s.jobId]);const count=cancels;
 assert.equal(await handler.step(s),'accepted');assert.equal((await row(s)).cancel_phase,'unknown');behavior='';state='canceled';
 assert.equal(await handler.step(s),'canceled');assert.equal(cancels,count+1);
});

test('status outages preserve remote ID and reservation; deadline exhaustion retains uncertainty',async()=>{
 const f=await fixture(),{s}=await prepare(f);await handler.step(s);const remote=(await row(s)).remote_request_id,before=submits;behavior='statusFail';
 await assert.rejects(handler.step(s),/VIDEO_STATUS_UNAVAILABLE/);assert.equal((await row(s)).remote_request_id,remote);assert.equal((await row(s)).phase,'accepted');
 behavior='';state='completed';assert.equal(await handler.step(s),'completed');assert.equal(submits,before);
 const b=await prepare(f);await handler.step(b.s);await admin.query("UPDATE app.video_operations SET deadline_at=now()-interval '1 second' WHERE job_id=$1",[b.s.jobId]);
 assert.equal(await handler.step(b.s),'unknown');assert.equal((await row(b.s)).remote_request_id!==null,true);assert.equal((await row(b.s)).reservation_state,'held');
});

test('failed and moderation-rejected provider work never becomes successful product media or assumed refunds',async()=>{
 const f=await fixture();for(const terminal of ['failed','nsfw']){
  const {s}=await prepare(f);await handler.step(s);state=terminal;assert.equal(await handler.step(s),terminal);
  const r=await row(s);assert.equal(r.job_status,terminal==='failed'?'failed':'rejected');assert.equal(r.reservation_state,'held');assert.equal(r.encrypted_output,null);
  await assert.rejects(handler.output(s),/VIDEO_OUTPUT_NOT_READY/);
 }
});

test('RLS, job type, readonly membership and selected-business revocation protect the provider stage',async()=>{
 const f=await fixture(),other=await fixture(bob,otherOrg),a=await prepare(f),b=await prepare(other);
 await assert.rejects(handler.step({...a.s,brandId:other.brand}),/JOB_SCOPE_DENIED/);
 await assert.rejects(handler.step({...a.s,organizationId:other.org}),/JOB_SCOPE_DENIED/);
 await jobs.transaction(a.s,async db=>{
  assert.equal((await db.query('SELECT job_id FROM app.video_operations')).rowCount,1);
  assert.equal((await db.query('SELECT job_id FROM app.video_operations WHERE job_id=$1',[b.s.jobId])).rowCount,0);
 });
 await assert.rejects(handler.prepare(await newJob(f,viewer),intent()),/VIDEO_ACCESS_REVOKED/);
 await assert.rejects(handler.prepare(await newJob(f,alice,'creative.generate'),intent()),/VIDEO_JOB_KIND_DENIED/);
 await assert.rejects(handler.prepare(await newJob(f,selected),intent()),/VIDEO_ACCESS_REVOKED/);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'editor')",[f.org,f.brand,selected]);
 const s=await newJob(f,selected);await handler.prepare(s,intent());await admin.query('UPDATE app.business_memberships SET active=false WHERE user_id=$1',[selected]);
 const before=submits;assert.equal(await handler.step(s),'canceled');assert.equal(submits,before);
 const own=await database.transaction(alice,f.org,false,db=>db.query('SELECT job_id,phase FROM app.video_operations'),f.brand);assert.ok(own.rows.some(r=>r.job_id===a.s.jobId));
 for(const sql of ['SELECT encrypted_intent FROM app.video_operations','SELECT encrypted_output FROM app.video_operations','UPDATE app.video_grants SET enabled=true','INSERT INTO app.video_operations DEFAULT VALUES'])await assert.rejects(app.query(sql),e=>e.code==='42501');
 for(const sql of ['UPDATE app.video_operations SET provider_key=gen_random_uuid()','UPDATE app.video_operations SET encrypted_intent=decode(\'00\',\'hex\')','UPDATE app.video_reservations SET reserved_micros=1','UPDATE app.video_grants SET enabled=true'])await assert.rejects(pool.query(sql),e=>e.code==='42501');
 assert.equal((await pool.query('SELECT * FROM app.video_operations')).rowCount,0);
});

test('encrypted state is bound to business, job and purpose; tampering cannot trigger another paid request',async()=>{
 const f=await fixture(),{s}=await prepare(f),vault=new VideoVault(key),r=await row(s);
 assert.throws(()=>vault.open({...s,jobId:randomUUID()},'intent',r.encrypted_intent),/VIDEO_STATE_INVALID/);
 assert.throws(()=>vault.open(s,'output',r.encrypted_intent),/VIDEO_STATE_INVALID/);
 const tampered=Buffer.from(r.encrypted_intent);tampered[tampered.length-1]^=1;
 await admin.query('UPDATE app.video_operations SET encrypted_intent=$2 WHERE job_id=$1',[s.jobId,tampered]);const before=submits;
 await assert.rejects(handler.step(s),/VIDEO_STATE_INVALID/);assert.equal(submits,before);assert.equal((await row(s)).phase,'prepared');
});

test('request-key collision rolls back the new reservation and job cannot rewrite the existing intent',async()=>{
 const f=await fixture(),a=await prepare(f),b=await newJob(f);
 await assert.rejects(handler.prepare(b,a.i),e=>e.code==='23505');
 assert.equal((await admin.query('SELECT job_id FROM app.video_reservations WHERE job_id=$1',[b.jobId])).rowCount,0);
 assert.equal((await row(a.s)).phase,'prepared');
});

test('membership loss after acceptance permits cleanup/status only and cannot expose a completed output',async()=>{
 const f=await fixture();await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'editor')",[f.org,f.brand,selected]);
 const s=await newJob(f,selected);await handler.prepare(s,intent());await handler.step(s);const before=submits;
 await admin.query('UPDATE app.business_memberships SET active=false WHERE brand_id=$1 AND user_id=$2',[f.brand,selected]);
 state='in_progress';assert.equal(await handler.step(s),'accepted');state='completed';assert.equal(await handler.step(s),'completed');
 await assert.rejects(handler.output(s),/VIDEO_ACCESS_REVOKED/);assert.equal(submits,before);
});

test('real Temporal timer survives worker replacement and resumes the saved provider ID without resubmission',async()=>{
 const f=await fixture(),{s}=await prepare(f);await handler.step(s);const before=submits;
 const connection=await Connection.connect({address:config.jobs.address}),native=await NativeConnection.connect({address:config.jobs.address});
 const temporal=new Client({connection,namespace:config.jobs.namespace}),taskQueue='video-'+randomUUID();let first,second,firstRun;
 const options={connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/video-provider-workflow.js',import.meta.url)),activities:{
  stepVideoProvider:async scope=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await handler.step(scope);}finally{clearInterval(heartbeat);}},
  exhaustVideoProvider:scope=>handler.exhausted(scope),
 }};
 try{
  first=await Worker.create(options);firstRun=first.run();const handle=await temporal.workflow.start('videoProviderWorkflow',{workflowId:'video-test-'+s.jobId,taskQueue,args:[s]});
  let timer=false;for(let n=0;n<100;n++){const history=await handle.fetchHistory();timer=history.events.some(e=>e.timerStartedEventAttributes);if(timer)break;await delay(100);}
  assert.equal(timer,true);first.shutdown();await firstRun;firstRun=undefined;first=undefined;
  assert.equal((await handle.describe()).status.name,'RUNNING');state='completed';
  second=await Worker.create(options);assert.equal(await second.runUntil(()=>handle.result()),'completed');second=undefined;
  assert.equal(submits,before);assert.equal((await row(s)).job_status,'running');
 }finally{first?.shutdown();second?.shutdown();if(firstRun)await firstRun.catch(()=>{});await native.close();await connection.close();}
});
