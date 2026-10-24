import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Client,Connection} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {createApplication} from '../../dist/app.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {AssetJobs} from '../../dist/jobs.js';
import {SocialConnections} from '../../dist/social-connections.js';
import {SocialJobs,SocialReadRetry} from '../../dist/social-jobs.js';
import {PostizVault} from '../../dist/postiz-vault.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const encryptionKey=randomBytes(32).toString('hex'),vault=new PostizVault(encryptionKey),keyA='MOCK_POSTIZ_KEY_A_'+randomBytes(16).toString('hex'),keyB='MOCK_POSTIZ_KEY_B_'+randomBytes(16).toString('hex');
let app,base,ws,service,handler,jobs,alice,bob,editor,viewer,selected,orgA,orgB,brandA,brandB,sibling,provider,providerBase,behavior,calls=0;
const identity=k=>k===keyA?'remote-org-a':'remote-org-b';
const channel=(id='remote-channel-a')=>({id,identifier:'linkedin',name:'MOCK authorized account',disabled:false,profile:'https://www.linkedin.com/in/mock',picture:null,token:'MUST_NOT_LEAK',refreshToken:'MUST_NOT_LEAK'});
const scope=(j,b=brandA)=>({organizationId:b.organization_id,brandId:b.id,jobId:j.id});
async function api(path,{user=alice,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin:config.origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
const endpoint=(b=brandA)=>`/api/v1/businesses/${b.id}/connections`;
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const email=randomUUID()+'@example.test',password='long-social-fixture-password';const r=await api('/api/auth/sign-up/email',{user:null,method:'POST',body:{name:'Social TEST FIXTURE',email,password}});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const l=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email,password}});assert.equal(l.status,200);return {id:r.body.user.id,cookie:l.cookie};}
async function bind(b,key){const account={organization_id:b.organization_id,brand_id:b.id,remote_organization_id:identity(key),revision:1};await admin.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,true,now())',[b.organization_id,b.id,account.remote_organization_id,vault.seal(account,key),createHash('sha256').update(key).digest('hex')]);}
const queue=(b=brandA,u=alice)=>service.refresh(u.id,b.id,randomUUID());
const read=(b=brandA,u=alice)=>service.read(u.id,b.id);
before(async()=>{
 config.socialEnabled=true;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);service=new SocialConnections(new Businesses(app.database,ws),true);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();selected=await signup();orgA=await ws.create(alice.id,{name:'MOCK customer A'});orgB=await ws.create(bob.id,{name:'MOCK customer B'});
 brandA={...await ws.createBrand(alice.id,orgA.id,{name:'MOCK brand A'},randomUUID()),organization_id:orgA.id};sibling={...await ws.createBrand(alice.id,orgA.id,{name:'MOCK sibling'},randomUUID()),organization_id:orgA.id};brandB={...await ws.createBrand(bob.id,orgB.id,{name:'MOCK brand B'},randomUUID()),organization_id:orgB.id};
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer'],[selected,'admin']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,$3,$4)',[orgA.id,u.id,role,u===selected?'selected':'all']);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'editor')",[orgA.id,brandA.id,selected.id]);
 await bind(brandA,keyA);await bind(brandB,keyB);
 provider=createServer(async(req,res)=>{calls++;if(req.url==='/api/public/v1/me'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({organization:{id:identity(req.headers.authorization),name:'MOCK remote org'}}));}await behavior(req,res);});await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerBase='http://127.0.0.1:'+provider.address().port;
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([channel(req.headers.authorization===keyA?'remote-channel-a':'remote-channel-b')]));};
 jobs=new AssetJobs(workerPool,null,null);handler=new SocialJobs(jobs,{client:{baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test'},encryptionKey});
});
after(async()=>{provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));await app?.close();await Promise.all([admin.end(),workerPool.end()]);});

