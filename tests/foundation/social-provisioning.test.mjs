import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Client,Connection} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {createApplication} from '../../dist/app.js';
import {Workspaces} from '../../dist/workspaces.js';
import {AssetJobs,assertJobRole} from '../../dist/jobs.js';
import {SocialProvisioningJobs} from '../../dist/social-provisioning-jobs.js';
import {SocialOAuthJobs} from '../../dist/social-oauth-jobs.js';
import {SocialReadRetry} from '../../dist/social-jobs.js';
import {PostizVault} from '../../dist/postiz-vault.js';
import {provisionedName} from '../../dist/postiz-provisioner.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),pool=new Pool({connectionString:config.provisionerDatabaseUrl}),ordinaryWorker=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const encryptionKey=randomBytes(32).toString('hex'),oauthKey=randomBytes(32).toString('hex'),signingSecret=randomBytes(32).toString('hex'),vault=new PostizVault(encryptionKey),remote=new Map();
let app,base,ws,alice,bob,viewer,editor,selected,orgA,orgB,provider,providerBase,jobs,handler,providerConfig,createBehavior,identityBehavior,creates=0,checks=0;
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
async function api(path,{user=alice,method='GET',body,key}={}){const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin:config.origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const email=randomUUID()+'@example.test',password='long-provisioning-fixture-password';const r=await api('/api/auth/sign-up/email',{user:null,method:'POST',body:{name:'Provisioning TEST FIXTURE',email,password}});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const l=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email,password}});assert.equal(l.status,200);return {id:r.body.user.id,cookie:l.cookie};}
async function business(user=alice,org=orgA){return {...await ws.createBrand(user.id,org.id,{name:'Provisioning test business'},randomUUID()),organization_id:org.id};}
const endpoint=b=>`/api/v1/businesses/${b.id}/connections`;
const scope=(j,b)=>({organizationId:b.organization_id,brandId:b.id,jobId:j.id});
async function prepare(b,user=alice,key=randomUUID()){const r=await api(endpoint(b)+'/prepare',{user,method:'POST',body:{},key});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
const read=async(b,user=alice)=>(await api(endpoint(b),{user})).body;
function created(payload){const result={id:'provisioned-'+randomUUID(),apiKey:'MOCK_ORG_KEY_'+randomBytes(24).toString('hex')};remote.set(result.apiKey,{id:result.id,name:provisionedName(payload.id)});return result;}
before(async()=>{
 config.socialEnabled=true;config.socialProvisioningEnabled=true;config.oauthEncryptionKey=oauthKey;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);
 alice=await signup();bob=await signup();viewer=await signup();editor=await signup();selected=await signup();orgA=await ws.create(alice.id,{name:'Provisioning fixture A'});orgB=await ws.create(bob.id,{name:'Provisioning fixture B'});
 // Additional fixtures are isolated businesses; the customer default stays three.
 for(const org of [orgA,orgB])await admin.query('INSERT INTO app.account_entitlements(organization_id,max_active_businesses) VALUES($1,100) ON CONFLICT(organization_id) DO UPDATE SET max_active_businesses=100',[org.id]);
 for(const [u,role] of [[viewer,'viewer'],[editor,'editor'],[selected,'admin']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,$3,$4)',[orgA.id,u.id,role,u===selected?'selected':'all']);
 provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url==='/api/enterprise/create-user'){creates++;const p=JSON.parse(Buffer.from(JSON.parse(raw).params.split('.')[1],'base64url'));return createBehavior(req,res,p);}
  if(req.url==='/api/public/v1/me'){checks++;return identityBehavior(req,res,remote.get(req.headers.authorization));}
  if(req.url==='/api/public/v1/social/linkedin')return json(res,{url:'https://www.linkedin.com/oauth/v2/authorization?'+new URLSearchParams({state:'MOCK_SOURCE_STATE',response_type:'code',client_id:'MOCK',redirect_uri:'https://desvio.test/integrations/social/linkedin'})});
  json(res,{},404);
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerBase='http://127.0.0.1:'+provider.address().port;providerConfig={baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test',timeoutMs:1000};
 await assertJobRole(pool,'desvio_provisioner');jobs=new AssetJobs(pool,null,null);handler=new SocialProvisioningJobs(jobs,{client:providerConfig,encryptionKey,signingSecret});
});
beforeEach(()=>{createBehavior=(req,res,p)=>json(res,created(p));identityBehavior=(req,res,organization)=>json(res,{organization});});
after(async()=>{provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));await app?.close();await Promise.all([admin.end(),pool.end(),ordinaryWorker.end()]);});
async function workflow(j,b){const native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='provision-test-'+randomUUID(),worker=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/provisioning-workflow.js',import.meta.url)),activities:{provisionSocial:async s=>{const c=Context.current(),timer=setInterval(()=>c.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(timer);}},failProvisionSocial:s=>handler.fail(s)}});try{return await worker.runUntil(()=>new Client({connection,namespace:config.jobs.namespace}).workflow.execute('provisionSocialWorkflow',{workflowId:'provision-test-'+j.id,taskQueue,args:[scope(j,b)]}));}finally{await native.close();await connection.close();}}

test('admin-only setup coalesces concurrent requests, persists encrypted verified identity and enables real authorization jobs',async()=>{
 const b=await business(),path=endpoint(b)+'/prepare';assert.equal((await api(path,{user:null,method:'POST',body:{},key:randomUUID()})).status,401);for(const user of [viewer,editor])assert.equal((await api(path,{user,method:'POST',body:{},key:randomUUID()})).status,403);assert.equal((await api(path,{user:bob,method:'POST',body:{},key:randomUUID()})).status,404);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'editor')",[orgA.id,b.id,selected.id]);assert.equal((await api(path,{user:selected,method:'POST',body:{},key:randomUUID()})).status,403);
 const [r1,r2]=await Promise.all([prepare(b),prepare(b)]);assert.equal(r1.job.id,r2.job.id);const count=creates;assert.equal(await workflow(r1.job,b),'succeeded');assert.equal(creates,count+1);assert.equal((await read(b)).configured,true);
 const account=(await admin.query('SELECT * FROM app.postiz_accounts WHERE brand_id=$1',[b.id])).rows[0],key=vault.open(account,account.encrypted_credential);assert.ok(remote.has(key));assert.ok(!JSON.stringify(await read(b)).includes(key));assert.equal((await prepare(b)).job,null);assert.equal(await handler.run(scope(r1.job,b)),'finished');assert.equal(creates,count+1);
 const auth=await api(endpoint(b)+'/oauth/linkedin',{method:'POST',body:{},key:randomUUID()});assert.equal(auth.status,201);const oauth=new SocialOAuthJobs(new AssetJobs(ordinaryWorker,null,null),{client:providerConfig,encryptionKey},oauthKey);assert.equal(await oauth.run(scope(auth.body,b)),'awaiting_consent');
});

