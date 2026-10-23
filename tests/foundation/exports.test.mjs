import {test,before,after} from 'node:test';
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
import {AssetJobs} from '../../dist/jobs.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const store=new ObjectStore(config.storage),renderer=new StaticRenderer(process.env.RENDER_RUNTIME_IMAGE),jobs=new AssetJobs(workerPool,store,null),handler=new ExportJobs(jobs,renderer);
let app,base,ws,businesses,brain,canvas,plans,exports,alice,bob,editor,viewer,reviewer,org,brand,sibling,brainId,current,project,canonical;
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
async function render(v){const j=await queue(v);assert.equal(await handler.run(scope(j)),'succeeded');return (await exports.list(alice.id,brand.id,v.id)).exports[0];}
before(async()=>{
 app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses,renderer.image);exports=new CreativeExports(canvas,renderer.image);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();org=await ws.create(alice.id,{name:'Export fixtures'});brand=await ws.createBrand(alice.id,org.id,{name:'Render fixtures'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Other private brand'},randomUUID());
 reviewer=await signup();await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'editor','selected')",[org.id,reviewer.id]);await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'reviewer')",[org.id,brand.id,reviewer.id]);
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 for(const [field,value] of [['brand_name','Render fixtures'],['offering','Creative workflow tools'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;current=await fixture();project=current.project_id;
});
after(async()=>{store.close();await app?.close();await Promise.all([admin.end(),workerPool.end()]);});

test('real authenticated export requests are scoped, idempotent, and create one durable job',async()=>{
 const endpoint=path(`creative-versions/${current.id}/exports`),body={source_sha256:current.sha256},key=randomUUID();
 assert.equal((await api(endpoint,{user:null})).status,401);assert.equal((await api(endpoint,{user:bob})).status,404);assert.equal((await api(path(`creative-versions/${current.id}/exports`,sibling))).status,404);
 assert.equal((await api(endpoint,{user:viewer,method:'POST',body,key})).status,403);
 const results=await Promise.all([api(endpoint,{method:'POST',body,key}),api(endpoint,{method:'POST',body,key})]);results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));assert.equal(results[0].body.id,results[1].body.id);
 assert.equal((await api(endpoint,{method:'POST',body:{source_sha256:'a'.repeat(64)},key})).status,409);
 const list=await api(endpoint);assert.equal(list.body.jobs.length,1);assert.equal(list.body.exports.length,0);assert.equal(list.body.configured,true);
 const j=results[0].body,native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='export-'+randomUUID();
 const temporal=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{exportCreative:async s=>{const ctx=Context.current(),timer=setInterval(()=>ctx.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(timer);}},failExport:s=>handler.fail(s)}});
 try{const client=new Client({connection,namespace:config.jobs.namespace});assert.equal(await temporal.runUntil(()=>client.workflow.execute('exportCreativeWorkflow',{workflowId:'export-'+j.id,taskQueue,args:[scope(j)]})),'succeeded');}finally{await native.close();await connection.close();}
 canonical=(await exports.list(alice.id,brand.id,current.id)).exports[0];assert.equal(canonical.source_sha256,current.sha256);assert.equal(canonical.renderer_image,renderer.image);assert.equal(canonical.manifest.fabric,'7.4.0');assert.ok(canonical.manifest.warnings.some(s=>s.includes('Liberation Sans')));
 const grant=await exports.download(alice.id,brand.id,canonical.id),pixels=Buffer.from(await (await fetch(grant.url)).arrayBuffer());assert.equal(digest(pixels),canonical.sha256);assert.notEqual(digest(pixels),digest(png));assert.equal((await sharp(pixels).metadata()).width,1024);
 const raw=await sharp(pixels).removeAlpha().raw().toBuffer();assert.deepEqual([...raw.subarray(0,3)],[238,231,219]);assert.ok(raw.some((v,i)=>v!==[238,231,219][i%3]));
 await mkdir('work/render',{recursive:true});await writeFile('work/render/canonical-fixture.png',pixels);
 assert.equal((await exports.list(alice.id,brand.id,current.id)).approvals.length,0);assert.equal(await handler.run(scope(j)),'finished');assert.equal((await queue()).export_id,canonical.id);
 assert.equal((await api(path(`creative-exports/${canonical.id}/download`),{user:bob})).status,404);assert.equal((await api(path(`creative-exports/${canonical.id}/download`,sibling))).status,404);
 await jobs.transaction(scope(j),async db=>{assert.deepEqual((await db.query('SELECT id FROM app.creative_versions')).rows.map(v=>v.id),[current.id]);assert.equal((await db.query('SELECT * FROM app.creative_calls')).rowCount,0);});
 await assert.rejects(workerPool.query("UPDATE app.creative_exports SET sha256='bad'"),e=>e.code==='42501');await assert.rejects(workerPool.query('INSERT INTO app.creative_export_approvals DEFAULT VALUES'),e=>e.code==='42501');
});

test('fixed renderer produces identical saved pixels; untrusted text stays text and remote URLs/overflow are rejected',async()=>{
 const one=await renderer.render(current.design,png),two=await renderer.render(current.design,png);assert.equal(one.sha256,two.sha256);assert.equal(one.sha256,canonical.sha256);
 const d=structuredClone(current.design);d.layers[0].text='<script>fetch("https://attacker.invalid")</script>';const safe=await renderer.render(d,png);assert.ok(safe.bytes.length>png.length);assert.notEqual(safe.sha256,canonical.sha256);
 await assert.rejects(renderer.render({...d,layers:[{...d.layers[0],fontFamily:'https://attacker.invalid/font.ttf'}]},png),/DESIGN_INVALID/);
 await assert.rejects(renderer.render({...d,layers:[{...d.layers[0],y:1000,text:'Text outside the image'}]},png),/EXPORT_TEXT_OVERFLOW/);
 await assert.rejects(renderer.render(d,Buffer.from('<svg/>')));
 await assert.rejects(new StaticRenderer().render(d,png),/NOT_CONFIGURED/);
});

