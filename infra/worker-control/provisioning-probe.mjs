// Runs in a disposable administrative acceptance container; never in customer services.
import {Pool} from 'pg';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {TenantDatabase} from './dist/database.js';import {Workspaces} from './dist/workspaces.js';import {Businesses} from './dist/businesses.js';import {SocialConnections} from './dist/social-connections.js';import {SocialProvisioning} from './dist/social-provisioning.js';
let raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw);raw='';
const admin=new Pool({connectionString:input.admin_url,connectionTimeoutMillis:10000}),pool=new Pool({connectionString:input.app_url,connectionTimeoutMillis:10000}),db=new TenantDatabase(pool),workspaces=new Workspaces(db),businesses=new Businesses(db,workspaces),connections=new SocialConnections(businesses,true,{provisioning:true,authorization:false}),provisioning=new SocialProvisioning(connections,true);
let stage='scope',org,brand,job;
try{
 assert.equal((await admin.query('select current_database() as name')).rows[0].name,input.database_name);await db.assertRuntimeRole();stage='fixture';
 for(const id of [input.owner,input.foreign])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',[id,'Desvio provision acceptance '+input.run_id,`${id}@desvio-probe.invalid`]);
 org=await workspaces.create(input.owner,{name:'Provision acceptance '+input.run_id});brand=await workspaces.createBrand(input.owner,org.id,{name:'Internal provisioning acceptance'},input.run_id);
 stage='submission';const first=await provisioning.prepare(input.owner,brand.id,input.run_id);job=first.job;assert.ok(job?.id);assert.equal((await provisioning.prepare(input.owner,brand.id,input.run_id)).job.id,job.id);
 await assert.rejects(provisioning.prepare(input.foreign,brand.id,input.run_id),e=>e.getStatus?.()===404);
 stage='worker';let state;for(let i=0;i<60;i++){state=await connections.read(input.owner,brand.id);if(!['queued','running','retrying'].includes(state.provisioning?.status))break;await delay(2000);}
 assert.equal(state.provisioning?.status,'succeeded',state.provisioning?.error_code??'not succeeded');assert.equal(state.configured,true);assert.equal(state.setup_status,'ready');assert.equal(state.channels.length,0);assert.equal(JSON.stringify(state).includes('encrypted_credential'),false);
 const account=(await admin.query('SELECT enabled,identity_verified_at,encrypted_credential,remote_organization_id FROM app.postiz_accounts WHERE organization_id=$1 AND brand_id=$2',[org.id,brand.id])).rows[0];assert.equal(account.enabled,true);assert.ok(account.identity_verified_at);assert.ok(account.encrypted_credential);assert.ok(account.remote_organization_id);
 assert.equal((await provisioning.prepare(input.owner,brand.id,input.run_id)).configured,true);await assert.rejects(connections.read(input.foreign,brand.id),e=>e.getStatus?.()===404);
 const dispatch=(await admin.query('SELECT dispatched_at FROM app.job_dispatch WHERE job_id=$1',[job.id])).rows;assert.equal(dispatch.length,1);assert.ok(dispatch[0].dispatched_at);
 console.log(JSON.stringify({passed:true,run_id:input.run_id,organization_id:org.id,brand_id:brand.id,job_id:job.id,job_status:state.provisioning.status,submission_replay:true,foreign_scope_denied:true,encrypted_binding:true,identity_verified:true,no_social_accounts:true,no_credentials_in_customer_result:true,fixture_retained:true}));
}catch(e){console.log(JSON.stringify({passed:false,stage,run_id:input.run_id,organization_id:org?.id,brand_id:brand?.id,job_id:job?.id,code:/^[A-Z_]+$/.test(e.code??'')?e.code:'PROVISIONING_ACCEPTANCE_FAILED',fixture_retained:true}));process.exitCode=1;}finally{await Promise.all([admin.end(),pool.end()]);}
