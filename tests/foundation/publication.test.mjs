import {Publication} from '../../dist/publication.js';
import {SocialConnections} from '../../dist/social-connections.js';
import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
async function render(v,format='png'){const j=await exports.submit(alice.id,brand.id,v.id,{source_sha256:v.sha256,format},randomUUID());assert.equal(await exportHandler.run(scope(j)),'succeeded');return (await exports.list(alice.id,brand.id,v.id)).exports[0];}
before(async()=>{
 app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses,renderer.image);exports=new CreativeExports(canvas,renderer.image);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();org=await ws.create(alice.id,{name:'Export fixtures'});brand=await ws.createBrand(alice.id,org.id,{name:'Render fixtures'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Other private brand'},randomUUID());
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 for(const [field,value] of [['brand_name','Render fixtures'],['offering','Creative workflow tools'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;current=await fixture();project=current.project_id;await setupProvider();
});
after(async()=>{store.close();await app?.close();await Promise.all([admin.end(),workerPool.end()]);});

async function approvedPost(channel='linkedin'){const v=await fixture(),e=await render(v,channel==='instagram'?'instagram-jpeg':'png'),date=new Date(Math.floor(Date.now()/60000)*60000+2*86400000).toISOString(),start=date.slice(0,10),p=await plans.create(alice.id,brand.id,{title:'MOCK publication',objective:'Approved publication test',starts_on:start,timezone:'UTC',slots:[{channel,format:'static',planned_at:date,brief:'TEST FIXTURE',creative_version_id:v.id}]},randomUUID());
 let slot=(await plans.list(alice.id,brand.id,{start:start+'T00:00:00Z',end:new Date(Date.parse(start)+30*86400000).toISOString(),plan_id:p.id})).slots[0];slot=await plans.review(alice.id,brand.id,slot.id,{revision:slot.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 await exports.approve(alice.id,brand.id,e.id,{sha256:e.sha256,source_sha256:v.sha256,context_type:'slot',context_id:slot.id,context_revision:slot.revision,confirmed:true});slot=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[slot.id])).rows[0];return {v,e,slot,body:{slot_id:slot.id,revision:slot.revision,export_id:e.id,confirmed:true}};
}

const ready=()=>new Publication(new SocialConnections(businesses,true),exports,true).ready(alice.id,brand.id);

test('Post for Me is the only publisher: Postiz connection, publishing and analytics routes are gone',async()=>{
 for(const [method,suffix] of [['GET','connections'],['POST','connections/prepare'],['POST','connections/oauth/linkedin'],['POST','connections/refresh'],['GET','publications'],['POST','publications'],['GET','publications/ready'],['GET','analytics']])
  assert.equal((await api(path(suffix),{method,key:randomUUID(),body:method==='POST'?{}:undefined})).status,404,`${method} ${suffix}`);
 const connections=await api(path('postforme/connections'));assert.equal(connections.status,200);assert.equal(connections.body.provider,'postforme');
 assert.equal((await api(path('postforme/connections'),{user:bob})).status,404);
});

test('approved posts are offered for Post for Me; a slot held by a historical Postiz request is never offered again',async()=>{
 const fresh=await approvedPost(),held=await approvedPost();
 const offered=(await ready()).posts.map(p=>p.slot_id);assert.ok(offered.includes(fresh.slot.id));assert.ok(offered.includes(held.slot.id));
 const viaApi=await api(path('postforme/publications/ready'));assert.equal(viaApi.status,200);assert.ok(viaApi.body.posts.some(p=>p.slot_id===fresh.slot.id&&p.export_id===fresh.e.id));
 // History is kept: a request made through Postiz before it was retired still holds its slot.
 const sync=randomUUID(),channel=randomUUID(),job=randomUUID();
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'social.sync','succeeded')",[sync,org.id,brand.id,alice.id]);
 await admin.query("INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) VALUES($1,$2,$3,'historical-channel','linkedin','Historical profile','available',now(),now(),1,$4)",[channel,org.id,brand.id,sync]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'social.publish','succeeded')",[job,org.id,brand.id,alice.id]);
 await admin.query("INSERT INTO app.publication_requests(job_id,organization_id,brand_id,slot_id,slot_revision,export_id,channel_id,remote_channel_id,account_revision,caption,scheduled_at,image_sha256,request_key,request_hash,phase,observed_state) VALUES($1,$2,$3,$4,$5,$6,$7,'historical-channel',1,'Historical caption',$8,$9,$10,'historical','accepted','published')",
  [job,org.id,brand.id,held.slot.id,held.slot.revision,held.e.id,channel,held.slot.planned_at,held.e.sha256,'historical-'+randomUUID()]);
 const after=(await ready()).posts.map(p=>p.slot_id);assert.ok(after.includes(fresh.slot.id));assert.equal(after.includes(held.slot.id),false);
 // The overview still counts what was published before, and stays business-scoped.
 const overview=await api(path('overview'));assert.equal(overview.status,200);assert.ok(overview.body.counts.published_posts>=1);
 assert.equal((await api(path('overview'),{user:bob})).status,404);assert.equal((await api(path('overview',sibling))).body.counts.published_posts,0);
});

test('a leftover queued Postiz job is closed in the queue and never starts a workflow',async()=>{
 const job=randomUUID();
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.publish')",[job,org.id,brand.id,alice.id]);
 await admin.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind,created_at) VALUES($1,$2,$3,'social.publish',now()-interval '10 years')",[job,org.id,brand.id]);
 const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl}),started=[];
 try{
  const dispatcher=new JobDispatcher(dispatchPool,{workflow:{start:async(name,options)=>{started.push([name,options.args[0].jobId]);}}},'desvio-test');
  assert.equal(await dispatcher.runOnce(),true);
  const row=(await admin.query('SELECT dispatched_at,last_error FROM app.job_dispatch WHERE job_id=$1',[job])).rows[0];
  assert.ok(row.dispatched_at);assert.equal(row.last_error,'POSTIZ_RETIRED');assert.equal(started.some(([,id])=>id===job),false);
 }finally{await dispatchPool.end();}
});