test('final pixel approval is explicit, current-version/owner bound and separate from prior creative approval',async()=>{
 const body={sha256:canonical.sha256,source_sha256:current.sha256,context_type:'canvas',context_id:current.id,context_revision:1,confirmed:true};
 await assert.rejects(exports.approve(alice.id,brand.id,canonical.id,body),/Send the current/);
 await canvas.review(editor.id,brand.id,current.id,{decision:'in_review',feedback:'Ready',revision:1});await canvas.review(alice.id,brand.id,current.id,{decision:'approved',feedback:'Concept approved',revision:2});body.context_revision=3;
 assert.equal((await exports.list(alice.id,brand.id,current.id)).approvals.length,0);
 assert.equal((await api(path(`creative-exports/${canonical.id}/approve`),{method:'POST',user:editor,body})).status,403);
 assert.equal((await api(path(`creative-exports/${canonical.id}/approve`),{method:'POST',body:{...body,confirmed:false}})).status,400);
 assert.equal((await api(path(`creative-exports/${canonical.id}/approve`),{method:'POST',body:{...body,sha256:'b'.repeat(64)}})).status,409);
 const a=await api(path(`creative-exports/${canonical.id}/approve`),{method:'POST',body});assert.equal(a.status,201,JSON.stringify(a.body));assert.equal((await exports.approve(alice.id,brand.id,canonical.id,body)).id,a.body.id);
 const p=await plans.create(alice.id,brand.id,{title:'TEST FIXTURE publication plan',objective:'Awareness',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'linkedin',format:'static',planned_at:'2026-11-01T10:00:00Z',brief:'TEST FIXTURE',creative_version_id:current.id}]},randomUUID());
 let s=(await plans.list(alice.id,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:p.id})).slots[0];const review=d=>({revision:s.revision,creative_version_id:s.creative_version_id,creative_sha256:s.creative_sha256,decision:d});s=await plans.review(alice.id,brand.id,s.id,review('pending_review'));s=await plans.review(alice.id,brand.id,s.id,review('approved'));
 await assert.rejects(plans.scope(alice.id,brand.id,false,db=>exports.publicationProof(db,s.id)),/final saved image/);
 const slotApproval={...body,context_type:'slot',context_id:s.id,context_revision:s.revision};await exports.approve(alice.id,brand.id,canonical.id,slotApproval);
 assert.equal((await plans.scope(alice.id,brand.id,false,db=>exports.publicationProof(db,s.id))).sha256,canonical.sha256);
 await plans.edit(alice.id,brand.id,s.id,{revision:s.revision,brief:'Changed after approval',reset_approval:true});await assert.rejects(plans.scope(alice.id,brand.id,false,db=>exports.publicationProof(db,s.id)),/final saved image/);
 const saved=await canvas.save(alice.id,brand.id,project,{parent_id:current.id,design:current.design,caption:'New version'});await assert.rejects(exports.approve(alice.id,brand.id,canonical.id,body),/current saved export/);assert.equal((await exports.list(alice.id,brand.id,saved.id)).exports.length,0);assert.equal((await exports.list(alice.id,brand.id,current.id)).approvals.length,2);
});

test('one final-image approval atomically approves a pending review; failure rolls back both records and replay is stable',async()=>{
 const v=await fixture(),e=await render(v);
 await canvas.review(editor.id,brand.id,v.id,{decision:'in_review',feedback:'Ready',revision:1});
 const body={sha256:e.sha256,source_sha256:v.sha256,context_type:'canvas',context_id:v.id,context_revision:2,confirmed:true};
 await admin.query("CREATE FUNCTION app.test_approval_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST approval commit failure'; END$$");
 await admin.query('CREATE TRIGGER test_approval_failure BEFORE INSERT ON app.creative_export_approvals FOR EACH ROW EXECUTE FUNCTION app.test_approval_failure()');
 try{await assert.rejects(exports.approve(reviewer.id,brand.id,e.id,body),/TEST approval commit failure/);}finally{await admin.query('DROP TRIGGER test_approval_failure ON app.creative_export_approvals');await admin.query('DROP FUNCTION app.test_approval_failure()');}
 assert.deepEqual((await admin.query('SELECT status,review_revision FROM app.creative_versions WHERE id=$1',[v.id])).rows[0],{status:'in_review',review_revision:2});
 assert.equal((await exports.list(alice.id,brand.id,v.id)).approvals.length,0);
 const approved=await exports.approve(reviewer.id,brand.id,e.id,body);assert.equal((await exports.approve(reviewer.id,brand.id,e.id,body)).id,approved.id);
 assert.deepEqual((await admin.query('SELECT status,review_revision FROM app.creative_versions WHERE id=$1',[v.id])).rows[0],{status:'approved',review_revision:3});
 const p=await plans.create(alice.id,brand.id,{title:'TEST FIXTURE atomic review',objective:'Awareness',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'linkedin',format:'static',planned_at:'2026-11-01T10:00:00Z',brief:'TEST FIXTURE',creative_version_id:v.id}]},randomUUID());
 let s=(await plans.list(alice.id,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:p.id})).slots[0];
 s=await plans.review(alice.id,brand.id,s.id,{revision:s.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 const sb={...body,context_type:'slot',context_id:s.id,context_revision:s.revision};
 const sa=await exports.approve(reviewer.id,brand.id,e.id,sb);assert.equal((await exports.approve(reviewer.id,brand.id,e.id,sb)).id,sa.id);
 assert.equal((await plans.scope(alice.id,brand.id,false,db=>exports.publicationProof(db,s.id))).sha256,e.sha256);
 assert.equal((await admin.query('SELECT revision FROM app.content_slots WHERE id=$1',[s.id])).rows[0].revision,s.revision+1);
});

test('cancel/access loss and renderer mismatch prevent export promotion; historical export never overwrites a newer version',async()=>{
 let v=await fixture(),j=await queue(v);await exports.cancel(alice.id,brand.id,j.id);assert.equal(await handler.run(scope(j)),'finished');assert.equal((await exports.list(alice.id,brand.id,v.id)).exports.length,0);
 j=await queue(v);await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[org.id,alice.id]);try{assert.equal(await handler.run(scope(j)),'finished');}finally{await admin.query('UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2',[org.id,alice.id]);}
 j=await queue(v);assert.equal(await new ExportJobs(jobs,new StaticRenderer('sha256:'+'a'.repeat(64))).run(scope(j)),'rejected');assert.equal((await exports.list(alice.id,brand.id,v.id)).exports.length,0);
 j=await queue(v);let saved;const racing=new ExportJobs(jobs,{image:renderer.image,configured:true,render:async(d,b)=>{const output=await renderer.render(d,b);saved=await canvas.save(alice.id,brand.id,v.project_id,{parent_id:v.id,design:v.design,caption:'Owner changed while rendering'});return output;}});
 assert.equal(await racing.run(scope(j)),'succeeded');const e=(await exports.list(alice.id,brand.id,v.id)).exports[0];assert.ok(e);assert.equal((await canvas.project(alice.id,brand.id,v.project_id)).project.latest_version_id,saved.id);assert.equal((await exports.list(alice.id,brand.id,saved.id)).exports.length,0);
});

test('lost export database promotion can recover from deterministic private bytes without duplicate records',async()=>{
 const v=await fixture(),j=await queue(v);
 await admin.query("CREATE FUNCTION app.test_export_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST export commit failure'; END$$");await admin.query('CREATE TRIGGER test_export_failure BEFORE INSERT ON app.creative_exports FOR EACH ROW EXECUTE FUNCTION app.test_export_failure()');
 try{await assert.rejects(handler.run(scope(j)),/TEST export commit failure/);}finally{await admin.query('DROP TRIGGER test_export_failure ON app.creative_exports');await admin.query('DROP FUNCTION app.test_export_failure()');}
 assert.equal((await exports.list(alice.id,brand.id,v.id)).exports.length,0);assert.equal(await handler.run(scope(j)),'succeeded');assert.equal((await exports.list(alice.id,brand.id,v.id)).exports.length,1);assert.equal(await handler.run(scope(j)),'finished');
});