test('provisioner is isolated from customer content, auth tokens, other jobs and other business credentials',async()=>{
 const b=await business(),j=(await prepare(b)).job;
 for(const sql of ['SELECT token FROM auth.session','SELECT * FROM app.creative_versions','SELECT * FROM app.assets','UPDATE app.postiz_accounts SET enabled=false'])await assert.rejects(pool.query(sql),e=>e.code==='42501');
 for(const [p,sql] of [[app.database.pool,'SELECT encrypted_credential FROM app.social_provisioning'],[ordinaryWorker,'SELECT * FROM app.social_provisioning'],[ordinaryWorker,'INSERT INTO app.postiz_accounts DEFAULT VALUES']])await assert.rejects(p.query(sql),e=>e.code==='42501');
 assert.equal((await pool.query('SELECT * FROM app.postiz_accounts')).rowCount,0);assert.equal((await pool.query('SELECT * FROM app.jobs')).rowCount,0);await assert.rejects(handler.run({...scope(j,b),brandId:randomUUID()}),/JOB_SCOPE_DENIED/);
 const other=await business(bob,orgB),k=(await prepare(other,bob)).job;assert.equal(await handler.run(scope(k,other)),'succeeded');await jobs.transaction(scope(j,b),async db=>assert.equal((await db.query('SELECT * FROM app.postiz_accounts')).rowCount,0));assert.ok(!JSON.stringify(handler).includes(signingSecret));
});

test('candidate verification retries read-only after rate limiting and persists no active binding before confirmation',async()=>{
 const b=await business(),j=(await prepare(b)).job,count=creates;identityBehavior=(req,res)=>{res.setHeader('retry-after','90');json(res,{error:'MOCK rate limit'},429);};await assert.rejects(handler.run(scope(j,b)),e=>e instanceof SocialReadRetry&&e.delaySeconds===90);assert.equal((await read(b)).configured,false);assert.equal((await read(b)).provisioning.phase,'verifying');assert.equal(creates,count+1);
 identityBehavior=(req,res,organization)=>json(res,{organization});assert.equal(await handler.run(scope(j,b)),'succeeded');assert.equal(creates,count+1);
});

test('unknown creation outcomes block new attempts and interrupted activities cannot create duplicate organizations',async()=>{
 const b=await business(),j=(await prepare(b)).job,count=creates;createBehavior=(req,res,p)=>{created(p);req.socket.destroy();};assert.equal(await handler.run(scope(j,b)),'unknown');assert.equal((await read(b)).configured,false);assert.equal((await prepare(b)).job.id,j.id);assert.equal(await handler.run(scope(j,b)),'finished');assert.equal(creates,count+1);
 const other=await business(),k=(await prepare(other)).job;await admin.query("UPDATE app.social_provisioning SET phase='creating' WHERE job_id=$1",[k.id]);assert.equal(await handler.run(scope(k,other)),'finished');assert.equal((await read(other)).provisioning.phase,'unknown');assert.equal(creates,count+1);
});

