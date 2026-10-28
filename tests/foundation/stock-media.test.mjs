import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {createApplication} from '../../dist/app.js';
import {StockProvider} from '../../dist/stock-provider.js';
import {StockMedia} from '../../dist/stock-media.js';
import {Assets} from '../../dist/assets.js';
import {ObjectStore,digest} from '../../dist/object-store.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {Canvas} from '../../dist/canvas.js';
import {BrandBrain,canonicalJSON,hash} from '../../dist/brand-brain.js';
import {AssetJobs} from '../../dist/jobs.js';
import {MalwareScanner} from '../../dist/file-validation.js';
import {ContentPlan} from '../../dist/content-plan.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl}),store=new ObjectStore(config.storage);
let runtime,base,alice,bob,viewer,org,brand,sibling,service,canvas,assets,plans,imported,reference,project,parent,slot;
const png=await sharp({create:{width:900,height:600,channels:3,background:'#558877'}}).png().toBuffer();
const photo={id:42,alt:'TEST FIXTURE park',photographer:'Test Photographer',url:'https://www.pexels.com/photo/park-42/',photographer_url:'https://www.pexels.com/@test',src:{medium:'https://images.pexels.com/photos/42/medium.png',large2x:'https://images.pexels.com/photos/42/large.png'}};
let downloads=0;
async function api(path,{user=alice,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{origin:config.origin,...(user?{cookie:user.cookie}:{}),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const name=randomUUID(),password='stock-fixture-password-2026';const r=await api('/api/auth/sign-up/email',{user:null,method:'POST',body:{name,email:`${name}@example.test`,password}});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const login=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email:`${name}@example.test`,password}});return {id:r.body.user.id,cookie:login.cookie};}
before(async()=>{
 runtime=await createApplication(config);await runtime.app.listen(0,'127.0.0.1');base=await runtime.app.getUrl();alice=await signup();bob=await signup();viewer=await signup();
 const ws=new Workspaces(runtime.database),businesses=new Businesses(runtime.database,ws);org=await ws.create(alice.id,{name:'Stock fixture'});brand=await ws.createBrand(alice.id,org.id,{name:'Brand'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Sibling'},randomUUID());await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",[org.id,viewer.id]);
 assets=new Assets(runtime.database,store);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses);
 service=new StockMedia(businesses,assets,new StockProvider('TEST KEY',async url=>{if(url.startsWith('https://api.pexels.com/'))return Response.json(url.includes('/search?')?{photos:[photo],total_results:1}:photo);downloads++;return new Response(png,{headers:{'content-type':'image/png'}});}));
 const brain=new BrandBrain(runtime.database);for(const [field,value] of [['brand_name','Stock Brand'],['offering','Software'],['audience','Businesses']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});const brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;
 const thread=await canvas.createThread(alice.id,brand.id,{title:'TEST FIXTURE creative'},randomUUID()),job=randomUUID(),media=randomUUID();project=randomUUID();parent=randomUUID();await admin.query('INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[project,org.id,brand.id,thread.id,'TEST FIXTURE',alice.id]);await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'creative.generate','succeeded')",[job,org.id,brand.id,alice.id]);await admin.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,1,1024,1024)',[media,org.id,brand.id,job,'TEST_FIXTURE_NOT_LIVE','0'.repeat(64)]);
 const design={schema_version:1,width:1024,height:1024,background_media_id:media,layers:[]};await admin.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[parent,org.id,brand.id,project,brainId,job,media,JSON.stringify(design),'TEST FIXTURE caption','{}',hash(canonicalJSON({design,caption:'TEST FIXTURE caption',brain_id:brainId})),alice.id]);await admin.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[project,parent]);
 const plan=await plans.create(alice.id,brand.id,{title:'Stock plan',objective:'Test photo replacement',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'instagram',planned_at:'2026-11-02T10:00:00Z',format:'static',brief:'TEST FIXTURE',pillar:'',hook:'',cta:'',creative_version_id:parent}]},randomUUID());slot=(await plans.list(alice.id,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:plan.id})).slots[0];
});
after(async()=>{await runtime?.close();store.close();await worker.end();await admin.end();});
test('stock routes enforce real sessions and missing config fails visibly',async()=>{const path=`/api/v1/businesses/${brand.id}/stock?query=park`;assert.equal((await api(path,{user:null})).status,401);assert.equal((await api(path,{user:bob})).status,404);assert.equal((await api(path)).status,503);assert.equal((await service.search(alice.id,brand.id,{query:'park'})).photos[0].id,42);});
test('stock import persists attribution and survives retry without duplicate validation, rejects cross-tenant and viewer',async()=>{
 const key=randomUUID();await assert.rejects(service.import(bob.id,brand.id,{photo_id:42},key));await assert.rejects(service.import(viewer.id,brand.id,{photo_id:42},key));
 imported=await service.import(alice.id,brand.id,{photo_id:42},key);assert.equal(imported.state,'queued');assert.equal(imported.attribution.photographer,'Test Photographer');const count=downloads;assert.equal((await service.import(alice.id,brand.id,{photo_id:42},key)).asset_id,imported.asset_id);assert.equal(downloads,count);await assert.rejects(service.import(alice.id,brand.id,{photo_id:43},key),/another photo/);await assert.rejects(service.status(bob.id,brand.id,key));await assert.rejects(service.status(alice.id,sibling.id,key));
 const job=(await admin.query('SELECT id FROM app.jobs WHERE asset_id=$1',[imported.asset_id])).rows[0];assert.equal(await new AssetJobs(worker,store,new MalwareScanner(config.scanner)).validate({organizationId:org.id,brandId:brand.id,jobId:job.id}),'succeeded');imported=await service.status(alice.id,brand.id,key);assert.equal(imported.state,'ready');assert.ok(imported.visual_id);reference=await canvas.approveReference(alice.id,brand.id,{kind:'upload',visual_id:imported.visual_id,label:'Stock park',consent:true});assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.jobs WHERE asset_id=$1',[imported.asset_id])).rows[0].n,1);
});
test('replacement creates reloadable private new draft and explicit calendar attachment with no approval/publishing',async()=>{
 const body={parent_id:parent,reference_id:reference.id};await assert.rejects(service.replace(bob.id,brand.id,project,body));await assert.rejects(service.replace(viewer.id,brand.id,project,body));
 const changed=await service.replace(alice.id,brand.id,project,body);assert.deepEqual(await service.replace(alice.id,brand.id,project,body),changed);
 const v=(await admin.query('SELECT * FROM app.creative_versions WHERE id=$1',[changed.id])).rows[0];assert.equal(v.parent_id,parent);assert.equal(v.status,'draft');assert.equal(v.reviewed_by,null);assert.equal(v.caption,'TEST FIXTURE caption');
 const media=(await admin.query('SELECT * FROM app.creative_media WHERE id=$1',[v.media_id])).rows[0];assert.equal(media.job_id,null);assert.equal(media.source_uploaded_visual_id,imported.visual_id);const bytes=await store.read(media.object_key);assert.equal(digest(bytes),media.sha256);assert.equal((await sharp(bytes).metadata()).width,1024);
 assert.equal((await plans.list(alice.id,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'})).slots.find(s=>s.id===slot.id).creative_version_id,parent);
 slot=await plans.edit(alice.id,brand.id,slot.id,{revision:slot.revision,creative_version_id:changed.id});assert.equal(slot.creative_version_id,changed.id);assert.equal(slot.state,'draft_ready');assert.equal(slot.approved_by,null);assert.equal((await plans.list(alice.id,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'})).slots.find(s=>s.id===slot.id).creative_version_id,changed.id);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='social.publish'",[brand.id])).rows[0].n,0);
 await assert.rejects(service.replace(alice.id,brand.id,project,{parent_id:parent,reference_id:randomUUID()}));
 await admin.query('UPDATE app.brand_references SET revoked_at=now() WHERE id=$1',[reference.id]);await assert.rejects(service.replace(alice.id,brand.id,project,{parent_id:changed.id,reference_id:reference.id}),/Approved stock photo not found/);
});

test('stock capability hides unavailable discovery without affecting saved media access',async()=>{
 assert.deepEqual(await service.capabilities(alice.id,brand.id),{search_available:true});
 const inactive=new StockMedia(service.businesses,assets,new StockProvider());
 assert.deepEqual(await inactive.capabilities(alice.id,brand.id),{search_available:false});
 await assert.rejects(inactive.capabilities(bob.id,brand.id),/not found/i);
 const result=await api(`/api/v1/businesses/${brand.id}/stock/capabilities`);assert.equal(result.status,200);assert.deepEqual(result.body,{search_available:false});
});