test('rendered media integrity and actual text overflow fail closed with persisted error status',async()=>{
 const v=await fixture(),j=await queue(v);await admin.query("UPDATE app.creative_media SET sha256=$2 WHERE id=$1",[v.media_id,'c'.repeat(64)]);assert.equal(await handler.run(scope(j)),'rejected');assert.equal((await exports.list(alice.id,brand.id,v.id)).jobs[0].error_code,'EXPORT_MEDIA_INTEGRITY_FAILED');
 const clipped=await fixture({layers:[{id:'headline',type:'text',text:'This cannot fit',x:0,y:1000,width:900,fontSize:56,fontFamily:'Arial',fill:'#112233',align:'left'}]});const queued=await queue(clipped);assert.equal(await handler.run(scope(queued)),'rejected');const state=await exports.list(alice.id,brand.id,clipped.id);assert.equal(state.jobs[0].error_code,'EXPORT_TEXT_OVERFLOW');assert.equal(state.exports.length,0);
});

test('concurrent exports reserve bounded private storage before accepting work',async()=>{
 const versions=[];for(let i=0;i<26;i++)versions.push(await fixture());
 const results=await Promise.allSettled(versions.map(v=>queue(v))),accepted=results.filter(r=>r.status==='fulfilled'),denied=results.filter(r=>r.status==='rejected');
 assert.equal(accepted.length,25);assert.equal(denied.length,1);assert.match(denied[0].reason.message,/storage limit/);
 const reserved=(await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.export' AND status IN ('queued','running','retrying')",[brand.id])).rows[0].n;
 assert.equal(reserved,25);
 for(const r of accepted){await exports.cancel(alice.id,brand.id,r.value.id);assert.equal(await handler.run(scope(r.value)),'finished');}
});

test('approved export to original video skills, durable provider stage, actual media rendering and private version (MOCK providers)',async()=>{
 const [{VideoReferences},{VideoCanvas},{VideoJobs},{VideoProviderJobs},{VideoRenderer},{CreativeJobs},{CreativeProvider},{SkillRuntime},{VideoDownload},{prepareVideoImage},{prepareSkillImage},{execFileSync},{default:OpenAI}]=await Promise.all([
  import('../../dist/video-references.js'),import('../../dist/video-canvas.js'),import('../../dist/video-jobs.js'),import('../../dist/video-provider-jobs.js'),import('../../dist/video-renderer.js'),import('../../dist/creative-jobs.js'),import('../../dist/creative-provider.js'),import('../../dist/skill-runtime.js'),import('../../dist/video-download.js'),import('../../scripts/video-runtime-image.mjs'),import('../../scripts/skill-test-image.mjs'),import('node:child_process'),import('openai')]);
 const image=prepareVideoImage(),skillImage=prepareSkillImage(),encryptionKey='ab'.repeat(32);
 const clip=Buffer.from(execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--entrypoint','python',image,'-c',"import sys,base64; sys.path.insert(0,'/runtime'); import runtime as r; r.command('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=320x180:duration=3:rate=24','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','/tmp/test.mp4']); print(base64.b64encode(open('/tmp/test.mp4','rb').read()).decode())"],{encoding:'utf8',timeout:30000}).trim(),'base64');
 const v=await fixture(),e=await render(v);await canvas.review(editor.id,brand.id,v.id,{decision:'in_review',feedback:'For video',revision:1});
 const approval=await exports.approve(alice.id,brand.id,e.id,{sha256:e.sha256,source_sha256:v.sha256,context_type:'canvas',context_id:v.id,context_revision:2,confirmed:true});
 const refs=new VideoReferences(canvas,jobs,encryptionKey,renderer.image,'test'),service=new VideoCanvas(canvas,refs,true);
 const thread=(await admin.query('SELECT thread_id FROM app.creative_projects WHERE id=$1',[v.project_id])).rows[0].thread_id;
 const linkedPlan=await plans.create(alice.id,brand.id,{title:'Linked video plan',objective:'Generate into this plan',starts_on:'2027-01-01',timezone:'UTC',slots:[{channel:'instagram',format:'video',brief:'TEST planned video',planned_at:'2027-01-06T08:00:00Z'}]},randomUUID());
 const linkedRange={start:'2027-01-01T00:00:00Z',end:'2027-02-01T00:00:00Z',plan_id:linkedPlan.id},linkedSlot=(await plans.list(alice.id,brand.id,linkedRange)).slots[0];
 const body={prompt:'Animate our approved creative',slot_id:linkedSlot.id,slot_revision:linkedSlot.revision,channel:'instagram',duration_seconds:3,reference:{export_id:e.id,approval_id:approval.id,source_sha256:v.sha256,export_sha256:e.sha256,confirmed:true}};
 await assert.rejects(service.submit(viewer.id,brand.id,thread,body,randomUUID()));await assert.rejects(service.submit(bob.id,brand.id,thread,body,randomUUID()));
 await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',10000000,0.01,0.02,100000,'LOCAL TEST',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET enabled=true,expires_at=now()+interval '1 hour',budget_micros=10000000",[org.id,brand.id]);
 const requestKey=randomUUID(),j=await service.submit(alice.id,brand.id,thread,body,requestKey);
 assert.equal((await service.submit(alice.id,brand.id,thread,body,requestKey)).id,j.id);
 await assert.rejects(service.submit(alice.id,brand.id,thread,{...body,prompt:'Different'},requestKey),/different video/);

 await admin.query("INSERT INTO app.video_grants(organization_id,brand_id,models,expires_at,budget_micros,max_create_micros,max_edit_micros,operator_reference,enabled) VALUES($1,$2,ARRAY['kling-video/v3.0/std/image-to-video'],now()+interval '1 hour',10000000,100000,100000,'LOCAL TEST',true)",[org.id,brand.id]);
 let plansCalled=0,submits=0,statuses=0,downloads=0,leasedURL;
 const text=new CreativeProvider(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(url,init)=>{
  plansCalled++;assert.equal(new URL(url).pathname,'/v1/responses');const wire=JSON.parse(init.body),message=wire.input.find(m=>m.role==='user'&&m.content.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n')),input=JSON.parse(message.content.slice(message.content.indexOf('\n')+1));
  assert.equal(input.task,'video');assert.equal(input.reference.sha256,e.sha256);assert.ok(!JSON.stringify(wire).includes('X-Amz'));assert.ok(!JSON.stringify(wire).includes(config.storage.secretAccessKey));
  const brief={title:'TEST video',caption:'TEST FIXTURE video caption',video_prompt:'TEST FIXTURE subtle motion',fact_ids:[input.brand.facts[0].id],warnings:[],beats:[{start_ms:0,end_ms:3000,action:'Subtle motion',camera:'Static'}],overlays:[{text:'Discover more',start_ms:0,end_ms:2000,position:'bottom',foreground:'#ffffff',background:'#111111'}]};
  return Response.json({object:'response',id:'resp_mock_video',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(brief),annotations:[]}]}]});
 }}));
 // Provider boundary is explicitly MOCK. Real Higgsfield wire behavior is
 // independently covered by provider contracts; this loopback URL is not staging.
 let remoteId=randomUUID();const mockProvider={prepare:intent=>({model:intent.model,idempotencyKey:intent.idempotencyKey,sha256:hash(canonicalJSON(intent))}),submit:async(intent,sha)=>{
  submits++;remoteId=randomUUID();assert.ok(intent.prompt.startsWith('TEST FIXTURE user edited motion\nScript:\n'));assert.ok(intent.prompt.includes('Subtle motion'));assert.equal(sha,hash(canonicalJSON(intent)));leasedURL=intent.referenceURL;
  const downloaded=Buffer.from(await(await fetch(leasedURL)).arrayBuffer());assert.equal(digest(downloaded),e.sha256);
  return {requestId:remoteId};},status:async()=>{statuses++;return {requestId:remoteId,state:'completed',videoURL:'https://video.example.org/fixture.mp4',errorCode:null};},cancel:async()=>{}};
 const provider=new VideoProviderJobs(jobs,mockProvider,encryptionKey),creative=new CreativeJobs(jobs,new SkillRuntime(skillImage),text);
 const downloader=new VideoDownload(['https://video.example.org'],{fetch:async()=>{downloads++;return {status:200,headers:{'content-type':'video/mp4','content-length':String(clip.length)},bytes:clip};}});
 const pipeline=new VideoJobs(jobs,refs,creative,provider,downloader,new VideoRenderer(image));
 const firstStep=await pipeline.step(scope(j));
 assert.equal(firstStep,'awaiting_approval',JSON.stringify((await admin.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[j.id])).rows[0]));assert.equal(submits,0);assert.equal(await pipeline.step(scope(j)),'awaiting_approval');assert.equal(plansCalled,1);
 const draft=await service.draft(alice.id,brand.id,j.id),edited={...draft.brief,video_prompt:'TEST FIXTURE user edited motion'};
 await assert.rejects(service.saveDraft(editor.id,brand.id,j.id,{brief:edited,revision:1,approve:true}));
 await service.saveDraft(editor.id,brand.id,j.id,{brief:edited,revision:1,approve:false});
 assert.equal(await pipeline.step(scope(j)),'awaiting_approval');assert.equal(submits,0);
 await assert.rejects(service.saveDraft(alice.id,brand.id,j.id,{brief:edited,revision:1,approve:true}));
 await service.saveDraft(alice.id,brand.id,j.id,{brief:edited,revision:2,approve:true});
 assert.equal(await pipeline.step(scope(j)),'accepted');
 await assert.rejects(service.saveDraft(alice.id,brand.id,j.id,{brief:edited,revision:3,approve:false}));
 assert.equal(await pipeline.step(scope(j)),'completed');assert.equal(await pipeline.step(scope(j)),'succeeded');
 assert.equal(plansCalled,1);assert.equal(submits,1);assert.equal(statuses,1);assert.equal(downloads,1);
 const saved=(await service.list(alice.id,brand.id)).projects[0],version=await service.version(alice.id,brand.id,saved.latest_version_id);
 const attached=(await plans.list(alice.id,brand.id,linkedRange)).slots[0];assert.equal(attached.video_version_id,version.id);assert.equal(attached.state,'draft_ready');assert.equal(attached.revision,linkedSlot.revision+1);
 assert.equal(version.status,'draft');assert.equal(version.caption,'TEST FIXTURE video caption');assert.equal(version.duration_ms,3000);assert.equal(version.manifest.reference.sha256,e.sha256);assert.equal(version.manifest.plan.skills.length,4);
 const row=(await admin.query('SELECT * FROM app.video_versions WHERE id=$1',[version.id])).rows[0];assert.equal(digest(await store.read(row.object_key,64*1024*1024)),row.sha256);assert.equal(digest(await store.read(row.poster_key)),row.poster_sha256);
 assert.equal((await fetch(leasedURL)).status,404);assert.equal(await pipeline.step(scope(j)),'succeeded');assert.equal(submits,1);assert.equal(downloads,1);
 const endpoint=path(`video-versions/${version.id}`);
 assert.equal((await api(endpoint,{user:null})).status,401);assert.equal((await api(endpoint,{user:bob})).status,404);assert.equal((await api(endpoint)).body.sha256,version.sha256);
 for(const suffix of ['download','poster']){const granted=await api(endpoint+'/'+suffix);assert.equal(granted.status,200);assert.equal(digest(Buffer.from(await(await fetch(granted.body.url)).arrayBuffer())),granted.body.sha256);assert.equal((await api(endpoint+'/'+suffix,{user:bob})).status,404);}
 const review={decision:'in_review',feedback:'Review the final clip',revision:1,sha256:version.sha256};
 assert.equal((await api(endpoint+'/review',{user:viewer,method:'POST',body:review})).status,403);
 assert.equal((await api(endpoint+'/review',{user:editor,method:'POST',body:review})).status,201);
 const approve={decision:'approved',feedback:'Approved exact clip',revision:2,sha256:version.sha256,confirmed:true};
 assert.equal((await api(endpoint+'/review',{user:editor,method:'POST',body:approve})).status,403);
 assert.equal((await api(endpoint+'/review',{method:'POST',body:{...approve,sha256:'0'.repeat(64)}})).status,409);
 assert.equal((await api(endpoint+'/review',{user:reviewer,method:'POST',body:approve})).status,201);
 assert.equal((await api(endpoint+'/review',{user:reviewer,method:'POST',body:approve})).status,409);
 assert.equal((await api(endpoint)).body.status,'approved');
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.video_reviews WHERE version_id=$1',[version.id])).rows[0].n,2);
 await assert.rejects(service.version(bob.id,brand.id,version.id));assert.equal((await service.list(alice.id,sibling.id)).projects.length,0);
 const calendarBody={title:'Video calendar test',objective:'Review saved video',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:body.channel,format:'video',planned_at:'2026-11-05T08:00:00Z',brief:'TEST saved video',video_version_id:version.id}]};
 const appendBody={video_version_id:version.id,channel:'instagram',planned_at:'2027-01-07T08:00:00Z',brief:'Reuse saved video'},appendKey=randomUUID();
 const added=await plans.addVideo(alice.id,brand.id,linkedPlan.id,appendBody,appendKey);assert.equal((await plans.addVideo(alice.id,brand.id,linkedPlan.id,appendBody,appendKey)).id,added.id);
 await assert.rejects(plans.addVideo(alice.id,brand.id,linkedPlan.id,{...appendBody,planned_at:'2027-02-02T08:00:00Z'},randomUUID()),/local calendar days/);
 await assert.rejects(plans.addVideo(alice.id,sibling.id,linkedPlan.id,appendBody,randomUUID()),/Content plan not found/);
 await assert.rejects(plans.addVideo(viewer.id,brand.id,linkedPlan.id,appendBody,randomUUID()));
 assert.ok((await plans.catalog(alice.id,brand.id)).plans.some(p=>p.id===linkedPlan.id));
 const calendarKey=randomUUID(),calendar=await plans.create(alice.id,brand.id,calendarBody,calendarKey);
 assert.equal((await plans.create(alice.id,brand.id,calendarBody,calendarKey)).id,calendar.id);
 await assert.rejects(plans.create(alice.id,sibling.id,calendarBody,randomUUID()),/Video version not found/);
 await assert.rejects(plans.create(viewer.id,brand.id,calendarBody,randomUUID()));
 assert.throws(()=>plans.create(alice.id,brand.id,{...calendarBody,slots:[{...calendarBody.slots[0],format:'static'}]},randomUUID()),/Match the saved media/);
 const calendarRange={start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:calendar.id};
 let videoSlot=(await plans.list(alice.id,brand.id,calendarRange)).slots[0];
 assert.equal(videoSlot.video_version_id,version.id);assert.equal(videoSlot.creative_version_id,null);assert.equal(videoSlot.caption,version.caption);
 const decide=(slot,decision)=>({revision:slot.revision,video_version_id:slot.video_version_id,video_sha256:slot.video_sha256,decision});
 await assert.rejects(plans.review(alice.id,brand.id,videoSlot.id,{...decide(videoSlot,'pending_review'),video_sha256:'0'.repeat(64)}),/current post/);
 videoSlot=await plans.review(editor.id,brand.id,videoSlot.id,decide(videoSlot,'pending_review'));
 assert.equal((await plans.list(alice.id,brand.id,calendarRange,true)).slots[0].id,videoSlot.id);
 await assert.rejects(plans.review(editor.id,brand.id,videoSlot.id,decide(videoSlot,'approved')),/owner or admin/);
 videoSlot=await plans.review(alice.id,brand.id,videoSlot.id,decide(videoSlot,'approved'));
 assert.equal(videoSlot.state,'approved');
 const detail=await api(path(`content-slots/${videoSlot.id}`));assert.equal(detail.status,200);assert.equal(detail.body.slot.video_version_id,version.id);
 assert.equal((await api(path(`content-slots/${videoSlot.id}/generate-creative`),{method:'POST',key:randomUUID(),body:{revision:videoSlot.revision,feedback:'Change it',reset_approval:true}})).status,400);
 const revisionKey=randomUUID(),revisionJob=await service.regenerate(alice.id,brand.id,version.id,{feedback:'Change the camera motion'},revisionKey);
 assert.equal((await service.regenerate(alice.id,brand.id,version.id,{feedback:'Change the camera motion'},revisionKey)).id,revisionJob.id);
 assert.equal(await pipeline.step(scope(revisionJob)),'awaiting_approval');assert.equal(submits,1);
 const revised=await service.draft(alice.id,brand.id,revisionJob.id);await service.saveDraft(alice.id,brand.id,revisionJob.id,{brief:{...revised.brief,video_prompt:'TEST FIXTURE user edited motion'},revision:1,approve:true});
 assert.equal(await pipeline.step(scope(revisionJob)),'accepted');assert.equal(await pipeline.step(scope(revisionJob)),'completed');assert.equal(await pipeline.step(scope(revisionJob)),'succeeded');
 const history=(await admin.query('SELECT id,status FROM app.video_versions WHERE project_id=$1 ORDER BY created_at',[version.project_id])).rows;
 assert.equal(history.length,2);assert.equal(history[0].status,'approved');assert.equal(history[1].status,'draft');assert.notEqual(history[1].id,version.id);assert.equal(submits,2);
 const latest=(await service.list(alice.id,brand.id)).projects.find(p=>p.id===version.project_id);assert.equal(latest.latest_version_id,history[1].id);
 assert.equal((await plans.list(alice.id,brand.id,calendarRange)).slots[0].has_newer_version,true);
 await assert.rejects(plans.edit(alice.id,brand.id,videoSlot.id,{revision:videoSlot.revision,video_version_id:history[1].id}),/new review/);
 videoSlot=await plans.edit(alice.id,brand.id,videoSlot.id,{revision:videoSlot.revision,video_version_id:history[1].id,reset_approval:true});
 assert.equal(videoSlot.state,'draft_ready');assert.equal(videoSlot.approved_by,null);assert.equal(videoSlot.video_version_id,history[1].id);
 const events=(await plans.history(alice.id,brand.id,videoSlot.id)).events;assert.equal(events.at(-1).video_version_id,history[1].id);assert.equal(events[0].video_version_id,version.id);
 const canceled=await service.regenerate(alice.id,brand.id,history[1].id,{feedback:'Cancel this draft before any charge'},randomUUID());await service.cancel(alice.id,brand.id,canceled.id);assert.equal(await pipeline.step(scope(canceled)),'canceled');assert.equal(submits,2);
 const currentSlot=(await plans.list(alice.id,brand.id,linkedRange)).slots.find(s=>s.id===linkedSlot.id);
 const changedJob=await service.submit(alice.id,brand.id,thread,{...body,slot_revision:currentSlot.revision,parent_version_id:history[1].id},randomUUID());
 await plans.edit(alice.id,brand.id,currentSlot.id,{revision:currentSlot.revision,brief:'TEST calendar direction changed',video_version_id:history[1].id});
 assert.equal(await pipeline.step(scope(changedJob)),'canceled');assert.equal(submits,2);
 assert.equal((await admin.query('SELECT error_code FROM app.jobs WHERE id=$1',[changedJob.id])).rows[0].error_code,'VIDEO_CALENDAR_CHANGED');
 const beforePaid=(await plans.list(alice.id,brand.id,linkedRange)).slots.find(s=>s.id===linkedSlot.id);
 const paidJob=await service.submit(alice.id,brand.id,thread,{...body,slot_revision:beforePaid.revision,parent_version_id:history[1].id},randomUUID());
 assert.equal(await pipeline.step(scope(paidJob)),'awaiting_approval');const paidDraft=await service.draft(alice.id,brand.id,paidJob.id);
 await service.saveDraft(alice.id,brand.id,paidJob.id,{brief:{...paidDraft.brief,video_prompt:'TEST FIXTURE user edited motion'},revision:1,approve:true});
 assert.equal(await pipeline.step(scope(paidJob)),'accepted');
 await plans.edit(alice.id,brand.id,beforePaid.id,{revision:beforePaid.revision,brief:'Keep the owner edit made after submission'});
 assert.equal(await pipeline.step(scope(paidJob)),'completed');assert.equal(await pipeline.step(scope(paidJob)),'succeeded');
 const preserved=(await plans.list(alice.id,brand.id,linkedRange)).slots.find(s=>s.id===linkedSlot.id);
 assert.equal(preserved.brief,'Keep the owner edit made after submission');assert.equal(preserved.video_version_id,beforePaid.video_version_id);assert.equal(preserved.revision,beforePaid.revision+1);
 assert.ok((await admin.query('SELECT output_version_id FROM app.video_requests WHERE job_id=$1',[paidJob.id])).rows[0].output_version_id);assert.equal(submits,3);



 // Extend the same real generation/render/approval journey to a consented MOCK LinkedIn publication.
 const publishRequest=await service.submit(alice.id,brand.id,thread,{...body,slot_id:undefined,slot_revision:undefined,channel:'linkedin'},randomUUID());
 assert.equal(await pipeline.step(scope(publishRequest)),'awaiting_approval');const publishDraft=await service.draft(alice.id,brand.id,publishRequest.id);
 await service.saveDraft(alice.id,brand.id,publishRequest.id,{brief:{...publishDraft.brief,video_prompt:'TEST FIXTURE user edited motion'},revision:1,approve:true});
 assert.equal(await pipeline.step(scope(publishRequest)),'accepted');assert.equal(await pipeline.step(scope(publishRequest)),'completed');assert.equal(await pipeline.step(scope(publishRequest)),'succeeded');
 const publishVersion=(await admin.query('SELECT * FROM app.video_versions WHERE job_id=$1',[publishRequest.id])).rows[0];
 await service.review(alice.id,brand.id,publishVersion.id,{decision:'in_review',feedback:'Review for publishing',revision:1,sha256:publishVersion.sha256});
 await service.review(alice.id,brand.id,publishVersion.id,{decision:'approved',feedback:'Approve exact video',revision:2,sha256:publishVersion.sha256,confirmed:true});
 const {proveVideoPublication}=await import('../fixtures/prove-video-publication.mjs');
 await proveVideoPublication({admin,jobs,store,businesses,exports,plans,org,brand,alice,bob,editor,video:publishVersion,image,staticImage:renderer.image});
 const {GoogleGenAI}=await import('@google/genai'),{GeminiPlanner}=await import('../../dist/gemini-planner.js');let geminiCalls=0;
 const gemini=new GeminiPlanner(undefined,new GoogleGenAI({apiKey:'LOCAL GEMINI MOCK',httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1},fetch:async(url,init)=>{
  geminiCalls++;const wire=JSON.parse(init.body),raw=wire.contents.flatMap(m=>m.parts).find(p=>p.text?.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n')).text,input=JSON.parse(raw.slice(raw.indexOf('\n')+1));
  const brief={title:'Gemini test video',caption:'TEST FIXTURE video caption',video_prompt:'TEST FIXTURE subtle motion',fact_ids:[input.brand.facts[0].id],warnings:[],beats:[{start_ms:0,end_ms:3000,action:'Subtle motion',camera:'Static'}],overlays:[]};
  return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(brief)}]},finishReason:'STOP'}]});
 }}}));
 await admin.query("INSERT INTO app.gemini_creative_grants(organization_id,brand_id,enabled,text_model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'gemini-fixture',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL TEST ONLY')",[org.id,brand.id]);
 const {slot_id:ignoredSlot,slot_revision:ignoredRevision,...unlinked}=body;
 const gj=await service.submit(alice.id,brand.id,thread,{...unlinked,text_provider:'gemini'},randomUUID()),beforeText=plansCalled,beforeGeminiPaid=submits;
 const gp=new VideoJobs(jobs,refs,new CreativeJobs(jobs,new SkillRuntime(skillImage),text,gemini),provider,downloader,new VideoRenderer(image));
 assert.equal(await gp.step(scope(gj)),'awaiting_approval');assert.equal(geminiCalls,1);assert.equal(plansCalled,beforeText);assert.equal(submits,beforeGeminiPaid);
 assert.equal(await gp.step(scope(gj)),'awaiting_approval');assert.equal(geminiCalls,1);
 const gd=await service.draft(alice.id,brand.id,gj.id);
 await service.saveDraft(alice.id,brand.id,gj.id,{brief:{...gd.brief,video_prompt:'TEST FIXTURE user edited motion'},revision:1,approve:true});
 assert.equal(await gp.step(scope(gj)),'accepted');assert.equal(submits,beforeGeminiPaid+1);
 assert.equal(await gp.step(scope(gj)),'completed');assert.equal(await gp.step(scope(gj)),'succeeded');
 const gv=(await admin.query('SELECT manifest FROM app.video_versions WHERE job_id=$1',[gj.id])).rows[0];assert.equal(gv.manifest.text_provider,'gemini');assert.equal(gv.manifest.text_model,'gemini-fixture');


});

