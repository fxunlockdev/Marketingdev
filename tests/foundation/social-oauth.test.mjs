import {test,before,after,beforeEach} from 'node:test';
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
import {SocialOAuthJobs} from '../../dist/social-oauth-jobs.js';
import {OAuthSecrets} from '../../dist/oauth-secrets.js';
import {PostizVault} from '../../dist/postiz-vault.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),workerPool=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const encryptionKey=randomBytes(32).toString('hex'),vault=new PostizVault(encryptionKey),keyA='MOCK_POSTIZ_KEY_A_'+randomBytes(16).toString('hex'),keyB='MOCK_POSTIZ_KEY_B_'+randomBytes(16).toString('hex');
let oauth,oauthSecrets,exchangeCalls=0,startCalls=0,listCalls=0,exchangeBehavior,listBehavior,startBehavior,pageBehavior,pageCalls=0;
const oauthKey=randomBytes(32).toString('hex');
let app,base,ws,service,handler,jobs,alice,bob,editor,viewer,selected,orgA,orgB,brandA,brandB,sibling,provider,providerBase,behavior,calls=0;
const identity=k=>k===keyA?'oauth-remote-org-a':'oauth-remote-org-b';
const channel=(id='remote-channel-a')=>({id,identifier:'linkedin',name:'MOCK authorized account',disabled:false,profile:'https://www.linkedin.com/in/mock',picture:null,token:'MUST_NOT_LEAK',refreshToken:'MUST_NOT_LEAK'});
const scope=(j,b=brandA)=>({organizationId:b.organization_id,brandId:b.id,jobId:j.id});
async function api(path,{user=alice,body,method='GET',key}={}){const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin:config.origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};}
const endpoint=(b=brandA)=>`/api/v1/businesses/${b.id}/connections`;
async function signup(){await admin.query('DELETE FROM auth."rateLimit"');const email=randomUUID()+'@example.test',password='long-social-fixture-password';const r=await api('/api/auth/sign-up/email',{user:null,method:'POST',body:{name:'Social TEST FIXTURE',email,password}});assert.equal(r.status,200);await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);const l=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email,password}});assert.equal(l.status,200);return {id:r.body.user.id,cookie:l.cookie};}
async function bind(b,key){const account={organization_id:b.organization_id,brand_id:b.id,remote_organization_id:identity(key),revision:1};await admin.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,true,now())',[b.organization_id,b.id,account.remote_organization_id,vault.seal(account,key),createHash('sha256').update(key).digest('hex')]);}
const queue=(b=brandA,u=alice)=>service.refresh(u.id,b.id,randomUUID());
const read=(b=brandA,u=alice)=>service.read(u.id,b.id);
before(async()=>{
 config.socialEnabled=true;config.socialAuthorizationEnabled=true;config.oauthEncryptionKey=oauthKey;app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();ws=new Workspaces(app.database);service=new SocialConnections(new Businesses(app.database,ws),true);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();selected=await signup();orgA=await ws.create(alice.id,{name:'MOCK customer A'});orgB=await ws.create(bob.id,{name:'MOCK customer B'});
 brandA={...await ws.createBrand(alice.id,orgA.id,{name:'MOCK brand A'},randomUUID()),organization_id:orgA.id};sibling={...await ws.createBrand(alice.id,orgA.id,{name:'MOCK sibling'},randomUUID()),organization_id:orgA.id};brandB={...await ws.createBrand(bob.id,orgB.id,{name:'MOCK brand B'},randomUUID()),organization_id:orgB.id};
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer'],[selected,'admin']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,$3,$4)',[orgA.id,u.id,role,u===selected?'selected':'all']);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'editor')",[orgA.id,brandA.id,selected.id]);
 await bind(brandA,keyA);await bind(brandB,keyB);
 provider=createServer(async(req,res)=>{calls++;if(req.url==='/api/public/v1/me'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({organization:{id:identity(req.headers.authorization),name:'MOCK remote org'}}));}await behavior(req,res);});await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerBase='http://127.0.0.1:'+provider.address().port;
 behavior=(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([channel(req.headers.authorization===keyA?'remote-channel-a':'remote-channel-b')]));};
 jobs=new AssetJobs(workerPool,null,null);handler=new SocialJobs(jobs,{client:{baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test'},encryptionKey});
 oauthSecrets=new OAuthSecrets(oauthKey);oauth=new SocialOAuthJobs(jobs,{client:{baseURL:providerBase+'/api',mediaOrigins:[providerBase],callbackOrigin:'https://desvio.test',mode:'test',timeoutMs:1500},encryptionKey},oauthKey);
 behavior=async(req,res)=>{
  if(['/api/public/v1/social/linkedin','/api/public/v1/social/instagram-standalone','/api/public/v1/social/facebook'].includes(req.url.split('?')[0])){startCalls++;return startBehavior(req,res);}
  if(['/api/integrations/social-connect/linkedin','/api/integrations/social-connect/instagram-standalone','/api/integrations/social-connect/facebook'].includes(req.url)){exchangeCalls++;let raw='';for await(const chunk of req)raw+=chunk;return exchangeBehavior(req,res,JSON.parse(raw));}
  if(req.url==='/api/integrations/public/provider/facebook-channel/connect'){pageCalls++;let raw='';for await(const chunk of req)raw+=chunk;return pageBehavior(req,res,JSON.parse(raw));}
  if(req.url==='/api/public/v1/integrations'){listCalls++;return listBehavior(req,res);}
  res.writeHead(404);res.end();
 };
});
after(async()=>{provider?.closeAllConnections();if(provider)await new Promise(r=>provider.close(r));await app?.close();await Promise.all([admin.end(),workerPool.end()]);});


const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const callbackPath=(a,b=brandA)=>endpoint(b)+'/oauth/'+a.id+'/callback';
const authorizationPath=(a,b=brandA)=>endpoint(b)+'/oauth/'+a.id;
beforeEach(async()=>{
 await admin.query("UPDATE app.jobs SET created_at=now()-interval '2 hours' WHERE kind='social.authorize'");
 startBehavior=(req,res)=>json(res,{url:'https://www.linkedin.com/oauth/v2/authorization?'+new URLSearchParams({state:'MOCK_UPSTREAM_STATE',client_id:'MOCK_APP',response_type:'code',redirect_uri:'https://desvio.test/integrations/social/linkedin'})});
 exchangeBehavior=(req,res,body)=>{assert.equal(body.state,'MOCK_UPSTREAM_STATE');return json(res,{id:'oauth-channel',organizationId:identity(req.headers.authorization),providerIdentifier:'linkedin',internalId:'MOCK_PERSON',name:'MOCK approved member',token:'NEVER_RETURN_TOKEN'});};
 listBehavior=(req,res)=>json(res,[channel('oauth-channel')]);
});
async function begin({user=alice,business=brandA,key=randomUUID()}={}){const r=await api(endpoint(business)+'/oauth/linkedin',{user,method:'POST',body:{},key});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function prepare(options={}){const a=await begin(options);assert.equal(await oauth.run(scope(a,options.business??brandA)),'awaiting_consent');const r=await api(authorizationPath(a,options.business??brandA),{user:options.user??alice});assert.equal(r.status,200);return {...a,state:new URL(r.body.authorization_url).searchParams.get('state'),url:r.body.authorization_url};}
const callback=(a,patch={},user=alice)=>api(callbackPath(a),{user,method:'POST',body:{state:a.state,code:'MOCK_AUTHORIZATION_CODE',denied:false,timezone:'-480',...patch}});
async function complete(a){const r=await callback(a);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
async function status(a){return (await api(authorizationPath(a))).body;}
async function workflow(job){const native=await NativeConnection.connect({address:config.jobs.address}),connection=await Connection.connect({address:config.jobs.address}),taskQueue='oauth-'+randomUUID();const w=await Worker.create({connection:native,namespace:config.jobs.namespace,taskQueue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{authorizeSocial:async s=>{const ctx=Context.current(),timer=setInterval(()=>ctx.heartbeat(),1000);try{return await oauth.run(s);}finally{clearInterval(timer);}},failSocialOAuth:s=>oauth.fail(s)}});try{return await w.runUntil(()=>new Client({connection,namespace:config.jobs.namespace}).workflow.execute('authorizeSocialWorkflow',{workflowId:'oauth-'+job.id,taskQueue,args:[scope(job)]}));}finally{await native.close();await connection.close();}}

test('OAuth initiation requires verified admin session and is idempotent; authorization URLs are private to the initiating login',async()=>{
 const path=endpoint()+'/oauth/linkedin';assert.equal((await api(path,{user:null,method:'POST',body:{},key:randomUUID()})).status,401);
 for(const user of [viewer,editor,selected])assert.equal((await api(path,{user,method:'POST',body:{},key:randomUUID()})).status,403);
 assert.equal((await api(path,{user:bob,method:'POST',body:{},key:randomUUID()})).status,404);
 const key=randomUUID(),[a,b]=await Promise.all([begin({key}),begin({key})]);assert.equal(a.id,b.id);assert.equal(await workflow(a),'awaiting_consent');
 const r=await status(a);assert.equal(r.phase,'awaiting_consent');const state=new URL(r.authorization_url).searchParams.get('state');assert.match(state,new RegExp('^'+brandA.id+'\\.'+a.id+'\\.[A-Za-z0-9_-]{43}$'));assert.ok(!r.authorization_url.includes('MOCK_UPSTREAM_STATE'));
 assert.equal((await api(authorizationPath(a),{user:bob})).status,404);
 const email=(await admin.query('SELECT email FROM auth."user" WHERE id=$1',[alice.id])).rows[0].email;const login=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email,password:'long-social-fixture-password'}});assert.equal(login.status,200);assert.equal((await api(authorizationPath(a),{user:{id:alice.id,cookie:login.cookie}})).status,404);assert.equal((await callback({...a,state},{},{id:alice.id,cookie:login.cookie})).status,404);
 for(const [pool,query] of [[app.database.pool,'SELECT encrypted_state FROM app.social_authorizations'],[app.database.pool,'SELECT encrypted_code FROM app.social_callbacks'],[workerPool,'SELECT token FROM auth.session']])await assert.rejects(pool.query(query),e=>e.code==='42501');
 assert.equal((await workerPool.query('SELECT * FROM app.social_authorizations')).rowCount,0);
 const bobSession=(await admin.query('SELECT id FROM auth.session WHERE \"userId\"=$1',[bob.id])).rows[0].id;assert.equal((await workerPool.query('SELECT app.oauth_session_live($1) AS live',[bobSession])).rows[0].live,false);await jobs.transaction(scope(a),async db=>assert.equal((await db.query('SELECT app.oauth_session_live($1) AS live',[bobSession])).rows[0].live,false));
});

