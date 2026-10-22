import {createServer} from 'node:http';
import {Publication} from '../../dist/publication.js';
import {PublicationJobs} from '../../dist/publication-jobs.js';
import {SocialConnections} from '../../dist/social-connections.js';
import {PostizVault} from '../../dist/postiz-vault.js';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import sharp from 'sharp';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Client,Connection} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {createApplication} from '../../dist/app.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {BrandBrain,canonicalJSON,hash} from '../../dist/brand-brain.js';
import {Canvas} from '../../dist/canvas.js';
import {ContentPlan} from '../../dist/content-plan.js';
import {CreativeExports} from '../../dist/creative-exports.js';
import {StaticRenderer} from '../../dist/static-renderer.js';
import {ExportJobs} from '../../dist/export-jobs.js';
import {ObjectStore,digest} from '../../dist/object-store.js';
import {AssetJobs,JobDispatcher} from '../../dist/jobs.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const store=new ObjectStore(config.storage),renderer=new StaticRenderer(process.env.RENDER_RUNTIME_IMAGE),jobs=new AssetJobs(workerPool,store,null),exportHandler=new ExportJobs(jobs,renderer);
let app,base,ws,businesses,brain,canvas,plans,exports,alice,bob,editor,viewer,org,brand,sibling,brainId,current,project,canonical;
const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#eee7db'}}).png().toBuffer();
const scope=j=>({organizationId:org.id,brandId:brand.id,jobId:j.id});
async function api(path,{user=alice,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin:config.origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
const path=(suffix,b=brand)=>`/api/v1/businesses/${b.id}/${suffix}`;
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const email=randomUUID()+'@example.test',password='long-fixture-password-2026';const r=await api('/api/auth/sign-up/email',{user:null,body:{name:'Export fixture',email,password},method:'POST'});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const login=await api('/api/auth/sign-in/email',{user:null,body:{email,password},method:'POST'});assert.equal(login.status,200);return {id:r.body.user.id,cookie:login.cookie};}
async function fixture(overrides={}){
 const thread=await canvas.createThread(alice.id,brand.id,{title:'TEST FIXTURE render'},randomUUID()),p=randomUUID(),job=randomUUID(),media=randomUUID(),id=randomUUID();
 const key=`creative/${org.id}/${brand.id}/${job}/${digest(png)}`;await store.persist(key,png,'image/png',digest(png));
 const design={schema_version:1,width:1024,height:1024,background_media_id:media,layers:[{id:'headline',type:'text',text:'TEST FIXTURE: A calmer day',x:80,y:80,width:850,fontSize:56,fontFamily:'Arial',fill:'#112233',align:'left'},{id:'body',type:'text',text:'Owner-editable creative',x:80,y:700,width:850,fontSize:32,fontFamily:'Georgia',fill:'#112233',align:'left'}],...overrides};
 const caption='TEST FIXTURE: renderer input, not AI generation',sha=hash(canonicalJSON({design,caption,brain_id:brainId}));
 await admin.query('INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[p,org.id,brand.id,thread.id,'TEST FIXTURE',alice.id]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'creative.generate','succeeded')",[job,org.id,brand.id,alice.id]);
 await admin.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,1024,1024)',[media,org.id,brand.id,job,key,digest(png),png.length]);
 await admin.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,org.id,brand.id,p,brainId,job,media,JSON.stringify(design),caption,'{}',sha,alice.id]);await admin.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[p,id]);
 return {id,sha256:sha,design,caption,project_id:p,media_id:media};
}
async function queue(v=current){return exports.submit(alice.id,brand.id,v.id,{source_sha256:v.sha256},randomUUID());}
async function render(v){const j=await queue(v);assert.equal(await exportHandler.run(scope(j)),'succeeded');return (await exports.list(alice.id,brand.id,v.id)).exports[0];}
before(async()=>{
 config.socialEnabled=true;config.publishingEnabled=true;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses);exports=new CreativeExports(canvas,renderer.image);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();org=await ws.create(alice.id,{name:'Export fixtures'});brand=await ws.createBrand(alice.id,org.id,{name:'Render fixtures'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Other private brand'},randomUUID());
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 for(const [field,value] of [['brand_name','Render fixtures'],['offering','Creative workflow tools'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;current=await fixture();project=current.project_id;await setupProvider();
});
after(async()=>{store.close();await app?.close();await Promise.all([admin.end(),workerPool.end()]);});


// Actual local immutable rendered exports, approval API, private S3 and jobs.
// All remote Postiz responses below are explicitly MOCK, never external posting.
const encryptionKey=randomBytes(32).toString('hex'),credential='MOCK_'+randomBytes(24).toString('hex');
let provider,providerBase,publisher,handler,channelId,mode='',uploads=0,submissions=0,postRows=[],lastUpload,afterUpload,remoteState='QUEUE';
const reply=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
async function setupProvider(){
 const binding={organization_id:org.id,brand_id:brand.id,remote_organization_id:'publication-mock-org',revision:1};
 await admin.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,true,now())',[org.id,brand.id,binding.remote_organization_id,new PostizVault(encryptionKey).seal(binding,credential),createHash('sha256').update(credential).digest('hex')]);
 const j=randomUUID();channelId=randomUUID();await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'social.sync','succeeded')",[j,org.id,brand.id,alice.id]);
 await admin.query("INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) VALUES($1,$2,$3,'publication-mock-channel','linkedin','MOCK staging profile','available',now(),now(),1,$4)",[channelId,org.id,brand.id,j]);
 await admin.query("INSERT INTO app.publication_grants VALUES($1,$2,$3,now()+interval '1 day',100,'TEST FIXTURE: no live authorization')",[org.id,brand.id,channelId]);
 provider=createServer(async(req,res)=>{const parts=[];for await(const p of req)parts.push(p);const raw=Buffer.concat(parts);assert.equal(req.headers.authorization,credential);
  if(req.url==='/api/public/v1/me')return reply(res,{organization:{id:binding.remote_organization_id,name:'MOCK org'}});
  if(req.url==='/api/public/v1/integrations')return reply(res,[{id:'publication-mock-channel',identifier:'linkedin',name:'MOCK staging profile',disabled:false}]);
  if(req.url==='/api/public/v1/upload'){uploads++;const start=raw.indexOf(Buffer.from('Content-Type: image/png\r\n\r\n'))+'Content-Type: image/png\r\n\r\n'.length,end=raw.lastIndexOf(Buffer.from('\r\n--'));lastUpload=raw.subarray(start,end);assert.equal((await sharp(lastUpload).metadata()).format,'png');if(afterUpload)await afterUpload();if(mode==='uploadLost'){req.socket.destroy();return;}return reply(res,{id:'mock-upload-'+uploads,path:providerBase+'/uploads/mock-'+uploads+'.png'});}
  if(req.url==='/api/public/v1/posts'){submissions++;if(mode==='postRejected')return reply(res,{},401);const body=JSON.parse(raw),id='mock-post-'+randomUUID();postRows.push({id,integration:{id:body.posts[0].integration.id,providerIdentifier:'linkedin'},content:body.posts[0].value[0].content,publishDate:body.date,state:remoteState,releaseId:remoteState==='PUBLISHED'?'MOCK_RELEASE':null,releaseURL:null});if(mode==='postLost'){req.socket.destroy();return;}return reply(res,[{postId:id,integration:body.posts[0].integration.id}]);}
  if(req.url.startsWith('/api/public/v1/posts?')){if(mode==='listFail')return reply(res,{},503);return reply(res,{posts:mode==='listMissing'?[]:mode==='listMismatch'?postRows.map(p=>({...p,integration:{...p.integration,id:'foreign-channel'}})):postRows});}reply(res,{},404);
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerBase='http://127.0.0.1:'+provider.address().port;
 publisher=new Publication(new SocialConnections(businesses,true),exports,true);handler=new PublicationJobs(jobs,{client:{baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test'},encryptionKey},renderer.image,true);
}
afterEach(()=>{mode='';afterUpload=undefined;remoteState='QUEUE';});
after(async()=>{provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));});
async function approvedPost(){const v=await fixture(),e=await render(v),date=new Date(Math.floor(Date.now()/60000)*60000+2*86400000).toISOString(),start=date.slice(0,10),p=await plans.create(alice.id,brand.id,{title:'MOCK publication',objective:'Approved publication test',starts_on:start,timezone:'UTC',slots:[{channel:'linkedin',format:'static',planned_at:date,brief:'TEST FIXTURE',creative_version_id:v.id}]},randomUUID());
 let slot=(await plans.list(alice.id,brand.id,{start:start+'T00:00:00Z',end:new Date(Date.parse(start)+30*86400000).toISOString(),plan_id:p.id})).slots[0];slot=await plans.review(alice.id,brand.id,slot.id,{revision:slot.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 await exports.approve(alice.id,brand.id,e.id,{sha256:e.sha256,source_sha256:v.sha256,context_type:'slot',context_id:slot.id,context_revision:slot.revision,confirmed:true});slot=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[slot.id])).rows[0];return {v,e,slot,body:{slot_id:slot.id,revision:slot.revision,export_id:e.id,channel_id:channelId,confirmed:true}};
}
const queuePost=f=>publisher.submit(alice.id,brand.id,f.body,randomUUID());
const record=async j=>(await admin.query('SELECT r.*,j.status,j.error_code FROM app.publication_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.job_id=$1',[j.id])).rows[0];

test('publication requires auth, exact approval, explicit consent and a scoped staging grant; duplicate requests coalesce',async()=>{
 const f=await approvedPost(),endpoint=path('publications'),key=randomUUID();
 assert.equal((await api(endpoint,{user:null})).status,401);assert.equal((await api(endpoint,{user:bob})).status,404);
 for(const user of [editor,viewer])assert.equal((await api(endpoint,{user,body:f.body,method:'POST',key})).status,403);
 assert.equal((await api(endpoint,{body:{...f.body,confirmed:false},method:'POST',key})).status,400);
 const capability=await publisher.list(alice.id,brand.id);assert.equal(capability.can_manage,true);assert.deepEqual(capability.destinations,[{id:channelId,name:'MOCK staging profile',provider:'linkedin'}]);assert.equal((await publisher.list(viewer.id,brand.id)).can_manage,false);
 await assert.rejects(publisher.submit(alice.id,brand.id,{...f.body,export_id:randomUUID()},randomUUID()),/current/);
 const unapproved=await approvedPost();await admin.query('DELETE FROM app.creative_export_approvals WHERE export_id=$1',[unapproved.e.id]);await assert.rejects(queuePost(unapproved),/final saved image/);
 await admin.query("UPDATE app.publication_grants SET expires_at=now()-interval '1 second'");try{await assert.rejects(queuePost(f),/not authorized/);}finally{await admin.query("UPDATE app.publication_grants SET expires_at=now()+interval '1 day'");}
 await assert.rejects(publisher.submit(alice.id,brand.id,{...f.body,revision:99},randomUUID()),/current/);
 const ready=await publisher.ready(alice.id,brand.id);assert.ok(ready.posts.some(p=>p.slot_id===f.slot.id&&p.export_id===f.e.id));assert.ok(!ready.posts.some(p=>p.slot_id===unapproved.slot.id));assert.ok(!JSON.stringify(ready).includes('object_key'));assert.equal((await publisher.ready(alice.id,sibling.id)).posts.length,0);
 const results=await Promise.all([api(endpoint,{body:f.body,method:'POST',key}),api(endpoint,{body:f.body,method:'POST',key})]);results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));assert.equal(results[0].body.id,results[1].body.id);const j=results[0].body;
 assert.ok(!(await publisher.ready(alice.id,brand.id)).posts.some(p=>p.slot_id===f.slot.id));await assert.rejects(queuePost(f),/already/);await assert.rejects(publisher.submit(alice.id,brand.id,{...f.body,channel_id:randomUUID()},key),/another publication/);
 await publisher.cancel(alice.id,brand.id,j.id);const count=uploads;assert.equal(await handler.run(scope(j)),'rejected');assert.equal(uploads,count);assert.equal((await record(j)).phase,'canceled');
});
test('actual Temporal workflow uploads exact approved PNG, submits once and records a proven remote publication',async()=>{
 const f=await approvedPost(),j=await queuePost(f),count=submissions;remoteState='PUBLISHED';
 const native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='publication-'+randomUUID();
 const temporal=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{publishSocial:async s=>{const ctx=Context.current(),timer=setInterval(()=>ctx.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(timer);}},reconcileSocial:s=>handler.reconcile(s),failPublication:s=>handler.fail(s)}});
 const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl});
 try{const client=new Client({connection,namespace:config.jobs.namespace}),dispatcher=new JobDispatcher(dispatchPool,client,taskQueue);await admin.query('UPDATE app.job_dispatch SET dispatched_at=now() WHERE job_id<>$1',[j.id]);assert.equal(await temporal.runUntil(async()=>{assert.equal(await dispatcher.runOnce(),true);return client.workflow.getHandle('desvio-publish-'+j.id).result();}),'published');}finally{await dispatchPool.end();await native.close();await connection.close();}
 const r=await record(j);assert.equal(r.phase,'accepted');assert.equal(r.observed_state,'published');assert.equal(r.release_id,'MOCK_RELEASE');assert.equal(digest(lastUpload),f.e.sha256);assert.equal(submissions,count+1);assert.equal(await handler.run(scope(j)),'accepted');assert.equal(submissions,count+1);
 await assert.rejects(publisher.cancel(alice.id,brand.id,j.id),/already/);const list=await publisher.list(alice.id,brand.id);assert.equal(list.publications.find(p=>p.id===j.id).account_name,'MOCK staging profile');assert.ok(!JSON.stringify(list).includes(credential));assert.ok(!JSON.stringify(list).includes('object_key'));assert.ok(!JSON.stringify(list).includes('remote_media'));
});
test('accepted is not published; reconciliation preserves observations on failures and reports missing or changed remote posts',async()=>{
 const f=await approvedPost(),j=await queuePost(f);assert.equal(await handler.run(scope(j)),'accepted');assert.equal((await record(j)).observed_state,'unconfirmed');assert.equal((await handler.reconcile(scope(j))).state,'queued');
 mode='listFail';await assert.rejects(handler.reconcile(scope(j)),/SOCIAL_READ_UNAVAILABLE/);assert.equal((await record(j)).observed_state,'queued');assert.equal((await record(j)).check_error,'POSTIZ_UNAVAILABLE');
 mode='listMissing';assert.equal((await handler.reconcile(scope(j))).state,'missing');mode='listMismatch';assert.equal((await handler.reconcile(scope(j))).state,'check_failed');assert.equal((await record(j)).observed_state,'missing');mode='';
 const check=await publisher.reconcile(alice.id,brand.id,j.id,randomUUID());assert.equal((await handler.reconcile(scope(check))).state,'queued');assert.equal((await admin.query('SELECT status FROM app.jobs WHERE id=$1',[check.id])).rows[0].status,'succeeded');
 const actual=(await record(j)).remote_post_id;postRows.find(p=>p.id===actual).state='PUBLISHED';assert.equal((await handler.reconcile(scope(j))).state,'unknown');postRows.find(p=>p.id===actual).releaseId='MOCK_RELEASE_CONFIRMED';assert.equal((await handler.reconcile(scope(j))).state,'published');
});
test('lost upload or submit responses hold the slot without retrying mutations',async()=>{
 for(const fault of ['uploadLost','postLost']){const f=await approvedPost(),j=await queuePost(f);mode=fault;const count=submissions;await handler.run(scope(j));assert.equal((await record(j)).phase,'unknown');const writes=uploads,posts=submissions;await handler.run(scope(j));assert.equal(uploads,writes);assert.equal(submissions,posts);assert.equal(submissions-count,fault==='postLost'?1:0);await assert.rejects(queuePost(f),/already/);await assert.rejects(publisher.reconcile(alice.id,brand.id,j.id,randomUUID()),/no acknowledged/);mode='';}
});
test('changed approval, expired grant, revoked access and disabled credentials prevent external writes',async()=>{
 for(const reason of ['approval','grant','access','account']){const f=await approvedPost(),j=await queuePost(f),count=uploads;
  if(reason==='approval')await plans.edit(alice.id,brand.id,f.slot.id,{revision:f.slot.revision,brief:'Owner changed the brief',reset_approval:true});
  if(reason==='grant')await admin.query("UPDATE app.publication_grants SET expires_at=now()-interval '1 second'");
  if(reason==='access')await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[org.id,alice.id]);
  if(reason==='account')await admin.query('UPDATE app.postiz_accounts SET enabled=false WHERE brand_id=$1',[brand.id]);
  try{await handler.run(scope(j));assert.equal(uploads,count);assert.ok(['rejected','canceled'].includes((await record(j)).phase));}finally{await admin.query("UPDATE app.publication_grants SET expires_at=now()+interval '1 day'");await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[org.id,alice.id]);await admin.query('UPDATE app.postiz_accounts SET enabled=true WHERE brand_id=$1',[brand.id]);}
 }
});
test('approval is rechecked after upload and before submission; accepted-post persistence loss is held',async()=>{
 let f=await approvedPost(),j=await queuePost(f),count=submissions;afterUpload=()=>admin.query('UPDATE app.content_slots SET revision=revision+1 WHERE id=$1',[f.slot.id]);await handler.run(scope(j));assert.equal(submissions,count);assert.equal((await record(j)).phase,'rejected');afterUpload=undefined;
 f=await approvedPost();j=await queuePost(f);count=submissions;await admin.query("CREATE FUNCTION app.test_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.phase='accepted' THEN RAISE EXCEPTION 'TEST lost local commit'; END IF; RETURN NEW; END$$");await admin.query('CREATE TRIGGER test_publication_failure BEFORE UPDATE ON app.publication_requests FOR EACH ROW EXECUTE FUNCTION app.test_publication_failure()');
 try{await assert.rejects(handler.run(scope(j)),/TEST lost local commit/);}finally{await admin.query('DROP TRIGGER test_publication_failure ON app.publication_requests');await admin.query('DROP FUNCTION app.test_publication_failure()');}
 assert.equal(submissions,count+1);await handler.run(scope(j));assert.equal((await record(j)).phase,'unknown');assert.equal(submissions,count+1);
});
test('worker/app SQL cannot forge approval, alter immutable snapshots or cross tenant/job scope',async()=>{
 const f=await approvedPost(),j=await queuePost(f);await assert.rejects(handler.run({...scope(j),brandId:sibling.id}),/JOB_SCOPE_DENIED/);
 assert.equal((await workerPool.query('SELECT * FROM app.publication_requests')).rowCount,0);await assert.rejects(workerPool.query("UPDATE app.publication_requests SET caption='FORGED'"),e=>e.code==='42501');await assert.rejects(workerPool.query('INSERT INTO app.publication_grants SELECT * FROM app.publication_grants'),e=>e.code==='42501');await assert.rejects(app.database.pool.query("UPDATE app.publication_requests SET phase='accepted'"),e=>e.code==='42501');
 await jobs.transaction(scope(j),async db=>{assert.equal((await db.query('SELECT * FROM app.publication_requests')).rowCount,1);assert.equal((await db.query('SELECT * FROM app.creative_exports')).rowCount,1);await assert.rejects(db.query('UPDATE app.creative_export_approvals SET context_revision=99'),e=>e.code==='42501');}).catch(e=>{if(e.code!=='25P02')throw e;});
 await publisher.cancel(alice.id,brand.id,j.id);await handler.run(scope(j));
});