test('carousel is one immutable ordered composition; scoped reviewers approve exact canonical slides and edits invalidate it',async()=>{
 const {Carousels}=await import('../../dist/carousels.js'),service=new Carousels(canvas,renderer.image);
 const a=await fixture(),b=await fixture(),ea=await render(a),eb=await render(b);
 const input={project_id:null,parent_id:null,title:'TEST two-slide carousel',caption:'One shared caption',channel:'linkedin',pages:[{creative_version_id:a.id,export_id:ea.id,alt_text:'First slide description'},{creative_version_id:b.id,export_id:eb.id,alt_text:'Second slide description'}]},key=randomUUID();
 for(const user of [viewer,bob,reviewer])await assert.rejects(service.save(user.id,brand.id,input,randomUUID()));
 await assert.rejects(service.save(alice.id,sibling.id,input,randomUUID()));
 for(const patch of [{pages:[input.pages[0]]},{pages:[input.pages[0],input.pages[0]]},{pages:[{...input.pages[0],export_id:eb.id},input.pages[1]]},{pages:[{...input.pages[0],alt_text:''},input.pages[1]]}])await assert.rejects(async()=>service.save(alice.id,brand.id,{...input,...patch},randomUUID()));
 const saved=await api(path('carousels'),{method:'POST',body:input,key});assert.equal(saved.status,201);const result=saved.body;
 assert.deepEqual(await service.save(alice.id,brand.id,input,key),result);await assert.rejects(service.save(alice.id,brand.id,{...input,caption:'Changed shared caption'},key),/another carousel/);
 assert.equal((await service.list(alice.id,sibling.id)).carousels.length,0);await assert.rejects(service.read(bob.id,brand.id,result.project_id));
 let data=await service.read(viewer.id,brand.id,result.project_id),v=data.versions[0];assert.equal(v.current,true);assert.deepEqual(v.pages.map(p=>p.creative_version_id),[a.id,b.id]);assert.equal(v.status,'draft');
 const decision=(revision,decision)=>({revision,decision,sha256:v.sha256,confirmed:true,feedback:decision==='changes_requested'?'Please improve the second slide.':''});
 await assert.rejects(service.review(alice.id,brand.id,v.id,decision(1,'approved')),/Submit/);
 await service.review(editor.id,brand.id,v.id,decision(1,'in_review'));await assert.rejects(service.review(editor.id,brand.id,v.id,decision(2,'approved')));
 await assert.rejects(service.review(reviewer.id,brand.id,v.id,decision(1,'approved')),/Refresh/);
 await service.review(reviewer.id,brand.id,v.id,decision(2,'approved'));
 data=await service.read(viewer.id,brand.id,result.project_id);assert.equal(data.versions[0].status,'approved');assert.equal(data.reviews.length,2);
 await assert.rejects(app.database.transaction(alice.id,org.id,true,db=>db.query("UPDATE app.carousel_versions SET caption='forged' WHERE id=$1",[v.id]),brand.id),e=>e.code==='42501');
 await assert.rejects(app.database.transaction(alice.id,org.id,true,db=>db.query('DELETE FROM app.carousel_pages WHERE carousel_version_id=$1',[v.id]),brand.id),e=>e.code==='42501');
 const edited=await service.save(editor.id,brand.id,{...input,project_id:result.project_id,parent_id:v.id,pages:[input.pages[1],input.pages[0]]},randomUUID());
 const updated=await service.read(alice.id,brand.id,result.project_id);const next=updated.versions.find(r=>r.id===edited.id);assert.equal(next.status,'draft');assert.notEqual(next.sha256,v.sha256);assert.equal(updated.versions.find(r=>r.id===v.id).current,false);assert.deepEqual(next.pages.map(p=>p.creative_version_id),[b.id,a.id]);
 await assert.rejects(service.save(alice.id,brand.id,{...input,project_id:result.project_id,parent_id:v.id},randomUUID()),/Refresh/);
 await canvas.save(alice.id,brand.id,a.project_id,{parent_id:a.id,design:a.design,caption:'A newer slide caption'});
 assert.equal((await service.read(alice.id,brand.id,result.project_id)).versions.find(r=>r.id===edited.id).current,false);
 await assert.rejects(service.review(alice.id,brand.id,edited.id,{revision:1,decision:'in_review',sha256:next.sha256,confirmed:true,feedback:''}),/Refresh/);
 assert.equal((await api(path('carousels')+'/'+result.project_id,{user:bob})).status,404);
});