test('one-time callback persists encrypted code, confirms the actual remote account and clears temporary secrets',async()=>{
 const a=await prepare(),forged={...a,state:a.state.slice(0,-1)+(a.state.endsWith('A')?'B':'A')};assert.equal((await callback(forged)).status,404);
 assert.equal((await callback(a,{},bob)).status,404);const before=exchangeCalls;
 const [r1,r2]=await Promise.all([callback(a),callback(a)]);assert.equal(r1.status,201);assert.equal(r1.body.id,r2.body.id);
 assert.equal((await callback(a,{code:'DIFFERENT_CODE'})).status,409);
 const stored=(await admin.query('SELECT * FROM app.social_callbacks WHERE job_id=$1',[r1.body.id])).rows[0];assert.ok(!stored.encrypted_code.includes(Buffer.from('MOCK_AUTHORIZATION_CODE')));assert.throws(()=>oauthSecrets.open(`${orgA.id}:${brandB.id}:${a.id}`,'code',stored.encrypted_code),/OAUTH_SECRET_INVALID/);
 assert.equal(await workflow(r1.body),'succeeded');assert.equal(exchangeCalls,before+1);assert.equal((await status(a)).phase,'succeeded');assert.equal((await status(a)).authorization_url,null);
 assert.equal(await oauth.run(scope(r1.body)),'finished');assert.equal(exchangeCalls,before+1);
 const ch=(await read()).channels.find(x=>x.name==='MOCK authorized account');assert.equal(ch.observed_state,'available');assert.equal(ch.token_health,'unknown');assert.ok(!JSON.stringify(await read()).includes('NEVER_RETURN_TOKEN'));
 assert.equal((await admin.query('SELECT encrypted_code FROM app.social_callbacks WHERE job_id=$1',[r1.body.id])).rows[0].encrypted_code,null);assert.equal((await admin.query('SELECT encrypted_state FROM app.social_authorizations WHERE id=$1',[a.id])).rows[0].encrypted_state,null);
});