test('definite provider rejection permits an explicit new attempt; corrupted saved pixels never upload',async()=>{
 const f=await approvedPost();let j=await queuePost(f);mode='postRejected';await handler.run(scope(j));assert.equal((await record(j)).phase,'rejected');mode='';j=await queuePost(f);assert.equal(await handler.run(scope(j)),'accepted');
 const corrupt=await approvedPost(),bad=await queuePost(corrupt),read=store.read.bind(store),count=uploads;store.read=async()=>Buffer.from('CORRUPT TEST BYTES');try{await handler.run(scope(bad));assert.equal((await record(bad)).error_code,'PUBLICATION_IMAGE_INVALID');assert.equal(uploads,count);}finally{store.read=read;}
});
test('publication is disabled by default, holds daily reservations, and stores immutable observation history',async()=>{
 const f=await approvedPost();await assert.rejects(new Publication(new SocialConnections(businesses,true),exports).submit(alice.id,brand.id,f.body,randomUUID()),/not been enabled/);
 await admin.query('UPDATE app.publication_grants SET daily_limit=1');try{await assert.rejects(queuePost(f),/daily publishing limit/);}finally{await admin.query('UPDATE app.publication_grants SET daily_limit=100');}
 const j=await queuePost(f);remoteState='PUBLISHED';await handler.run(scope(j));await handler.reconcile(scope(j));mode='listMissing';await handler.reconcile(scope(j));const history=await publisher.history(alice.id,brand.id,j.id);assert.deepEqual(history.observations.map(x=>x.state),['missing','published']);assert.equal(history.observations[1].release_id,'MOCK_RELEASE');await assert.rejects(publisher.history(bob.id,brand.id,j.id));await assert.rejects(workerPool.query('DELETE FROM app.publication_observations'),e=>e.code==='42501');
});

test('overview aggregates actual business records and denies foreign tenants',async()=>{
 const r=await api(path('overview'));assert.equal(r.status,200);assert.equal(r.body.business_id,brand.id);assert.equal(r.body.analytics_available,false);
 const expected=(await admin.query("SELECT count(*)::int AS n FROM app.publication_requests WHERE brand_id=$1 AND phase='accepted' AND observed_state='published'",[brand.id])).rows[0].n;assert.equal(r.body.counts.published_posts,expected);assert.ok(r.body.counts.creative_projects>0);assert.equal((await api(path('overview'),{user:bob})).status,404);assert.equal((await api(path('overview'),{user:viewer})).status,200);const other=await api(path('overview',sibling));assert.equal(other.body.counts.creative_projects,0);assert.equal(other.body.counts.published_posts,0);assert.equal(other.body.activity.length,0);
});