test('carousel generation reserves ordered children once, isolates tenants and cancels without provider calls',async()=>{
 const {CarouselGeneration}=await import('../../dist/carousel-generation.js');
 const {CarouselJobs}=await import('../../dist/carousel-jobs.js');
 const {CreativeJobs}=await import('../../dist/creative-jobs.js');
 const {CreativeProvider}=await import('../../dist/creative-provider.js');
 await admin.query("UPDATE app.jobs SET created_at=now()-interval '2 days' WHERE brand_id=$1",[brand.id]);
 const service=new CarouselGeneration(canvas,renderer.image);
 const body={prompt:'TEST FIXTURE: coordinated three-slide story',slide_count:3,channel:'linkedin',size:'1024x1024',text_provider:'openai'},key=randomUUID();
 await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',10000000,0.01,0.02,100000,'LOCAL TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET enabled=true",[org.id,brand.id]);
 await assert.rejects(service.submit(viewer.id,brand.id,body,randomUUID()));
 await assert.rejects(service.submit(bob.id,brand.id,body,randomUUID()));
 const j=await service.submit(alice.id,brand.id,body,key);
 assert.equal((await service.submit(alice.id,brand.id,body,key)).id,j.id);
 await assert.rejects(service.submit(alice.id,brand.id,{...body,slide_count:4},key));
 const read=await service.read(alice.id,brand.id),children=read.slides.filter(s=>s.parent_job_id===j.id);
 assert.deepEqual(children.map(s=>s.position),[0,1,2]);
 assert.ok(children.every(s=>s.generation_status==='queued'&&s.export_status==='queued'));
 assert.equal((await service.read(alice.id,sibling.id)).runs.length,0);
 const ids=(await admin.query('SELECT generation_job_id,export_job_id FROM app.carousel_children WHERE parent_job_id=$1',[j.id])).rows.flatMap(r=>[r.generation_job_id,r.export_job_id]);
 assert.equal((await admin.query('SELECT * FROM app.job_dispatch WHERE job_id=ANY($1::uuid[])',[ids])).rowCount,0);
 assert.equal((await admin.query('SELECT * FROM app.job_dispatch WHERE job_id=$1',[j.id])).rowCount,1);
 await service.cancel(alice.id,brand.id,j.id);
 const creative=new CreativeJobs(jobs,{carouselPlan(){throw Error('Canceled requests must never call a model');}},new CreativeProvider());
 const coordinator=new CarouselJobs(jobs,creative,handler);
 assert.equal((await coordinator.plan(scope(j))).state,'canceled');
 assert.ok((await admin.query('SELECT status FROM app.jobs WHERE id=ANY($1::uuid[])',[ids])).rows.every(r=>r.status==='canceled'));
 assert.equal((await admin.query('SELECT * FROM app.creative_calls WHERE job_id=ANY($1::uuid[])',[[j.id,...ids]])).rowCount,0);
 await assert.rejects(workerPool.query('INSERT INTO app.carousel_reviews DEFAULT VALUES'),e=>e.code==='42501');
});

