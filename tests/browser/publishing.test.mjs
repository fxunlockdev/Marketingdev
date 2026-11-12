import {selectOption} from './select-control.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import {S3Client,PutBucketCorsCommand} from '@aws-sdk/client-s3';
import {port} from '../../scripts/storage-test-services.mjs';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {Pool} from 'pg';
import sharp from 'sharp';
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
// Post for Me is the only publisher. Its provider is never called here: every request that would reach it
// (submit, reconcile, refresh) is answered by a browser-side MOCK, and reads go to the API on the local stack.
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const store=new ObjectStore(config.storage),renderer=new StaticRenderer(process.env.RENDER_RUNTIME_IMAGE),jobs=new AssetJobs(workerPool,store,null),exportHandler=new ExportJobs(jobs,renderer);
let app,base,ws,businesses,brain,canvas,plans,exports,alice,bob,editor,viewer,org,brand,sibling,brainId,current,project,canonical,account;
const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#eee7db'}}).png().toBuffer();
const scope=j=>({organizationId:org.id,brandId:brand.id,jobId:j.id});
async function api(path,{user=alice,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin:config.origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
const path=(suffix,b=brand)=>`/api/v1/businesses/${b.id}/${suffix}`;
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const email=randomUUID()+'@example.test',password='long-fixture-password-2026';const r=await api('/api/auth/sign-up/email',{user:null,body:{name:'Export fixture',email,password},method:'POST'});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const login=await api('/api/auth/sign-in/email',{user:null,body:{email,password},method:'POST'});assert.equal(login.status,200);return {id:r.body.user.id,cookie:login.cookie,email,password};}
async function fixture(overrides={},captionLabel='Saved creative'){
 const thread=await canvas.createThread(alice.id,brand.id,{title:'TEST FIXTURE render'},randomUUID()),p=randomUUID(),job=randomUUID(),media=randomUUID(),id=randomUUID();
 const key=`creative/${org.id}/${brand.id}/${job}/${digest(png)}`;await store.persist(key,png,'image/png',digest(png));
 const design={schema_version:1,width:1024,height:1024,background_media_id:media,layers:[{id:'headline',type:'text',text:'TEST FIXTURE: A calmer day',x:80,y:80,width:850,fontSize:56,fontFamily:'Arial',fill:'#112233',align:'left'},{id:'body',type:'text',text:'Owner-editable creative',x:80,y:700,width:850,fontSize:32,fontFamily:'Georgia',fill:'#112233',align:'left'}],...overrides};
 const caption='TEST FIXTURE: '+captionLabel,sha=hash(canonicalJSON({design,caption,brain_id:brainId}));
 await admin.query('INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[p,org.id,brand.id,thread.id,'TEST FIXTURE',alice.id]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'creative.generate','succeeded')",[job,org.id,brand.id,alice.id]);
 await admin.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,1024,1024)',[media,org.id,brand.id,job,key,digest(png),png.length]);
 await admin.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,org.id,brand.id,p,brainId,job,media,JSON.stringify(design),caption,'{}',sha,alice.id]);await admin.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[p,id]);
 return {id,sha256:sha,design,caption,project_id:p,media_id:media};
}
async function queue(v=current){return exports.submit(alice.id,brand.id,v.id,{source_sha256:v.sha256},randomUUID());}
async function render(v){const j=await queue(v);assert.equal(await exportHandler.run(scope(j)),'succeeded');return (await exports.list(alice.id,brand.id,v.id)).exports[0];}
async function approvedPost(label,channel='linkedin'){const v=await fixture({},label),e=await render(v),date=new Date(Math.floor(Date.now()/60000)*60000+2*86400000).toISOString(),start=date.slice(0,10),p=await plans.create(alice.id,brand.id,{title:'MOCK publication',objective:'Approved publication test',starts_on:start,timezone:'UTC',slots:[{channel,format:'static',planned_at:date,brief:'TEST FIXTURE',creative_version_id:v.id}]},randomUUID());
 let slot=(await plans.list(alice.id,brand.id,{start:start+'T00:00:00Z',end:new Date(Date.parse(start)+30*86400000).toISOString(),plan_id:p.id})).slots[0];slot=await plans.review(alice.id,brand.id,slot.id,{revision:slot.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 await exports.approve(alice.id,brand.id,e.id,{sha256:e.sha256,source_sha256:v.sha256,context_type:'slot',context_id:slot.id,context_revision:slot.revision,confirmed:true});slot=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[slot.id])).rows[0];return {v,e,slot,body:{slot_id:slot.id,revision:slot.revision,export_id:e.id,confirmed:true}};
}
const children=[],pageErrors=[];
let browser,page,logs='';
function command(args,env){const child=spawn(process.execPath,args,{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',...env},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',b=>logs=(logs+b.toString()).slice(-12000));child.stderr.on('data',b=>logs=(logs+b.toString()).slice(-12000));return child;}
async function startWeb(apiOrigin){
 await mkdir('work/browser',{recursive:true});const s3=new S3Client({endpoint:config.storage.endpoint,region:config.storage.region,forcePathStyle:true,credentials:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey}});await s3.send(new PutBucketCorsCommand({Bucket:config.storage.bucket,CORSConfiguration:{CORSRules:[{AllowedOrigins:[base],AllowedMethods:['GET','PUT'],AllowedHeaders:['content-type'],MaxAgeSeconds:60}]}}));s3.destroy();
 const env={APP_ORIGIN:base,API_ORIGIN:apiOrigin,S3_BROWSER_ORIGIN:config.storage.endpoint};const build=command(['node_modules/next/dist/bin/next','build','apps/web','--webpack'],env);assert.equal((await once(build,'exit'))[0],0,logs);command(['node_modules/next/dist/bin/next','start','apps/web','-H','127.0.0.1','-p',new URL(base).port],env);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/sign-in')).ok)return;}catch{}await delay(100);}throw new Error('Web service did not start');
}
async function login(p,user){await admin.query('DELETE FROM auth."rateLimit"');await p.goto(base+'/sign-in');await p.getByLabel('Email address').fill(user.email);await p.getByLabel('Password',{exact:true}).fill(user.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p.getByRole('heading',{name:/^(Add your first business|Choose a business|Hello, .+|Your dashboard|Your content\. Your brand\.|Let’s get to know your business|Your creative direction)$/})).toBeVisible();}
before(async()=>{
 config.postformeApiKey='LOCAL MOCK, never sent';config.postformePublishingEnabled=true;base='http://127.0.0.1:'+await port();config.origin=base;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');await startWeb(await app.app.getUrl());ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses,renderer.image);exports=new CreativeExports(canvas,renderer.image);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();org=await ws.create(alice.id,{name:'Export fixtures'});brand=await ws.createBrand(alice.id,org.id,{name:'Northstar Coffee'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Other private brand'},randomUUID());
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 for(const [field,value] of [['brand_name','Northstar Coffee'],['offering','Creative workflow tools'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;current=await fixture();project=current.project_id;
 current=await approvedPost('Launch announcement');
 await admin.query("INSERT INTO app.postforme_bindings(organization_id,brand_id,platform) VALUES($1,$2,'linkedin') ON CONFLICT DO NOTHING",[org.id,brand.id]);
 account=(await admin.query("INSERT INTO app.postforme_accounts(organization_id,brand_id,platform,remote_id,username,status) VALUES($1,$2,'linkedin',$3,'Northstar LinkedIn','connected') RETURNING id",[org.id,brand.id,`mock-${randomUUID()}`])).rows[0];
 browser=await chromium.launch();page=await(await browser.newContext({viewport:{width:1440,height:1100}})).newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 await mockProvider(page);await login(page,alice);
});

const provider=[];
/** Answers every Post for Me mutation in the browser and records it; reads go to the real local API. */
async function mockProvider(p){
 await p.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url());
  // Retired Postiz endpoints must never be requested by the web app.
  if(/\/businesses\/[^/]+\/(connections|publications|analytics)(\/|$)/.test(u.pathname))provider.push({retired:u.pathname});
  if(req.method()==='POST'&&u.pathname.includes('/postforme/')){provider.push({path:u.pathname,body:req.postDataJSON()});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(u.pathname.endsWith('/publications')?{id:randomUUID(),phase:'accepted'}:u.pathname.endsWith('/publications/bulk')?{plan_id:req.postDataJSON().plan_id,results:[{slot_id:randomUUID(),outcome:'accepted'},{slot_id:randomUUID(),outcome:'accepted'}],not_ready:0}:{})});}
  return route.continue();
 });
}
after(async()=>{await browser?.close();for(const child of children.reverse()){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await Promise.race([done,delay(3000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await done;}}}store.close();await app?.close();await Promise.all([admin.end(),workerPool.end()]);});

test('publishing shows Post for Me only: an approved post is scheduled with exact consent to a Post for Me account',async()=>{
 await page.goto(base+`/b/${brand.id}/publishing`);
 await expect(page.getByRole('heading',{name:'Ready to publish'})).toBeVisible();
 await expect(page.getByText('Previous publishing requests and history')).toHaveCount(0);
 const row=page.locator('.publication-ready-list li').filter({hasText:current.v.caption});await expect(row).toBeVisible();
 await row.getByRole('button',{name:'Review and schedule'}).click();
 await expect(page.getByRole('heading',{name:'Confirm publication'})).toBeVisible();
 await expect(page.getByRole('img',{name:'Exact approved image to be published'})).toBeVisible();
 await selectOption(page.getByLabel('Publish to',{exact:true}),account.id);
 await page.getByLabel(/I authorize this exact image/).check();
 await page.getByRole('button',{name:'Confirm and schedule'}).click();
 await expect(page.getByText('Your request is saved.',{exact:false})).toBeVisible();
 const submitted=provider.filter(r=>r.path?.endsWith('/postforme/publications'));
 assert.equal(submitted.length,1);assert.deepEqual(submitted[0].body,{slot_id:current.slot.id,revision:current.slot.revision,export_id:current.e.id,channel_id:account.id,confirmed:true});
 assert.deepEqual(provider.filter(r=>r.retired),[],'the web never calls a retired Postiz endpoint');assert.deepEqual(pageErrors,[]);
});

test('connections and performance render Post for Me without a Postiz history section',async()=>{
 await page.goto(base+`/b/${brand.id}/connections`);
 await expect(page.getByText('Northstar LinkedIn').first()).toBeVisible();
 await expect(page.getByText('Previous connections and history')).toHaveCount(0);
 await page.goto(base+`/b/${brand.id}/publishing`);await page.getByRole('button',{name:'Insights',exact:true}).click();
 await expect(page.getByText('Previous publishing performance')).toHaveCount(0);
 assert.deepEqual(provider.filter(r=>r.retired),[]);assert.deepEqual(pageErrors,[]);
});

test('a whole plan is scheduled at its planned times with one consent, and the publish time can be changed per post',async()=>{
 const one=await approvedPost('Bulk one'),two=await approvedPost('Bulk two');
 await admin.query('UPDATE app.content_slots SET plan_id=$1 WHERE id=$2',[one.slot.plan_id,two.slot.id]);
 await page.goto(base+`/b/${brand.id}/publishing`);
 const all=page.getByRole('button',{name:'Schedule all 2 approved posts in this plan'});await expect(all).toBeVisible();await all.click();
 const confirm=page.getByRole('button',{name:'Schedule all posts'});await expect(confirm).toBeDisabled();
 await page.getByLabel(/I authorize these 2 approved posts/).check();await confirm.click();
 await expect(page.getByText('2 posts scheduled at their planned times.',{exact:false})).toBeVisible();
 const bulk=provider.filter(r=>r.path?.endsWith('/postforme/publications/bulk'));assert.equal(bulk.length,1);assert.deepEqual(bulk[0].body,{plan_id:one.slot.plan_id,confirmed:true});
 const row=page.locator('.publication-ready-list li').filter({hasText:one.v.caption});
 await row.getByRole('button',{name:'Review and schedule'}).click();
 const time=page.getByLabel('Publish at');await expect(time).toHaveValue(new Date(one.slot.planned_at).toISOString().slice(0,16));
 const later=new Date(Date.parse(one.slot.planned_at)+3600000).toISOString().slice(0,16);await time.fill(later);
 await page.getByLabel(/I authorize this exact image/).check();await page.getByRole('button',{name:'Confirm and schedule'}).click();
 await expect(page.getByText('Your request is saved.',{exact:false})).toBeVisible();
 const last=provider.filter(r=>r.path?.endsWith('/postforme/publications')).at(-1);assert.equal(last.body.scheduled_at,later);assert.equal(last.body.slot_id,one.slot.id);
 assert.deepEqual(pageErrors,[]);
});

test('insights and the monthly review render honestly with no results, and an accepted recommendation is saved for next month',async()=>{
 await page.goto(base+`/b/${brand.id}/publishing?view=insights`);
 await expect(page.getByRole('heading',{name:'No published posts yet'})).toBeVisible();
 await page.getByRole('button',{name:'Monthly review',exact:true}).click();
 await expect(page.getByRole('heading',{name:'For next month'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Nothing published this month'})).toBeVisible();
 const boxes=page.locator('fieldset input[type=checkbox]'),use=page.getByRole('button',{name:'Use this for next month'});
 for(let i=0;i<await boxes.count();i++)await boxes.nth(i).uncheck();await expect(use).toBeDisabled();
 await boxes.first().check();await use.click();
 await expect(page.getByText('Saved. Next month’s plan will use these recommendations.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop using'})).toHaveCount(1);
 assert.equal((await admin.query('SELECT count(*)::int n FROM app.learning_accepted_changes WHERE brand_id=$1 AND accepted_by=$2',[brand.id,alice.id])).rows[0].n,1);
 assert.deepEqual(pageErrors,[]);
});