test('read-only confirmation failures resume without exchanging an authorization code again',async()=>{
 const a=await prepare(),j=await complete(a),before=exchangeCalls;listBehavior=(req,res)=>{res.setHeader('retry-after','90');json(res,{error:'MOCK failure'},429);};
 await assert.rejects(oauth.run(scope(j)),e=>e instanceof SocialReadRetry&&e.delaySeconds===90);assert.equal((await status(a)).phase,'verifying');assert.equal(exchangeCalls,before+1);
 listBehavior=(req,res)=>json(res,[channel('oauth-channel')]);assert.equal(await oauth.run(scope(j)),'succeeded');assert.equal(exchangeCalls,before+1);
});

test('lost mutation response and interrupted exchange remain unknown and never automatically repeat',async()=>{
 const a=await prepare(),j=await complete(a),before=exchangeCalls;exchangeBehavior=(req,res)=>req.socket.destroy();
 assert.equal(await oauth.run(scope(j)),'unknown');assert.equal((await status(a)).phase,'unknown');assert.equal(exchangeCalls,before+1);assert.equal(await oauth.run(scope(j)),'finished');assert.equal(exchangeCalls,before+1);
 const b=await prepare(),k=await complete(b);await admin.query("UPDATE app.social_callbacks SET phase='exchanging' WHERE job_id=$1",[k.id]);assert.equal(await oauth.run(scope(k)),'finished');assert.equal((await status(b)).phase,'unknown');assert.equal(exchangeCalls,before+1);
});