test('encrypted remote credentials are tenant/revision bound and unavailable to customer SQL and worker writes',async()=>{
 const a=(await admin.query('SELECT * FROM app.postiz_accounts WHERE brand_id=$1',[brandA.id])).rows[0];assert.ok(!a.encrypted_credential.includes(Buffer.from(keyA)));assert.equal(vault.open(a,a.encrypted_credential),keyA);
 for(const patch of [{brand_id:brandB.id},{remote_organization_id:'other'},{revision:2}])assert.throws(()=>vault.open({...a,...patch},a.encrypted_credential),/POSTIZ_CREDENTIAL_INVALID/);
 assert.throws(()=>new PostizVault(randomBytes(32).toString('hex')).open(a,a.encrypted_credential),/POSTIZ_CREDENTIAL_INVALID/);
 await assert.rejects(app.database.pool.query('SELECT encrypted_credential FROM app.postiz_accounts'),e=>e.code==='42501');await assert.rejects(workerPool.query('UPDATE app.postiz_accounts SET enabled=false'),e=>e.code==='42501');assert.equal((await workerPool.query('SELECT * FROM app.postiz_accounts')).rowCount,0);
 await assert.rejects(admin.query('INSERT INTO app.postiz_accounts SELECT organization_id,$1,remote_organization_id,encrypted_credential,credential_fingerprint,revision,enabled,identity_verified_at,created_at FROM app.postiz_accounts WHERE brand_id=$2',[sibling.id,brandA.id]),e=>e.code==='23505');
});
test('authenticated refresh is business scoped, admin-only and concurrent-idempotent',async()=>{
 const path=endpoint();assert.equal((await api(path,{user:null})).status,401);assert.equal((await api(path,{user:bob})).status,404);assert.equal((await api(endpoint(sibling),{user:selected})).status,404);
 for(const user of [viewer,editor,selected])assert.equal((await api(path+'/refresh',{user,method:'POST',body:{},key:randomUUID()})).status,403);
 assert.equal((await read(sibling)).configured,false);assert.equal((await api(endpoint(sibling)+'/refresh',{method:'POST',body:{},key:randomUUID()})).status,409);
 const key=randomUUID(),r=await Promise.all([api(path+'/refresh',{method:'POST',body:{},key}),api(path+'/refresh',{method:'POST',body:{},key})]);r.forEach(x=>assert.equal(x.status,201,JSON.stringify(x.body)));assert.equal(r[0].body.id,r[1].body.id);
 const j=r[0].body,native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='social-'+randomUUID();
 const worker=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{syncSocial:async s=>{const ctx=Context.current(),timer=setInterval(()=>ctx.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(timer);}},failSocial:s=>handler.fail(s)}});
 try{const client=new Client({connection,namespace:config.jobs.namespace});assert.equal(await worker.runUntil(()=>client.workflow.execute('syncSocialWorkflow',{workflowId:'social-'+j.id,taskQueue,args:[scope(j)]})),'succeeded');}finally{await native.close();await connection.close();}
 const capability=await api(path);assert.equal(capability.body.can_manage,true);assert.equal((await api(path,{user:viewer})).body.can_manage,false);assert.equal((await api(path,{user:selected})).body.can_manage,false);assert.equal(capability.body.authorization_available,false);assert.equal(capability.body.setup_status,'ready');
 const data=await read();assert.equal(data.channels.length,1);assert.equal(data.channels[0].observed_state,'available');assert.equal(data.channels[0].token_health,'unknown');assert.ok(!JSON.stringify(data).includes(keyA));assert.ok(!JSON.stringify(data).includes('MUST_NOT_LEAK'));assert.ok(!('remote_id' in data.channels[0]));assert.equal(await handler.run(scope(j)),'finished');
 await jobs.transaction(scope(j),async db=>{assert.deepEqual((await db.query('SELECT remote_organization_id FROM app.postiz_accounts')).rows,[{remote_organization_id:'remote-org-a'}]);assert.equal((await db.query('SELECT * FROM app.creative_exports')).rowCount,0);});
 await assert.rejects(handler.run({...scope(j),brandId:brandB.id}),/JOB_SCOPE_DENIED/);
});
test('observed disabled and missing accounts persist honestly; failed reads never erase prior records',async()=>{
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([{...channel(),disabled:true}]));};assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels[0].observed_state,'disabled');
 behavior=(req,res)=>{res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({secret:keyA}));};assert.equal(await handler.run(scope(await queue())),'rejected');assert.equal((await read()).channels[0].observed_state,'disabled');assert.equal((await read()).jobs[0].error_code,'POSTIZ_AUTH_REJECTED');
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('[]');};assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels[0].observed_state,'missing');assert.equal((await read()).channels[0].token_health,'unknown');
});
test('read-only transient failures retain retry delay and recover without duplicate channels',async()=>{
 behavior=(req,res)=>{res.writeHead(429,{'content-type':'application/json','retry-after':'90'});res.end('{}');};const j=await queue();await assert.rejects(handler.run(scope(j)),e=>e instanceof SocialReadRetry&&e.delaySeconds===90);assert.equal((await read()).jobs[0].status,'retrying');
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([channel()]));};assert.equal(await handler.run(scope(j)),'succeeded');assert.equal((await read()).channels.length,1);
});
test('cancellation, role loss and credential rotation prevent unauthorized or stale promotion',async()=>{
 let j=await queue();await service.cancel(alice.id,brandA.id,j.id);let count=calls;assert.equal(await handler.run(scope(j)),'finished');assert.equal(calls,count);
 j=await queue();await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);try{count=calls;assert.equal(await handler.run(scope(j)),'finished');assert.equal(calls,count);}finally{await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);}
 behavior=async(req,res)=>{await admin.query('UPDATE app.postiz_accounts SET revision=2 WHERE brand_id=$1',[brandA.id]);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([{...channel(),name:'STALE RESULT'}]));};j=await queue();try{assert.equal(await handler.run(scope(j)),'rejected');assert.equal((await read()).channels[0].name,'MOCK authorized account');assert.equal((await read()).jobs[0].error_code,'POSTIZ_ACCOUNT_CHANGED');}finally{await admin.query('UPDATE app.postiz_accounts SET revision=1 WHERE brand_id=$1',[brandA.id]);}
});
test('remote organization mismatch and foreign-channel collision cannot overwrite another business',async()=>{
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([channel('remote-channel-b')]));};assert.equal(await handler.run(scope(await queue(brandB,bob),brandB)),'succeeded');
 const j=await queue();await assert.rejects(handler.run(scope(j)),e=>e.code==='42501');await handler.fail(scope(j));assert.equal((await read()).channels[0].name,'MOCK authorized account');assert.equal((await read(brandB,bob)).channels.length,1);
 const a=(await admin.query('SELECT * FROM app.postiz_accounts WHERE brand_id=$1',[brandA.id])).rows[0];await admin.query('UPDATE app.postiz_accounts SET encrypted_credential=$2 WHERE brand_id=$1',[brandA.id,vault.seal(a,keyB)]);
 try{assert.equal(await handler.run(scope(await queue())),'rejected');assert.equal((await read()).jobs[0].error_code,'POSTIZ_TENANT_MISMATCH');}finally{await admin.query('UPDATE app.postiz_accounts SET encrypted_credential=$2 WHERE brand_id=$1',[brandA.id,a.encrypted_credential]);}
});
test('snapshot promotion rolls back on database failure and a safe repeated read recovers',async()=>{
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([{...channel(),name:'MOCK updated name'}]));};const j=await queue();
 await admin.query("CREATE FUNCTION app.test_social_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST social commit failure'; END$$");await admin.query('CREATE TRIGGER test_social_failure BEFORE INSERT ON app.social_channels FOR EACH ROW EXECUTE FUNCTION app.test_social_failure()');
 try{await assert.rejects(handler.run(scope(j)),/TEST social commit failure/);}finally{await admin.query('DROP TRIGGER test_social_failure ON app.social_channels');await admin.query('DROP FUNCTION app.test_social_failure()');}
 assert.equal((await read()).channels[0].name,'MOCK authorized account');assert.equal(await handler.run(scope(j)),'succeeded');assert.equal((await read()).channels[0].name,'MOCK updated name');assert.equal((await read()).channels.length,1);
});

