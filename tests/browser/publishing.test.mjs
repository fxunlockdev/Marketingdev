import {prepareVideoImage} from '../../scripts/video-runtime-image.mjs';
import {publishingVideo} from '../fixtures/publishing-video.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {S3Client,PutBucketCorsCommand} from '@aws-sdk/client-s3';
import {port} from '../../scripts/storage-test-services.mjs';
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
before(async()=>{
 config.videoRenderImage=prepareVideoImage();config.socialEnabled=true;config.publishingEnabled=true;base='http://127.0.0.1:'+await port();config.origin=base;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');await startWeb(await app.app.getUrl());ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);canvas=new Canvas(businesses,store);plans=new ContentPlan(businesses);exports=new CreativeExports(canvas,renderer.image);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();org=await ws.create(alice.id,{name:'Export fixtures'});brand=await ws.createBrand(alice.id,org.id,{name:'Northstar Coffee'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Other private brand'},randomUUID());
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 for(const [field,value] of [['brand_name','Northstar Coffee'],['offering','Creative workflow tools'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;current=await fixture();project=current.project_id;await setupProvider();await setupBrowser();
});



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
  if(req.url==='/api/public/v1/upload'){uploads++;const video=raw.includes(Buffer.from('Content-Type: video/mp4')),marker=Buffer.from(`Content-Type: ${video?'video/mp4':'image/png'}\r\n\r\n`),start=raw.indexOf(marker)+marker.length,end=raw.lastIndexOf(Buffer.from('\r\n--'));lastUpload=raw.subarray(start,end);if(video)assert.equal(lastUpload.subarray(4,8).toString(),'ftyp');else assert.equal((await sharp(lastUpload).metadata()).format,'png');if(afterUpload)await afterUpload();if(mode==='uploadLost'){req.socket.destroy();return;}return reply(res,{id:'mock-upload-'+uploads,path:providerBase+'/uploads/mock-'+uploads+(video?'.mp4':'.png')});}
  if(req.url==='/api/public/v1/posts'){submissions++;if(mode==='postRejected')return reply(res,{},401);const body=JSON.parse(raw),id='mock-post-'+randomUUID();postRows.push({id,integration:{id:body.posts[0].integration.id,providerIdentifier:'linkedin'},content:body.posts[0].value[0].content,publishDate:body.date,state:remoteState,releaseId:remoteState==='PUBLISHED'?'MOCK_RELEASE':null,releaseURL:null});if(mode==='postLost'){req.socket.destroy();return;}return reply(res,[{postId:id,integration:body.posts[0].integration.id}]);}
  if(req.url.startsWith('/api/public/v1/posts?')){if(mode==='listFail')return reply(res,{},503);return reply(res,{posts:mode==='listMissing'?[]:mode==='listMismatch'?postRows.map(p=>({...p,integration:{...p.integration,id:'foreign-channel'}})):postRows});}reply(res,{},404);
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerBase='http://127.0.0.1:'+provider.address().port;
 publisher=new Publication(new SocialConnections(businesses,true),exports,true,config.videoRenderImage);handler=new PublicationJobs(jobs,{client:{baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test'},encryptionKey},renderer.image,true,config.videoRenderImage);
}
afterEach(()=>{mode='';afterUpload=undefined;remoteState='QUEUE';});

async function approvedPost(label){const v=await fixture({},label),e=await render(v),date=new Date(Math.floor(Date.now()/60000)*60000+2*86400000).toISOString(),start=date.slice(0,10),p=await plans.create(alice.id,brand.id,{title:'MOCK publication',objective:'Approved publication test',starts_on:start,timezone:'UTC',slots:[{channel:'linkedin',format:'static',planned_at:date,brief:'TEST FIXTURE',creative_version_id:v.id}]},randomUUID());
 let slot=(await plans.list(alice.id,brand.id,{start:start+'T00:00:00Z',end:new Date(Date.parse(start)+30*86400000).toISOString(),plan_id:p.id})).slots[0];slot=await plans.review(alice.id,brand.id,slot.id,{revision:slot.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 await exports.approve(alice.id,brand.id,e.id,{sha256:e.sha256,source_sha256:v.sha256,context_type:'slot',context_id:slot.id,context_revision:slot.revision,confirmed:true});slot=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[slot.id])).rows[0];return {v,e,slot,body:{slot_id:slot.id,revision:slot.revision,export_id:e.id,channel_id:channelId,confirmed:true}};
}
const queuePost=f=>publisher.submit(alice.id,brand.id,f.body,randomUUID());
const record=async j=>(await admin.query('SELECT r.*,j.status,j.error_code FROM app.publication_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.job_id=$1',[j.id])).rows[0];


const children=[],pageErrors=[];
let browser,page,other,reader,fixtures=[],worker,workerRun,native,connection,dispatchPool,dispatchTimer,dispatching=false,paused=false,logs='';
function command(args,env){const child=spawn(process.execPath,args,{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',...env},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',b=>logs=(logs+b.toString()).slice(-12000));child.stderr.on('data',b=>logs=(logs+b.toString()).slice(-12000));return child;}
async function startWeb(apiOrigin){
 await mkdir('work/browser',{recursive:true});const s3=new S3Client({endpoint:config.storage.endpoint,region:config.storage.region,forcePathStyle:true,credentials:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey}});await s3.send(new PutBucketCorsCommand({Bucket:config.storage.bucket,CORSConfiguration:{CORSRules:[{AllowedOrigins:[base],AllowedMethods:['GET','PUT'],AllowedHeaders:['content-type'],MaxAgeSeconds:60}]}}));s3.destroy();
 const env={APP_ORIGIN:base,API_ORIGIN:apiOrigin,S3_BROWSER_ORIGIN:config.storage.endpoint};const build=command(['node_modules/next/dist/bin/next','build','apps/web','--webpack'],env);assert.equal((await once(build,'exit'))[0],0,logs);command(['node_modules/next/dist/bin/next','start','apps/web','-H','127.0.0.1','-p',new URL(base).port],env);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/sign-in')).ok)return;}catch{}await delay(100);}throw new Error('Web service did not start');
}
async function login(p,user){await admin.query('DELETE FROM auth."rateLimit"');await p.goto(base+'/sign-in');await p.getByLabel('Email address').fill(user.email);await p.getByLabel('Password',{exact:true}).fill(user.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p.getByRole('heading',{name:/^Welcome,/})).toBeVisible();}
async function setupBrowser(){
 for(const label of ['Launch announcement','Uncertain submission','Approval changes','Cancel before sending','Recover saved request'])fixtures.push(await approvedPost(label));
 await admin.query('UPDATE app.job_dispatch SET dispatched_at=now()');native=await NativeConnection.connect({address:config.jobs.address});connection=await Connection.connect({address:config.jobs.address});dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl});const queue='publishing-browser-'+randomUUID(),client=new Client({connection,namespace:config.jobs.namespace}),dispatcher=new JobDispatcher(dispatchPool,client,queue);
 worker=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue:queue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{publishSocial:async s=>{const c=Context.current(),t=setInterval(()=>c.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(t);}},reconcileSocial:s=>handler.reconcile(s),failPublication:s=>handler.fail(s)}});workerRun=worker.run();workerRun.catch(()=>{});dispatchTimer=setInterval(async()=>{if(paused||dispatching)return;dispatching=true;try{await dispatcher.runOnce();}finally{dispatching=false;}},100);
 browser=await chromium.launch();page=await(await browser.newContext({viewport:{width:1440,height:1100}})).newPage();other=await(await browser.newContext()).newPage();reader=await(await browser.newContext()).newPage();page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/.test(m.text()))pageErrors.push(m.text());});await login(page,alice);await login(other,bob);await login(reader,viewer);
 console.log('Actual local publishing browser journey: approved fixture creatives, canonical renderer/private S3, auth/RLS/Temporal; explicitly MOCK Postiz publication and status.');
}
after(async()=>{clearInterval(dispatchTimer);await browser?.close();if(worker){worker.shutdown();await workerRun;}await native?.close();await connection?.close();await dispatchPool?.end();for(const child of children.reverse()){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await Promise.race([done,delay(3000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await done;}}}provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));store.close();await app?.close();await Promise.all([admin.end(),workerPool.end()]);});
const url=b=>base+`/b/${b.id}/publishing`;
const activity=()=>page.getByRole('region',{name:'Publishing activity'});
const card=f=>activity().getByRole('listitem').filter({has:page.getByText(f.v.caption,{exact:true})});
async function choose(f){await page.goto(url(brand)+'?slot='+f.slot.id);await expect(page.getByRole('heading',{name:'Confirm publication'})).toBeVisible();await expect(page.getByRole('img',{name:'Exact approved image to be published'})).toBeVisible();await page.getByLabel('Publish to',{exact:true}).selectOption(channelId);await expect(page.getByLabel(/I authorize this exact image/)).toBeEnabled();}
async function confirm(){await page.getByLabel(/I authorize this exact image/).check();await page.getByRole('button',{name:'Confirm and schedule',exact:true}).click();}