test('expired links, denied consent, revoked sessions and changed credentials do not exchange a code',async()=>{
 const a=await prepare();await admin.query("UPDATE app.social_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);assert.equal((await callback(a)).status,409);assert.equal((await status(a)).phase,'expired');
 const b=await prepare(),denied=await callback(b,{code:undefined,denied:true});assert.equal(denied.status,201);const before=exchangeCalls;assert.equal(await oauth.run(scope(denied.body)),'finished');assert.equal((await status(b)).phase,'canceled');
 const c=await prepare(),j=await complete(c);const session=(await admin.query('SELECT s.id,s."expiresAt" FROM auth.session s JOIN app.social_authorizations a ON a.session_id=s.id WHERE a.id=$1',[c.id])).rows[0];await admin.query("UPDATE auth.session SET \"expiresAt\"=now()-interval '1 second' WHERE id=$1",[session.id]);try{assert.equal(await oauth.run(scope(j)),'finished');assert.equal((await admin.query('SELECT phase FROM app.social_callbacks WHERE job_id=$1',[j.id])).rows[0].phase,'canceled');}finally{await admin.query('UPDATE auth.session SET "expiresAt"=$2 WHERE id=$1',[session.id,session.expiresAt]);}
 const d=await prepare(),k=await complete(d);await admin.query('UPDATE app.postiz_accounts SET revision=2 WHERE brand_id=$1',[brandA.id]);try{assert.equal(await oauth.run(scope(k)),'finished');assert.equal((await status(d)).phase,'rejected');}finally{await admin.query('UPDATE app.postiz_accounts SET revision=1 WHERE brand_id=$1',[brandA.id]);}
 assert.equal(exchangeCalls,before);
});

test('permission loss and cancellation stop queued authorizations; in-flight role loss prevents local promotion',async()=>{
 const a=await begin(),before=startCalls;await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[a.id]);assert.equal(await oauth.run(scope(a)),'finished');assert.equal(startCalls,before);
 const b=await prepare(),j=await complete(b),count=exchangeCalls;await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);try{assert.equal(await oauth.run(scope(j)),'finished');assert.equal(exchangeCalls,count);}finally{await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);}
 const c=await prepare(),k=await complete(c);exchangeBehavior=async(req,res)=>{await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);json(res,{id:'new-unpromoted-account',organizationId:'oauth-remote-org-a',providerIdentifier:'linkedin',internalId:'new-person',name:'Unpromoted'});};try{assert.equal(await oauth.run(scope(k)),'finished');assert.equal((await admin.query("SELECT 1 FROM app.social_channels WHERE remote_id='new-unpromoted-account'")).rowCount,0);}finally{await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);}
});

test('failed local promotion retries only account verification; foreign-business account IDs cannot move',async()=>{
 const a=await prepare(),j=await complete(a),before=exchangeCalls;
 await admin.query("CREATE FUNCTION app.test_oauth_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST OAuth commit failure'; END$$");await admin.query('CREATE TRIGGER test_oauth_failure BEFORE INSERT ON app.social_channels FOR EACH ROW EXECUTE FUNCTION app.test_oauth_failure()');
 try{await assert.rejects(oauth.run(scope(j)),/TEST OAuth commit failure/);}finally{await admin.query('DROP TRIGGER test_oauth_failure ON app.social_channels');await admin.query('DROP FUNCTION app.test_oauth_failure()');}
 assert.equal((await status(a)).phase,'verifying');assert.equal(await oauth.run(scope(j)),'succeeded');assert.equal(exchangeCalls,before+1);
 const b=await prepare({business:brandB,user:bob}),r=await api(callbackPath(b,brandB),{user:bob,method:'POST',body:{state:b.state,code:'MOCK_CODE_B',denied:false,timezone:'0'}});assert.equal(r.status,201);
 await assert.rejects(oauth.run(scope(r.body,brandB)),e=>e.code==='42501');await oauth.fail(scope(r.body,brandB));assert.equal((await admin.query("SELECT brand_id FROM app.social_channels WHERE remote_id='oauth-channel'")).rows[0].brand_id,brandA.id);
});

test('foreign upstream organizations, missing accounts and provider rejection cannot claim success',async()=>{
 const a=await prepare(),j=await complete(a);exchangeBehavior=(req,res)=>json(res,{id:'untrusted-account',organizationId:'WRONG_ORG',providerIdentifier:'linkedin',internalId:'person',name:'Wrong'});assert.equal(await oauth.run(scope(j)),'unknown');
 const b=await prepare(),k=await complete(b);exchangeBehavior=(req,res)=>json(res,{error:'secret-bearing error'},401);assert.equal(await oauth.run(scope(k)),'rejected');assert.ok(!JSON.stringify(await status(b)).includes('secret-bearing'));
 const c=await prepare(),m=await complete(c);exchangeBehavior=(req,res)=>json(res,{id:'missing-account',organizationId:'oauth-remote-org-a',providerIdentifier:'linkedin',internalId:'person',name:'Missing'});assert.equal(await oauth.run(scope(m)),'unknown');assert.equal((await admin.query("SELECT 1 FROM app.social_channels WHERE remote_id='missing-account'")).rowCount,0);
});