test('durable carousel uses one actual isolated plan, sequential MOCK images and real exports; replay does not charge twice',async()=>{
 const [{CarouselGeneration},{CarouselJobs},{CreativeJobs},{CreativeProvider},{SkillRuntime},{prepareSkillImage},{default:OpenAI},{carouselPlan}]=await Promise.all([
 import('../../dist/carousel-generation.js'),import('../../dist/carousel-jobs.js'),import('../../dist/creative-jobs.js'),import('../../dist/creative-provider.js'),import('../../dist/skill-runtime.js'),import('../../scripts/skill-test-image.mjs'),import('openai'),import('../fixtures/carousel-planning.mjs')]);
 let planning=0,images=0,uncertainAt=0;
 const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'LOCAL MOCK',maxRetries:0,fetch:async(url,init)=>{
  if(new URL(url).pathname==='/v1/responses'){
   planning++;const wire=JSON.parse(init.body),message=wire.input.find(m=>m.role==='user'&&m.content.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n')),input=JSON.parse(message.content.slice(message.content.indexOf('\n')+1)),plan=carouselPlan(input.slide_count);
   for(const slide of plan.slides){slide.fact_ids=[input.brand.facts[0].id];slide.headline=`Slide ${slide.position}`;slide.body='';slide.cta='';}
   return Response.json({object:'response',id:'mock-carousel',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(plan),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  }
  assert.equal(new URL(url).pathname,'/v1/images/generations');images++;if(images===uncertainAt)throw new TypeError('TEST FIXTURE connection lost after possible submission');
  return Response.json({created:1,data:[{b64_json:png.toString('base64')}],usage:{input_tokens:50,output_tokens:100,total_tokens:150}});
 }}));
 const creative=new CreativeJobs(jobs,new SkillRuntime(prepareSkillImage()),provider),coordinator=new CarouselJobs(jobs,creative,handler),service=new CarouselGeneration(canvas,renderer.image);
 const j=await service.submit(alice.id,brand.id,{prompt:'TEST FIXTURE: a connected two-slide story',slide_count:2,channel:'instagram',size:'1024x1024',text_provider:'openai'},randomUUID());
 const native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='carousel-'+randomUUID();
 const beat=fn=>async(...args)=>{const ctx=Context.current(),timer=setInterval(()=>ctx.heartbeat(),1000);try{return await fn(...args);}finally{clearInterval(timer);}};
 const temporal=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{planCarousel:beat(s=>coordinator.plan(s)),prepareCarouselExport:beat((s,p)=>coordinator.prepareExport(s,p)),checkCarouselExport:beat((s,p)=>coordinator.checkExport(s,p)),completeCarousel:beat(s=>coordinator.complete(s)),failCarousel:beat(s=>coordinator.fail(s)),generateCreative:beat(s=>creative.run(s)),failCreative:s=>creative.fail(s),exportCreative:beat(s=>handler.run(s)),failExport:s=>handler.fail(s)}});
 try{const client=new Client({connection,namespace:config.jobs.namespace});const result=await temporal.runUntil(()=>client.workflow.execute('generateCarouselWorkflow',{workflowId:'carousel-'+j.id,taskQueue,args:[scope(j)]}));assert.equal(result,'succeeded',JSON.stringify((await admin.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[j.id])).rows));}finally{await native.close();await connection.close();}
 assert.equal(planning,1);assert.equal(images,2);
 const read=await service.read(alice.id,brand.id),run=read.runs.find(r=>r.id===j.id);assert.ok(run.output_version_id);
 const saved=(await admin.query('SELECT * FROM app.carousel_versions WHERE id=$1',[run.output_version_id])).rows[0];assert.equal(saved.status,'draft');assert.equal(saved.reviewed_by,null);
 assert.equal((await admin.query('SELECT * FROM app.carousel_pages WHERE carousel_version_id=$1',[saved.id])).rowCount,2);
 assert.equal((await coordinator.plan(scope(j))).state,'succeeded');assert.equal(await coordinator.complete(scope(j)),'succeeded');assert.equal(planning,1);assert.equal(images,2);
 uncertainAt=4;
 const partial=await service.submit(alice.id,brand.id,{prompt:'TEST FIXTURE: preserve an uncertain partial result',slide_count:3,channel:'instagram',size:'1024x1024',text_provider:'openai'},randomUUID());
 const ready=await coordinator.plan(scope(partial));assert.equal(ready.state,'ready');
 const first=ready.children[0],second=ready.children[1];
 assert.equal(await creative.run({...scope(partial),jobId:first.generation_job_id}),'succeeded');
 const exp=await coordinator.prepareExport(scope(partial),0);assert.equal(exp.state,'ready');assert.equal(await handler.run(exp.export_scope),'succeeded');
 assert.equal(await creative.run({...scope(partial),jobId:second.generation_job_id}),'unknown');
 assert.equal((await coordinator.prepareExport(scope(partial),1)).state,'unknown');
 assert.equal((await coordinator.plan(scope(partial))).state,'unknown');assert.equal(images,4);assert.equal(planning,2);
 const partialRead=await service.read(alice.id,brand.id),slides=partialRead.slides.filter(s=>s.parent_job_id===partial.id);
 assert.deepEqual(slides.map(s=>s.generation_status),['succeeded','unknown','canceled']);assert.ok(slides[0].output_version_id);assert.ok(slides[0].export_id);assert.equal(partialRead.runs.find(r=>r.id===partial.id).output_version_id,null);
 await assert.rejects(service.cancel(alice.id,brand.id,partial.id),/Active carousel generation not found/);assert.equal(await coordinator.fail(scope(partial)),'unknown');assert.equal(images,4);
 await assert.rejects(service.submit(alice.id,brand.id,{prompt:'Must not bypass the unknown hold',slide_count:2,channel:'instagram',size:'1024x1024',text_provider:'openai'},randomUUID()),/reconciliation/);

});