test('approved image → exact account/time consent → persisted publishing result, history and real overview counts',async()=>{
 remoteState='PUBLISHED';const f=fixtures[0],before=submissions;await choose(f);await expect(page.getByRole('button',{name:'Confirm and schedule'})).toBeDisabled();assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.getByRole('region',{name:'Confirm publication'}).screenshot({path:'work/browser/publishing-confirm-desktop.png'});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('region',{name:'Confirm publication'}).screenshot({path:'work/browser/publishing-confirm-mobile.png'});await page.setViewportSize({width:1440,height:1100});await confirm();await expect(card(f).getByText('Published',{exact:true})).toBeVisible({timeout:30000});assert.equal(submissions,before+1);assert.equal(digest(lastUpload),f.e.sha256);await page.reload();await expect(card(f).getByText('Published',{exact:true})).toBeVisible();await card(f).getByRole('button',{name:'Status history'}).click();await expect(card(f).getByRole('list').getByText('Published',{exact:true})).toBeVisible();
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'work/browser/publishing-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'work/browser/publishing-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1100});
 await page.getByRole('link',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'Northstar Coffee, at a glance.'})).toBeVisible();await expect(page.getByRole('link',{name:/^Published posts 1 View/})).toBeVisible();assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'work/browser/overview-desktop.png',fullPage:true});
});
test('lost provider acknowledgement is held and cannot be submitted again after reload',async()=>{
 const f=fixtures[1];mode='postLost';await choose(f);const before=submissions;await confirm();await expect(card(f).getByText('Outcome uncertain',{exact:true})).toBeVisible({timeout:30000});assert.equal(submissions,before+1);await page.reload();await expect(card(f).getByText('Outcome uncertain',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Ready to publish'}).getByText(f.v.caption,{exact:true})).toHaveCount(0);await expect(card(f).getByRole('button',{name:'Check post status'})).toHaveCount(0);
});
test('broken preview and changed approval prevent confirmation; no publish is implied by viewing an image',async()=>{
 const f=fixtures[2],before=submissions,pattern=config.storage.endpoint+'/**';await page.route(pattern,route=>route.fulfill({contentType:'image/png',body:'CORRUPT TEST IMAGE'}));await page.goto(url(brand)+'?slot='+f.slot.id);await expect(page.getByText('The approved image failed its integrity check.',{exact:true})).toBeVisible();await expect(page.getByLabel(/I authorize this exact image/)).toBeDisabled();await page.unroute(pattern);await page.getByRole('button',{name:'Reload approved image'}).click();await page.getByLabel('Publish to',{exact:true}).selectOption(channelId);await expect(page.getByLabel(/I authorize this exact image/)).toBeEnabled();
 await plans.edit(alice.id,brand.id,f.slot.id,{revision:f.slot.revision,brief:'Changed since preview',reset_approval:true});await expect(page.getByText('This post changed or already has a publication request.',{exact:false})).toBeVisible({timeout:10000});await expect(page.getByRole('button',{name:'Confirm and schedule'})).toBeDisabled();assert.equal(submissions,before);await page.getByRole('button',{name:'Close confirmation'}).click();
});
test('cancel before submission uses the real queued job; an ambiguous client response cannot double-submit',async()=>{
 paused=true;const f=fixtures[3],before=submissions;await choose(f);await confirm();await expect(card(f).getByText('Queued in Desvio',{exact:true})).toBeVisible();await card(f).getByRole('button',{name:'Cancel request'}).click();paused=false;await expect(card(f).getByText('Canceled',{exact:true})).toBeVisible({timeout:30000});assert.equal(submissions,before);
 remoteState='PUBLISHED';const g=fixtures[4],endpoint=base+path('publications');let dropped=false;await page.route(endpoint,async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});await choose(g);await confirm();await expect(card(g).getByText('Published',{exact:true})).toBeVisible({timeout:30000});assert.equal(submissions,before+1);await expect(page.getByRole('button',{name:'Confirm and schedule'})).toBeDisabled();await page.unroute(endpoint);await page.reload();assert.equal(submissions,before+1);
});
test('status checks preserve history, business switching isolates records, and readonly members cannot publish',async()=>{
 const f=fixtures[0];await page.goto(url(brand));mode='listMissing';await card(f).getByRole('button',{name:'Check post status'}).click();await expect(card(f).getByText('Post not found',{exact:true})).toBeVisible({timeout:30000});await card(f).getByRole('button',{name:'Status history'}).click();await expect(card(f).getByRole('list').getByText('Published',{exact:true})).toBeVisible();mode='';
 await reader.goto(url(brand));await expect(reader.getByText('You can view publishing activity.',{exact:false})).toBeVisible();await expect(reader.getByRole('button',{name:'Review and schedule'})).toHaveCount(0);await expect(reader.getByRole('button',{name:'Check post status'})).toHaveCount(0);await other.goto(url(brand));await expect(other.getByRole('heading',{name:'Business unavailable'})).toBeVisible();
 await page.getByLabel('Business',{exact:true}).selectOption(sibling.id);await expect(page.getByText('No publishing requests match this view.',{exact:true})).toBeVisible();await expect(page.getByText(f.v.caption,{exact:true})).toHaveCount(0);await page.getByRole('link',{name:'Overview',exact:true}).click();await expect(page.getByRole('link',{name:/^Published posts 0 View/})).toBeVisible();await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'work/browser/overview-mobile.png',fullPage:true});assert.deepEqual(pageErrors,[]);assert.ok(!(await page.content()).includes(credential));assert.ok(!logs.includes(credential));assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
});