test('authorization attempts are bounded and mutation responses that cannot be persisted are never re-exchanged',async()=>{
 for(let i=0;i<10;i++)await begin();const limited=await api(endpoint()+'/oauth/linkedin',{method:'POST',body:{},key:randomUUID()});assert.equal(limited.status,409);
 await admin.query("UPDATE app.jobs SET created_at=now()-interval '2 hours' WHERE kind='social.authorize'");
 const a=await prepare(),j=await complete(a),before=exchangeCalls;
 await admin.query("CREATE FUNCTION app.test_exchange_save_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.phase='verifying' THEN RAISE EXCEPTION 'TEST lost exchange persistence'; END IF; RETURN NEW; END$$");await admin.query('CREATE TRIGGER test_exchange_save_failure BEFORE UPDATE ON app.social_callbacks FOR EACH ROW EXECUTE FUNCTION app.test_exchange_save_failure()');
 try{await assert.rejects(oauth.run(scope(j)),/TEST lost exchange persistence/);}finally{await admin.query('DROP TRIGGER test_exchange_save_failure ON app.social_callbacks');await admin.query('DROP FUNCTION app.test_exchange_save_failure()');}
 assert.equal(exchangeCalls,before+1);assert.equal(await oauth.run(scope(j)),'finished');assert.equal((await status(a)).phase,'unknown');assert.equal(exchangeCalls,before+1);
});


test('lost authorization-start response is held without retry, and revoked session cannot start a provider flow',async()=>{
 const a=await begin(),before=startCalls;startBehavior=(req,res)=>req.socket.destroy();assert.equal(await oauth.run(scope(a)),'unknown');assert.equal(await oauth.run(scope(a)),'finished');assert.equal(startCalls,before+1);assert.equal((await status(a)).authorization_url,null);
 const b=await begin();await admin.query('UPDATE app.social_authorizations SET session_id=$2 WHERE id=$1',[b.id,randomUUID()]);assert.equal(await oauth.run(scope(b)),'finished');assert.equal(startCalls,before+1);
});


test('targeted reconnect preserves identity, is tenant scoped and rejects a different callback account',async()=>{
 const original=await prepare(),connected=await callback(original);
 assert.equal(await oauth.run(scope(connected.body)),'succeeded');
 const saved=(await admin.query("SELECT id,internal_id FROM app.social_channels WHERE brand_id=$1 AND remote_id='oauth-channel'",[brandA.id])).rows[0];
 assert.equal(saved.internal_id,'MOCK_PERSON');
 const path=endpoint()+'/oauth/linkedin',key=randomUUID();
 const request=()=>api(path,{method:'POST',key,body:{channelId:saved.id}});
 const queued=await request();assert.equal(queued.status,201);assert.deepEqual((await request()).body,queued.body);
 assert.equal((await api(path,{method:'POST',key,body:{}})).status,409);
 assert.equal((await api(endpoint(brandB)+'/oauth/linkedin',{user:bob,method:'POST',key:randomUUID(),body:{channelId:saved.id}})).status,404);
 const previous=startBehavior;startBehavior=(req,res)=>{assert.equal(new URL(req.url,'http://mock').searchParams.get('refresh'),'MOCK_PERSON');return previous(req,res);};
 assert.equal(await oauth.run(scope(queued.body)),'awaiting_consent');
 const ready=await api(authorizationPath(queued.body)),a={...queued.body,state:new URL(ready.body.authorization_url).searchParams.get('state')};
 exchangeBehavior=(req,res)=>json(res,{id:'other-channel',organizationId:identity(req.headers.authorization),providerIdentifier:'linkedin',internalId:'OTHER_PERSON',name:'Wrong account'});
 const returned=await callback(a),before=exchangeCalls;
 assert.equal(await oauth.run(scope(returned.body)),'unknown');
 await oauth.run(scope(returned.body));assert.equal(exchangeCalls,before+1);
 const status=await api(authorizationPath(a));assert.equal(status.body.job.error_code,'POSTIZ_RECONNECT_IDENTITY_MISMATCH');
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.social_channels WHERE remote_id='other-channel'")).rows[0].n,0);
 assert.ok(!JSON.stringify((await read()).channels).includes('MOCK_PERSON'));
});