test('a failed binding commit recovers from the encrypted candidate without creating again',async()=>{
 const b=await business(),j=(await prepare(b)).job,count=creates;await admin.query("CREATE FUNCTION app.test_provision_binding_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST binding commit failure'; END$$");await admin.query('CREATE TRIGGER test_provision_binding_failure BEFORE INSERT ON app.postiz_accounts FOR EACH ROW EXECUTE FUNCTION app.test_provision_binding_failure()');
 try{await assert.rejects(handler.run(scope(j,b)),/TEST binding commit failure/);}finally{await admin.query('DROP TRIGGER test_provision_binding_failure ON app.postiz_accounts');await admin.query('DROP FUNCTION app.test_provision_binding_failure()');}assert.equal((await read(b)).provisioning.phase,'verifying');assert.equal(await handler.run(scope(j,b)),'succeeded');assert.equal(creates,count+1);
});

test('a lost credential persistence commit holds the outcome unknown rather than repeating remote creation',async()=>{
 const b=await business(),j=(await prepare(b)).job,count=creates;await admin.query("CREATE FUNCTION app.test_provision_candidate_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.phase='verifying' THEN RAISE EXCEPTION 'TEST credential save failure'; END IF; RETURN NEW; END$$");await admin.query('CREATE TRIGGER test_provision_candidate_failure BEFORE UPDATE ON app.social_provisioning FOR EACH ROW EXECUTE FUNCTION app.test_provision_candidate_failure()');
 try{await assert.rejects(handler.run(scope(j,b)),/TEST credential save failure/);}finally{await admin.query('DROP TRIGGER test_provision_candidate_failure ON app.social_provisioning');await admin.query('DROP FUNCTION app.test_provision_candidate_failure()');}assert.equal(await handler.run(scope(j,b)),'finished');assert.equal((await read(b)).provisioning.phase,'unknown');assert.equal(creates,count+1);
});

test('wrong business identity and reused remote organization cannot become active bindings',async()=>{
 const b=await business(),j=(await prepare(b)).job;identityBehavior=(req,res,organization)=>json(res,{organization:{...organization,name:'Another business'}});assert.equal(await handler.run(scope(j,b)),'unknown');assert.equal((await read(b)).configured,false);
 identityBehavior=(req,res,organization)=>json(res,{organization});const first=await business(),k=(await prepare(first)).job;assert.equal(await handler.run(scope(k,first)),'succeeded');const existing=(await admin.query('SELECT remote_organization_id FROM app.postiz_accounts WHERE brand_id=$1',[first.id])).rows[0];
 const second=await business(),m=(await prepare(second)).job;createBehavior=(req,res,p)=>{const result=created(p),r={...result,id:existing.remote_organization_id};remote.set(result.apiKey,{id:r.id,name:provisionedName(second.id)});json(res,r);};await assert.rejects(handler.run(scope(m,second)),e=>e.code==='23505');await handler.fail(scope(m,second));assert.equal((await read(second)).configured,false);assert.equal((await read(first)).configured,true);
});

test('cancellation before submission avoids creation, and in-flight permission loss preserves a held encrypted candidate',async()=>{
 const b=await business(),j=(await prepare(b)).job,count=creates;assert.equal((await api(endpoint(b)+'/provisioning/'+j.id+'/cancel',{method:'POST',body:{}})).status,201);assert.equal(await handler.run(scope(j,b)),'finished');assert.equal(creates,count);
 const other=await business(),k=(await prepare(other)).job;createBehavior=async(req,res,p)=>{const result=created(p);await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);json(res,result);};try{assert.equal(await handler.run(scope(k,other)),'finished');const row=(await admin.query('SELECT phase,encrypted_credential FROM app.social_provisioning WHERE job_id=$1',[k.id])).rows[0];assert.equal(row.phase,'unknown');assert.ok(row.encrypted_credential);assert.equal((await admin.query('SELECT * FROM app.postiz_accounts WHERE brand_id=$1',[other.id])).rowCount,0);}finally{await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);}
});

test('known pre-creation rejection can be retried within a cap; existing disabled bindings cannot be re-enabled by setup',async()=>{
 const b=await business();createBehavior=(req,res)=>json(res,{success:false});for(let i=0;i<3;i++){const j=(await prepare(b)).job;assert.equal(await handler.run(scope(j,b)),'rejected');}assert.equal((await api(endpoint(b)+'/prepare',{method:'POST',body:{},key:randomUUID()})).status,409);
 createBehavior=(req,res,p)=>json(res,created(p));const other=await business(),j=(await prepare(other)).job;assert.equal(await handler.run(scope(j,other)),'succeeded');await admin.query('UPDATE app.postiz_accounts SET enabled=false WHERE brand_id=$1',[other.id]);assert.equal((await api(endpoint(other)+'/prepare',{method:'POST',body:{},key:randomUUID()})).status,409);assert.equal((await read(other)).configured,false);
});