test('approved video preview → explicit exact-media consent → one MP4 upload and reconciled publication (MOCK Postiz)',async()=>{
 const f=await publishingVideo({admin,store,canvas,exports,plans,alice,org,brand,fixture,render,image:config.videoRenderImage,staticImage:renderer.image});
 remoteState='PUBLISHED';const count=submissions,mediaPattern=config.storage.endpoint+'/**';await page.route(mediaPattern,route=>route.fulfill({contentType:'video/mp4',body:'CORRUPT TEST VIDEO'}));await page.goto(url(brand)+'?slot='+f.slot.id);
 await expect(page.getByText('The approved video failed its integrity check.',{exact:true})).toBeVisible();await expect(page.getByLabel(/I authorize this exact video/)).toBeDisabled();assert.equal(submissions,count);await page.unroute(mediaPattern);await page.getByRole('button',{name:'Reload approved video'}).click();
 await expect(page.getByRole('heading',{name:'Confirm publication'})).toBeVisible();await expect(page.getByLabel('Exact approved video to be published')).toBeVisible();
 await page.getByLabel('Publish to',{exact:true}).selectOption(channelId);await expect(page.getByLabel(/I authorize this exact video/)).toBeEnabled();await expect(page.getByRole('button',{name:'Confirm and schedule'})).toBeDisabled();
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.getByRole('region',{name:'Confirm publication'}).screenshot({path:'work/browser/publishing-video-confirm.png'});
 await page.getByLabel(/I authorize this exact video/).check();await page.getByRole('button',{name:'Confirm and schedule',exact:true}).click();await expect(card(f).getByText('Published',{exact:true})).toBeVisible({timeout:30000});assert.equal(submissions,count+1);assert.deepEqual(lastUpload,f.bytes);
 await page.reload();await expect(card(f).getByText('Published',{exact:true})).toBeVisible();assert.equal(submissions,count+1);
});