test('disconnect holds publishing, requires confirmation, scopes identities and never repeats an uncertain deletion',async()=>{
 await admin.query("UPDATE app.jobs SET status='canceled' WHERE brand_id=$1 AND kind='social.sync' AND status IN ('queued','running','retrying')",[brandA.id]);
 await admin.query('UPDATE app.postiz_accounts SET enabled=true WHERE brand_id=$1',[brandA.id]);
 let present=true,deletes=0,lose=false;
 behavior=(req,res)=>{if(req.method==='DELETE'){deletes++;assert.equal(req.url,'/api/public/v1/integrations/disconnect-channel');present=false;if(lose)return req.socket.destroy();res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({id:'disconnect-channel'}));}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(present?[channel('disconnect-channel')]:[]));};
 await handler.run(scope(await queue()));const c=(await read()).channels.find(c=>c.name&&c.observed_state==='available');assert.ok(c);
 const path=endpoint()+'/channels/'+c.id+'/disconnect',key=randomUUID();
 assert.equal((await api(path,{method:'POST',key,body:{}})).status,400);
 assert.equal((await api(path,{user:viewer,method:'POST',key,body:{confirmHistoryRemoval:true}})).status,403);
 assert.equal((await api(endpoint(brandB)+'/channels/'+c.id+'/disconnect',{user:bob,method:'POST',key,body:{confirmHistoryRemoval:true}})).status,404);
 const pending=await api(path,{method:'POST',key,body:{confirmHistoryRemoval:true}});assert.equal(pending.status,201,JSON.stringify(pending.body));
 assert.deepEqual((await api(path,{method:'POST',key,body:{confirmHistoryRemoval:true}})).body,pending.body);
 assert.equal((await read()).channels.find(x=>x.id===c.id).publishing_held,true);
 lose=true;await handler.run(scope(pending.body));await handler.run(scope(pending.body));assert.equal(deletes,1);
 assert.equal((await admin.query('SELECT phase FROM app.social_disconnects WHERE job_id=$1',[pending.body.id])).rows[0].phase,'unknown');
 assert.equal((await api(path,{method:'POST',key:randomUUID(),body:{confirmHistoryRemoval:true}})).status,409);
 await handler.run(scope(await queue()));assert.equal(deletes,1);
 assert.equal((await admin.query('SELECT phase FROM app.social_disconnects WHERE job_id=$1',[pending.body.id])).rows[0].phase,'absent');
 const observed=(await read()).channels.find(x=>x.id===c.id);assert.equal(observed.publishing_held,true);assert.equal(observed.observed_state,'missing');
});

test('acknowledged disconnect requires observed absence; interrupted removal resumes with reads only',async()=>{
 let present=true,deletes=0;behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});if(req.method==='DELETE'){deletes++;present=false;return res.end(JSON.stringify({id:'disconnect-channel'}));}res.end(JSON.stringify(present?[channel('disconnect-channel')]:[]));};
 await handler.run(scope(await queue()));const c=(await read()).channels.find(c=>c.observed_state==='available');
 const job=await service.disconnect(alice.id,brandA.id,c.id,randomUUID(),{confirmHistoryRemoval:true});assert.equal(await handler.run(scope(job)),'succeeded');assert.equal(deletes,1);
 present=true;await handler.run(scope(await queue()));const second=await service.disconnect(alice.id,brandA.id,c.id,randomUUID(),{confirmHistoryRemoval:true});
 await admin.query("UPDATE app.social_disconnects SET phase='removing' WHERE job_id=$1",[second.id]);present=false;
 assert.equal(await handler.run(scope(second)),'succeeded');assert.equal(deletes,1);
});