test('Instagram standalone binds OAuth, replay keys and reconnect to the exact provider and account',async()=>{
 const path=endpoint()+'/oauth/instagram-standalone',key=randomUUID();
 for(const [user,code] of [[null,401],[bob,404],[viewer,403]])assert.equal((await api(path,{user,method:'POST',body:{},key:randomUUID()})).status,code);
 assert.equal((await api(endpoint()+'/oauth/instagram',{method:'POST',body:{},key:randomUUID()})).status,400);
 const a=await api(path,{method:'POST',body:{},key});assert.equal(a.status,201);
 assert.deepEqual((await api(path,{method:'POST',body:{},key})).body,a.body);
 assert.equal((await api(endpoint()+'/oauth/linkedin',{method:'POST',body:{},key})).status,409);
 startBehavior=(req,res)=>{assert.equal(req.url,'/api/public/v1/social/instagram-standalone');return json(res,{url:'https://www.instagram.com/oauth/authorize?'+new URLSearchParams({state:'MOCK_UPSTREAM_STATE',client_id:'MOCK_INSTAGRAM_APP',response_type:'code',redirect_uri:'https://desvio.test/integrations/social/instagram-standalone'})});};
 assert.equal(await oauth.run(scope(a.body)),'awaiting_consent');
 const ready=await status(a.body);assert.equal(ready.provider,'instagram-standalone');
 const attempt={...a.body,state:new URL(ready.authorization_url).searchParams.get('state')};
 exchangeBehavior=(req,res,body)=>{assert.equal(req.url,'/api/integrations/social-connect/instagram-standalone');assert.equal(body.state,'MOCK_UPSTREAM_STATE');return json(res,{id:'instagram-account',organizationId:identity(req.headers.authorization),providerIdentifier:'instagram-standalone',internalId:'IG_PERSON',name:'MOCK Instagram',token:'NEVER_RETURN_TOKEN'});};
 listBehavior=(req,res)=>json(res,[{...channel('instagram-account'),identifier:'instagram-standalone'}]);
 const j=await complete(attempt),before=exchangeCalls;assert.equal(await oauth.run(scope(j)),'succeeded');assert.equal(exchangeCalls,before+1);assert.equal(await oauth.run(scope(j)),'finished');assert.equal(exchangeCalls,before+1);
 const saved=(await read()).channels.find(c=>c.provider==='instagram-standalone');assert.ok(saved.can_reconnect);assert.ok(!JSON.stringify(saved).includes('IG_PERSON'));
 assert.equal((await api(endpoint()+'/oauth/linkedin',{method:'POST',body:{channelId:saved.id},key:randomUUID()})).status,409);
 const reconnect=await api(path,{method:'POST',body:{channelId:saved.id},key:randomUUID()});assert.equal(reconnect.status,201);
 startBehavior=(req,res)=>{assert.equal(new URL(req.url,'http://mock').searchParams.get('refresh'),'IG_PERSON');return json(res,{url:'https://www.instagram.com/oauth/authorize?'+new URLSearchParams({state:'MOCK_UPSTREAM_STATE',client_id:'MOCK_INSTAGRAM_APP',response_type:'code',redirect_uri:'https://desvio.test/integrations/social/instagram-standalone'})});};
 assert.equal(await oauth.run(scope(reconnect.body)),'awaiting_consent');
 const reconnectState=await status(reconnect.body),j2=await complete({...reconnect.body,state:new URL(reconnectState.authorization_url).searchParams.get('state')});
 exchangeBehavior=(req,res)=>json(res,{id:'different-instagram',organizationId:identity(req.headers.authorization),providerIdentifier:'instagram-standalone',internalId:'OTHER_IG_PERSON',name:'Wrong account'});
 assert.equal(await oauth.run(scope(j2)),'unknown');assert.equal((await status(reconnect.body)).job.error_code,'POSTIZ_RECONNECT_IDENTITY_MISMATCH');
});

