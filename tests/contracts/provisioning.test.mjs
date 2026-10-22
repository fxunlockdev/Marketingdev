import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {PostizProvisioner,provisionedName} from '../../dist/postiz-provisioner.js';
import {provisionerConfigFromEnv} from '../../dist/config.js';
import {JobDispatcher} from '../../dist/jobs.js';
let server,base,handler,calls=0;
const secret='MOCK_ENTERPRISE_SIGNING_SECRET_32_CHARS',key='MOCK_RETURNED_ORG_KEY_ONLY';
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
before(async()=>{server=createServer(async(req,res)=>{calls++;let raw='';for await(const part of req)raw+=part;await handler(req,res,raw);});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
const client=()=>new PostizProvisioner({baseURL:base+'/api',mode:'test',timeoutMs:1000},secret);
test('enterprise provisioning sends the exact pinned signed contract without user email or bearer credentials',async()=>{
 const brand=randomUUID(),attempt=randomUUID();handler=(req,res,raw)=>{
  assert.equal(req.method,'POST');assert.equal(req.url,'/api/enterprise/create-user');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);const body=JSON.parse(raw);assert.deepEqual(Object.keys(body),['params']);const [header,payload,signature]=body.params.split('.');assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{alg:'HS256',typ:'JWT'});assert.equal(createHmac('sha256',secret).update(header+'.'+payload).digest('base64url'),signature);
  const p=JSON.parse(Buffer.from(payload,'base64url'));assert.deepEqual(Object.keys(p).sort(),['email','exp','iat','id','jti','name','saasName'].sort());assert.equal(p.id,brand);assert.equal(p.email,`business-${brand}@desvio.invalid`);assert.equal(p.name,'Desvio business');assert.equal(p.saasName,'Desvio');assert.equal(p.jti,attempt);assert.equal(p.exp-p.iat,60);assert.ok(Math.abs(p.iat-Date.now()/1000)<5);json(res,{id:'MOCK_REMOTE_ORG',apiKey:key,irrelevantSecret:'NOT_RETURNED'});
 };assert.deepEqual(await client().create(brand,attempt),{id:'MOCK_REMOTE_ORG',apiKey:key});assert.equal(provisionedName(brand),'Desvio business###'+brand);assert.ok(!JSON.stringify(client()).includes(secret));
});
test('uncertain provisioning responses never retry or leak upstream secrets',async()=>{
 for(const kind of ['lost','500','malformed','create-false','oversized']){const before=calls;handler=(req,res)=>{if(kind==='lost')return req.socket.destroy();if(kind==='500')return json(res,{secret},500);if(kind==='create-false')return json(res,{create:false});if(kind==='oversized')return json(res,{secret:'x'.repeat(70000)});json(res,{apiKey:secret});};await assert.rejects(client().create(randomUUID(),randomUUID()),e=>e.outcome==='unknown'&&!JSON.stringify(e).includes(secret));assert.equal(calls,before+1);}
 handler=(req,res)=>json(res,{success:false});await assert.rejects(client().create(randomUUID(),randomUUID()),e=>e.code==='POSTIZ_PROVISIONING_REJECTED'&&e.outcome==='rejected');
});
test('provisioning rejects unsafe destinations, redirects, timeout and invalid identifiers',async()=>{
 for(const baseURL of ['http://public.test/api','https://user:secret@service.test/api','https://service.test/api?token=x','https://service.test/other'])assert.throws(()=>new PostizProvisioner({baseURL,mode:'staging'},secret),/CONFIG_INVALID/);
 const before=calls;await assert.rejects(client().create('not-a-business',randomUUID()),e=>e.outcome==='not_sent');assert.equal(calls,before);
 handler=(req,res)=>{res.writeHead(302,{location:base+'/stolen'});res.end();};await assert.rejects(client().create(randomUUID(),randomUUID()),e=>e.outcome==='unknown');assert.equal(calls,before+1);
 handler=()=>{};await assert.rejects(new PostizProvisioner({baseURL:base,mode:'test',timeoutMs:30},secret).create(randomUUID(),randomUUID()),e=>e.code==='POSTIZ_PROVISIONING_TIMEOUT');
});
test('provisioner configuration needs no customer auth, model, ingestion or storage credentials and refuses shared queues/keys',()=>{
 const env={APP_MODE:'test',POSTIZ_PROVISION_TASK_QUEUE:'private-provisioning',POSTIZ_ENCRYPTION_KEY:'a'.repeat(64),POSTIZ_ENTERPRISE_SIGNING_SECRET:secret,POSTIZ_PROVISIONER_DATABASE_URL:'postgresql://desvio_provisioner@127.0.0.1/test',TEMPORAL_ADDRESS:'127.0.0.1:7233',TEMPORAL_NAMESPACE:'test',POSTIZ_BASE_URL:base,POSTIZ_MEDIA_ORIGINS:base,POSTIZ_CALLBACK_ORIGIN:'https://desvio.test'};
 const c=provisionerConfigFromEnv(env);assert.equal(c.taskQueue,'private-provisioning');assert.ok(!('storage' in c));assert.ok(!('authSecret' in c));assert.throws(()=>provisionerConfigFromEnv({...env,TEMPORAL_TASK_QUEUE:env.POSTIZ_PROVISION_TASK_QUEUE}),/separate task queue/);assert.throws(()=>provisionerConfigFromEnv({...env,POSTIZ_ENTERPRISE_SIGNING_SECRET:env.POSTIZ_ENCRYPTION_KEY}),/distinct/);assert.throws(()=>provisionerConfigFromEnv({...env,APP_MODE:'production'}),/release gate/);
});
test('dispatcher sends provisioning only to the isolated queue and refuses an unconfigured destination',async()=>{
 const row={job_id:randomUUID(),organization_id:randomUUID(),brand_id:randomUUID(),kind:'social.provision'},queries=[];const pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:sql.includes('RETURNING job_id')?[row]:[]};}},starts=[];const client={workflow:{start:async(name,options)=>starts.push({name,options})}};
 await new JobDispatcher(pool,client,'ordinary-work').runOnce();assert.equal(starts.length,0);assert.ok(queries.some(x=>x.sql.includes('last_error=')));
 await new JobDispatcher(pool,client,'ordinary-work','private-provisioning').runOnce();assert.equal(starts.length,1);assert.equal(starts[0].name,'provisionSocialWorkflow');assert.equal(starts[0].options.taskQueue,'private-provisioning');assert.deepEqual(starts[0].options.args,[{organizationId:row.organization_id,brandId:row.brand_id,jobId:row.job_id}]);
});