test('carousel calendar attachment binds exact ordered versions, requires final review, isolates businesses and invalidates edits',async()=>{
 const {Carousels}=await import('../../dist/carousels.js'),carousels=new Carousels(canvas,renderer.image);
 const a=await fixture(),b=await fixture(),ea=await render(a),eb=await render(b);
 const input={project_id:null,parent_id:null,title:'Calendar carousel',caption:'TEST shared caption',channel:'linkedin',pages:[{creative_version_id:a.id,export_id:ea.id,alt_text:'First'},{creative_version_id:b.id,export_id:eb.id,alt_text:'Second'}]};
 const c=await carousels.save(alice.id,brand.id,input,randomUUID());
 const plan=await plans.create(alice.id,brand.id,{title:'Carousel calendar',objective:'TEST awareness',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'linkedin',planned_at:'2026-11-01T10:00:00Z',format:'static',brief:'TEST placeholder planning slot'}]},randomUUID());
 const body={carousel_version_id:c.id,planned_at:'2026-11-02T10:00:00Z',channel:'linkedin',brief:'TEST carousel story'},key=randomUUID();
 await assert.rejects(plans.addCarousel(viewer.id,brand.id,plan.id,body,key));await assert.rejects(plans.addCarousel(bob.id,brand.id,plan.id,body,key));await assert.rejects(plans.addCarousel(alice.id,sibling.id,plan.id,body,key));
 await assert.rejects(plans.addCarousel(alice.id,brand.id,plan.id,{...body,channel:'instagram'},key));
 const slot=await plans.addCarousel(alice.id,brand.id,plan.id,body,key);assert.deepEqual(await plans.addCarousel(alice.id,brand.id,plan.id,body,key),slot);
 await assert.rejects(plans.addCarousel(alice.id,brand.id,plan.id,{...body,brief:'Changed'},key));
 const query={start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:plan.id};
 let s=(await plans.list(alice.id,brand.id,query)).slots.find(x=>x.id===slot.id);assert.equal(s.caption,input.caption);assert.equal(s.format,'carousel');assert.equal(s.state,'draft_ready');assert.equal(s.creative_version_id,null);assert.equal(s.video_version_id,null);
 const decision=action=>({revision:s.revision,carousel_version_id:s.carousel_version_id,carousel_sha256:s.carousel_sha256,decision:action});
 await assert.rejects(plans.review(alice.id,brand.id,s.id,{revision:s.revision,decision:'pending_review'}),/current post/);
 s=await plans.review(alice.id,brand.id,s.id,decision('pending_review'));
 await assert.rejects(plans.review(alice.id,brand.id,s.id,decision('approved')),/every saved carousel slide/);
 let v=(await carousels.read(alice.id,brand.id,c.project_id)).versions[0];await carousels.review(alice.id,brand.id,v.id,{revision:1,sha256:v.sha256,decision:'in_review',feedback:'',confirmed:true});await carousels.review(alice.id,brand.id,v.id,{revision:2,sha256:v.sha256,decision:'approved',feedback:'',confirmed:true});
 s=await plans.review(alice.id,brand.id,s.id,decision('approved'));assert.equal(s.state,'approved');
 const events=(await plans.history(alice.id,brand.id,s.id)).events;assert.equal(events.at(-1).carousel_version_id,c.id);assert.equal(events.at(-1).snapshot.carousel_sha256,s.carousel_sha256);
 await assert.rejects(plans.edit(alice.id,brand.id,s.id,{revision:s.revision,brief:'Revised'}),/Confirm/);
 s=await plans.edit(alice.id,brand.id,s.id,{revision:s.revision,brief:'Revised',reset_approval:true});assert.equal(s.state,'draft_ready');assert.equal(s.approved_by,null);
 await canvas.save(alice.id,brand.id,a.project_id,{parent_id:a.id,design:a.design,caption:'Changed source slide'});
 assert.equal((await plans.list(alice.id,brand.id,query)).slots.find(x=>x.id===s.id).has_newer_version,true);
 await assert.rejects(plans.review(alice.id,brand.id,s.id,decision('pending_review')),/current saved slides/);
 await assert.rejects(plans.scope(alice.id,brand.id,false,db=>exports.publicationProof(db,s.id)));
});