async function facebookAttempt(){
 startBehavior=(req,res)=>json(res,{url:'https://www.facebook.com/v25.0/dialog/oauth?'+new URLSearchParams({state:'MOCK_UPSTREAM_STATE',client_id:'MOCK_APP',response_type:'code',redirect_uri:'https://desvio.test/integrations/social/facebook'})});
 exchangeBehavior=(req,res)=>json(res,{id:'facebook-channel',organizationId:identity(req.headers.authorization),providerIdentifier:'facebook',internalId:'MOCK_MEMBER',name:'MOCK member',inBetweenSteps:true,pages:[{id:'123',name:'MOCK Page',access_token:'PRIVATE_PAGE_TOKEN'},{id:'456',name:'Other Page'}]});
 listBehavior=(req,res)=>json(res,[{...channel('facebook-channel'),identifier:'facebook',name:'MOCK Page'}]);
 pageBehavior=(req,res,body)=>{assert.deepEqual(body,{state:'MOCK_UPSTREAM_STATE',page:'123'});json(res,{success:true});};
 const r=await api(endpoint()+'/oauth/facebook',{method:'POST',body:{},key:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(await oauth.run(scope(r.body)),'awaiting_consent');const a=await status(r.body);return {...r.body,state:new URL(a.authorization_url).searchParams.get('state')};
}
const choosePage=(a,page_id='123',user=alice)=>api(authorizationPath(a)+'/page',{user,method:'POST',body:{page_id}});

test('Facebook Page choices persist privately; explicit selection resumes the durable workflow once',async()=>{
 const a=await facebookAttempt(),j=await complete(a),before=exchangeCalls,beforePages=pageCalls;
 const running=workflow(j);
 try{
  let pending;for(let i=0;i<100;i++){pending=await status(a);if(pending.phase==='awaiting_page')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(pending.phase,'awaiting_page');assert.deepEqual(pending.pages,[{id:'123',name:'MOCK Page'},{id:'456',name:'Other Page'}]);assert.ok(!JSON.stringify(pending).includes('PRIVATE_PAGE_TOKEN'));
  const stored=(await admin.query('SELECT encrypted_code,page_choices FROM app.social_callbacks WHERE job_id=$1',[j.id])).rows[0];assert.equal(stored.encrypted_code,null);assert.ok(!JSON.stringify(stored).includes('PRIVATE_PAGE_TOKEN'));assert.equal(pageCalls,beforePages);
  assert.equal(await handler.run(scope(await queue())),'succeeded');
  assert.equal((await read()).channels.find(c=>c.provider==='facebook').observed_state,'unconfirmed');
  assert.equal((await workerPool.query('SELECT * FROM app.facebook_connection_observations')).rowCount,0);
  await assert.rejects(app.database.pool.query('SELECT * FROM app.facebook_connection_observations'),e=>e.code==='42501');
  assert.equal((await choosePage(a,'789')).status,400);assert.equal((await choosePage(a,'123',bob)).status,404);assert.equal((await choosePage(a,'123',viewer)).status,403);
  const email=(await admin.query('SELECT email FROM auth."user" WHERE id=$1',[alice.id])).rows[0].email,login=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email,password:'long-social-fixture-password'}});assert.equal((await choosePage(a,'123',{id:alice.id,cookie:login.cookie})).status,404);
  const [first,replay]=await Promise.all([choosePage(a),choosePage(a)]);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.id,replay.body.id);assert.equal((await choosePage(a,'456')).status,409);
  assert.equal(await running,'succeeded');assert.equal(exchangeCalls,before+1);assert.equal(pageCalls,beforePages+1);assert.equal((await status(a)).phase,'succeeded');assert.deepEqual((await status(a)).pages,[]);
  assert.equal((await choosePage(a)).body.id,j.id);assert.equal(await oauth.run(scope(j)),'finished');assert.equal(pageCalls,beforePages+1);
  const saved=(await admin.query("SELECT internal_id FROM app.social_channels WHERE brand_id=$1 AND remote_id='facebook-channel'",[brandA.id])).rows[0];assert.equal(saved.internal_id,'123');
  assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels.find(c=>c.provider==='facebook').observed_state,'available');
  listBehavior=(req,res)=>json(res,[{...channel('foreign-facebook'),identifier:'facebook',name:'Unconfirmed Page'}]);
  assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels.find(c=>c.name==='Unconfirmed Page').observed_state,'unconfirmed');
  assert.equal((await workerPool.query('SELECT * FROM app.social_page_selections')).rowCount,0);
 }finally{await admin.query("UPDATE app.social_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);await running;}
});

test('Facebook selection expiry and lost response never repeat code exchange or Page mutation',async()=>{
 const a=await facebookAttempt(),j=await complete(a);assert.equal(await oauth.run(scope(j)),'awaiting_page');const before=exchangeCalls,beforePages=pageCalls;
 await admin.query("UPDATE app.social_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",[a.id]);assert.equal((await choosePage(a)).status,409);assert.equal((await status(a)).phase,'expired');assert.deepEqual((await status(a)).pages,[]);assert.equal(await oauth.run(scope(j)),'finished');assert.equal(pageCalls,beforePages);assert.equal(exchangeCalls,before);
 assert.equal((await admin.query('SELECT phase FROM app.facebook_connection_observations WHERE job_id=$1',[j.id])).rows[0].phase,'abandoned');
 assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels.find(c=>c.name==='MOCK Page').observed_state,'unconfirmed');
 const recovery=await facebookAttempt(),recoveredJob=await complete(recovery);assert.equal(await oauth.run(scope(recoveredJob)),'awaiting_page');assert.equal((await choosePage(recovery)).status,201);assert.equal(await oauth.run(scope(recoveredJob)),'succeeded');
 assert.equal(await handler.run(scope(await queue())),'succeeded');assert.equal((await read()).channels.find(c=>c.name==='MOCK Page').observed_state,'available');
 const b=await facebookAttempt(),k=await complete(b);assert.equal(await oauth.run(scope(k)),'awaiting_page');assert.equal((await read()).channels.find(c=>c.remote_id==='facebook-channel')?.observed_state??'unconfirmed','unconfirmed');assert.equal((await choosePage(b)).status,201);pageBehavior=(req,res)=>req.socket.destroy();
 assert.equal(await oauth.run(scope(k)),'unknown');assert.equal((await status(b)).phase,'unknown');assert.equal(pageCalls,beforePages+2);assert.equal(await oauth.run(scope(k)),'finished');assert.equal(pageCalls,beforePages+2);
 const c=await facebookAttempt(),l=await complete(c);assert.equal(await oauth.run(scope(l)),'awaiting_page');assert.equal((await choosePage(c)).status,201);await admin.query("UPDATE app.social_callbacks SET phase='selecting_page' WHERE job_id=$1",[l.id]);assert.equal(await oauth.run(scope(l)),'finished');assert.equal((await status(c)).phase,'unknown');assert.equal(pageCalls,beforePages+2);
});

