import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {configurationManifest,configureProviders,inspectConfiguration} from '../../scripts/configure-providers.mjs';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
const org=randomUUID(),brand=randomUUID(),user=randomUUID();
const options={mode:'test',expectedDatabase:'postgres'};
const rates={budget_micros:100000,input_micros_per_token:0.1,output_micros_per_token:0.2};
const manifest=()=>({version:1,change_id:randomUUID(),organization_id:org,business_id:brand,operator_reference:'LOCAL TEST ONLY',grants:[{kind:'onboarding',enabled:false,expires_at:new Date(Date.now()+86400000).toISOString(),model:'test-model',...rates}]});
before(async()=>{
 await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[user,'Operator fixture',`${user}@example.test`]);
 await admin.query('INSERT INTO app.organizations(id,name,created_by) VALUES($1,$2,$3)',[org,'Operator fixture',user]);
 await admin.query('INSERT INTO app.brands(id,organization_id,name) VALUES($1,$2,$3)',[brand,org,'Operator business']);
});
after(()=>admin.end());
test('strict manifest rejects secrets, prototype capabilities, duplicate grants, unsafe budgets and invalid dates',()=>{
 for(const mutate of [m=>m.api_key='secret',m=>m.grants[0].kind='__proto__',m=>m.grants.push({...m.grants[0]}),m=>m.grants[0].budget_micros=NaN,m=>m.grants[0].expires_at='2026-02-30T00:00:00Z',m=>m.grants[0].enabled='true']){
  const m=manifest();mutate(m);assert.throws(()=>configurationManifest(m),e=>e.code?.startsWith('CONFIGURATION_'));
 }
});
test('preview makes no changes; approval applies once and audit is immutable to runtime roles',async()=>{
 const m=manifest(),p=await configureProviders(admin,m,options);assert.equal(p.status,'preview');
 assert.equal((await admin.query('SELECT * FROM app.analysis_grants WHERE brand_id=$1',[brand])).rowCount,0);
 assert.equal((await configureProviders(admin,m,{...options,approval:p.preview_sha256})).status,'applied');
 assert.equal((await configureProviders(admin,m,{...options,approval:p.preview_sha256})).status,'already_applied');
 await assert.rejects(configureProviders(admin,{...m,operator_reference:'changed'},options),{code:'CONFIGURATION_CHANGE_ID_REUSED'});
 for(const connectionString of [config.appDatabaseUrl,config.jobs.workerDatabaseUrl]){
  const pool=new Pool({connectionString});try{
   await assert.rejects(configureProviders(pool,manifest(),options),{code:'CONFIGURATION_ADMINISTRATOR_REQUIRED'});
   await assert.rejects(pool.query('SELECT * FROM app.operator_configuration_changes'),{code:'42501'});
  }finally{await pool.end();}
 }
});
test('expiry-only drift invalidates a preview and exact database/business boundaries are required',async()=>{
 const m=manifest(),p=await configureProviders(admin,m,options);
 await admin.query("UPDATE app.analysis_grants SET expires_at=expires_at+interval '1 second' WHERE brand_id=$1",[brand]);
 await assert.rejects(configureProviders(admin,m,{...options,approval:p.preview_sha256}),{code:'CONFIGURATION_PREVIEW_STALE'});
 await assert.rejects(configureProviders(admin,m,{...options,expectedDatabase:'other'}),{code:'CONFIGURATION_DATABASE_MISMATCH'});
 await assert.rejects(configureProviders(admin,{...m,organization_id:randomUUID()},options),{code:'CONFIGURATION_BUSINESS_MISMATCH'});
 await assert.rejects(configureProviders(admin,m,{...options,mode:'production'}),{code:'CONFIGURATION_MODE_DENIED'});
});
test('all six AI grant kinds persist atomically, with explicit model and cost bounds',async()=>{
 const m=manifest(),common={enabled:false,expires_at:m.grants[0].expires_at,...rates};
 m.grants.push({kind:'creative',...common,text_model:'test-model',image_model:'test-image',quality:'low',max_image_request_micros:1000},{kind:'gemini_creative',...common,text_model:'gemini-test'},{kind:'planning',...common,provider:'openai',model:'test-model'},{kind:'insights',...common,provider:'gemini',model:'gemini-test'},{kind:'video',enabled:false,expires_at:common.expires_at,budget_micros:100000,models:['kling-video/v3.0/std/image-to-video'],max_create_micros:1000,max_edit_micros:1000});
 const p=await configureProviders(admin,m,options);assert.equal((await configureProviders(admin,m,{...options,approval:p.preview_sha256})).grants,6);
 for(const table of ['analysis_grants','creative_grants','gemini_creative_grants','planning_grants','insight_grants','video_grants'])assert.equal((await admin.query(`SELECT enabled FROM app.${table} WHERE brand_id=$1`,[brand])).rows[0].enabled,false);
});
test('unbound publishing accounts cannot receive permission and partial batches are not applied',async()=>{
 const m=manifest();m.grants[0].budget_micros=12345;
 m.grants.push({kind:'publishing',enabled:true,expires_at:m.grants[0].expires_at,channel_id:randomUUID(),remote_account_id:'exact-test-account',daily_limit:1});
 await assert.rejects(configureProviders(admin,m,options),{code:'CONFIGURATION_ACCOUNT_MISMATCH'});
 assert.equal((await admin.query('SELECT budget_micros FROM app.analysis_grants WHERE brand_id=$1',[brand])).rows[0].budget_micros,'100000');
});
test('exact verified social binding can be enabled and revoked; listing omits credentials',async()=>{
 const channel=randomUUID(),job=randomUUID(),remote=randomUUID();
 // Explicit local database identity fixture; no OAuth or live account claim.
 await admin.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,true,now())',[org,brand,randomUUID(),Buffer.alloc(64), 'a'.repeat(64)]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'social.sync','succeeded')",[job,org,brand,user]);
 await admin.query("INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) VALUES($1,$2,$3,$4,'linkedin','LOCAL TEST','available',now(),now(),1,$5)",[channel,org,brand,remote,job]);
 const m=manifest();m.grants=[{kind:'publishing',enabled:true,expires_at:m.grants[0].expires_at,channel_id:channel,remote_account_id:remote,daily_limit:1}];
 let p=await configureProviders(admin,m,options);await configureProviders(admin,m,{...options,approval:p.preview_sha256});
 const listing=await inspectConfiguration(admin,options);assert.ok(listing.businesses.some(b=>b.business_id===brand));assert.equal(JSON.stringify(listing).includes('credential'),false);
 const revoke={...m,change_id:randomUUID(),grants:[{...m.grants[0],enabled:false}]};p=await configureProviders(admin,revoke,options);await configureProviders(admin,revoke,{...options,approval:p.preview_sha256});
 assert.equal((await admin.query('SELECT expires_at FROM app.publication_grants WHERE brand_id=$1',[brand])).rows[0].expires_at.toISOString(),'1970-01-01T00:00:00.000Z');
 await admin.query('UPDATE app.postiz_accounts SET revision=2 WHERE brand_id=$1',[brand]);
 await assert.rejects(configureProviders(admin,{...m,change_id:randomUUID()},options),{code:'CONFIGURATION_ACCOUNT_MISMATCH'});
});
test('missing migration checksum prevents configuration without altering grants',async()=>{
 const name='039_operator_configuration.sql';
 const original=(await admin.query('SELECT sha256 FROM desvio_migrations.applied WHERE name=$1',[name])).rows[0].sha256;
 try{await admin.query('UPDATE desvio_migrations.applied SET sha256=$2 WHERE name=$1',[name,'0'.repeat(64)]);await assert.rejects(configureProviders(admin,manifest(),options),{code:'CONFIGURATION_SCHEMA_MISMATCH'});}
 finally{await admin.query('UPDATE desvio_migrations.applied SET sha256=$2 WHERE name=$1',[name,original]);}
});