test('Facebook pending Page choices are canceled when the initiating session or role is revoked',async()=>{
 const a=await facebookAttempt(),j=await complete(a);assert.equal(await oauth.run(scope(j)),'awaiting_page');assert.equal((await choosePage(a)).status,201);const before=pageCalls;
 await admin.query("UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);try{assert.equal(await oauth.run(scope(j)),'finished');}finally{await admin.query("UPDATE app.memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",[orgA.id,alice.id]);}
 assert.equal((await status(a)).phase,'canceled');assert.equal(pageCalls,before);
 const b=await facebookAttempt(),k=await complete(b);assert.equal(await oauth.run(scope(k)),'awaiting_page');const session=(await admin.query('SELECT s.id,s."expiresAt" FROM auth.session s JOIN app.social_authorizations a ON a.session_id=s.id WHERE a.id=$1',[b.id])).rows[0];
 await admin.query("UPDATE auth.session SET \"expiresAt\"=now()-interval '1 second' WHERE id=$1",[session.id]);try{assert.equal(await oauth.run(scope(k)),'finished');}finally{await admin.query('UPDATE auth.session SET "expiresAt"=$2 WHERE id=$1',[session.id,session.expiresAt]);}
 assert.equal((await status(b)).phase,'canceled');assert.equal(pageCalls,before);
});

test('unresolved Facebook mutations cannot be concealed by a later successful selection or account refresh',async()=>{
 // Earlier interruption tests deliberately leave uncertain mutations for this
 // remote integration. A fresh acknowledgement does not settle those requests.
 const a=await facebookAttempt(),j=await complete(a);assert.equal(await oauth.run(scope(j)),'awaiting_page');assert.equal((await choosePage(a)).status,201);
 assert.equal(await oauth.run(scope(j)),'unknown');assert.equal((await status(a)).job.error_code,'SOCIAL_OTHER_AUTHORIZATION_UNRESOLVED');
 assert.equal(await handler.run(scope(await queue())),'succeeded');
 assert.equal((await read()).channels.find(c=>c.provider==='facebook'&&c.name==='MOCK Page').observed_state,'unconfirmed');
 const sync=await queue();await jobs.transaction(scope(sync),async db=>{
  const rows=(await db.query('SELECT organization_id,brand_id FROM app.facebook_connection_observations')).rows;
  assert.ok(rows.length>0);assert.ok(rows.every(r=>r.organization_id===orgA.id&&r.brand_id===brandA.id));
  assert.equal((await db.query("UPDATE app.facebook_connection_observations SET phase='verified'")).rowCount,0);
 });
});


test('Page-picker cancellation is session-bound, prevents selection, and does not submit a Page mutation',async()=>{
 const a=await facebookAttempt(),j=await complete(a);assert.equal(await oauth.run(scope(j)),'awaiting_page');const before=pageCalls;
 const cancel=user=>api(authorizationPath(a)+'/cancel',{method:'POST',body:{},user});
 assert.equal((await cancel(bob)).status,404);assert.equal((await cancel(viewer)).status,403);
 const first=await cancel(alice),second=await cancel(alice);assert.equal(first.status,201);assert.equal(first.body.id,second.body.id);
 assert.equal((await status(a)).phase,'canceling');assert.deepEqual((await status(a)).pages,[]);assert.equal((await choosePage(a)).status,409);
 assert.equal(await oauth.run(scope(j)),'finished');assert.equal((await status(a)).phase,'canceled');assert.equal(pageCalls,before);
 assert.equal((await admin.query('SELECT phase FROM app.facebook_connection_observations WHERE job_id=$1',[j.id])).rows[0].phase,'abandoned');
 const b=await facebookAttempt(),k=await complete(b);assert.equal(await oauth.run(scope(k)),'awaiting_page');assert.equal((await choosePage(b)).status,201);
 assert.equal((await api(authorizationPath(b)+'/cancel',{method:'POST',body:{}})).status,409);
});
