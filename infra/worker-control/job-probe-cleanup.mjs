// Delete only a completed, positively identified administrative acceptance fixture.
import {Pool} from 'pg';import assert from 'node:assert/strict';import {Connection,Client} from '@temporalio/client';import {ObjectStore} from './dist/object-store.js';
let raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw);raw='';
const db=new Pool({connectionString:input.admin_url,connectionTimeoutMillis:10000}),store=new ObjectStore(input.storage);let connection,transaction=false;
try{
 const r=input.result;assert.equal(r.passed,true);assert.equal(r.run_id,input.run_id);
 connection=await Connection.connect({address:'desvio-dev-temporal.railway.internal:7233'});const client=new Client({connection,namespace:'desvio-dev'}),workflow=await client.workflow.getHandle('desvio-asset-'+r.job_id).describe();assert.equal(workflow.status.name,'COMPLETED');
 await db.query('BEGIN');transaction=true;
 const org=(await db.query('SELECT name,created_by FROM app.organizations WHERE id=$1 FOR UPDATE',[r.organization_id])).rows[0];assert.equal(org?.created_by,input.owner);assert.equal(org.name,'Dev acceptance '+input.run_id);
 const users=(await db.query('SELECT id,email,name FROM auth."user" WHERE id=ANY($1)',[[input.owner,input.foreign]])).rows;assert.equal(users.length,2);for(const u of users){assert.equal(u.email,`${u.id}@desvio-probe.invalid`);assert.equal(u.name,'Desvio dev acceptance '+input.run_id);}
 const jobs=(await db.query('SELECT id,status FROM app.jobs WHERE organization_id=$1 FOR UPDATE',[r.organization_id])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].id,r.job_id);assert.equal(jobs[0].status,'succeeded');
 const assets=(await db.query('SELECT id,brand_id,quarantine_key,canonical_key FROM app.assets WHERE organization_id=$1',[r.organization_id])).rows;assert.equal(assets.length,1);assert.equal(assets[0].id,r.asset_id);assert.equal(assets[0].brand_id,r.brand_id);
 const visuals=(await db.query('SELECT object_key FROM app.uploaded_visuals WHERE organization_id=$1',[r.organization_id])).rows;assert.equal(visuals.length,1);
 const keys=[assets[0].quarantine_key,assets[0].canonical_key,...visuals.map(v=>v.object_key)];
 for(const key of keys){assert.ok(key.includes(`/${r.organization_id}/${r.brand_id}/`));await store.removeQuarantine(key);await assert.rejects(store.read(key),e=>e?.$metadata?.httpStatusCode===404);}
 // Fixed table list, exact probe organization, no cascading or broad cleanup.
 for(const table of ['uploaded_visuals','job_dispatch','jobs','assets','audit_events','outbox','idempotency','business_memberships','brands','account_entitlements','personal_accounts','memberships'])await db.query(`DELETE FROM app.${table} WHERE organization_id=$1`,[r.organization_id]);
 await db.query('DELETE FROM app.organizations WHERE id=$1',[r.organization_id]);await db.query('DELETE FROM auth."user" WHERE id=ANY($1)',[[input.owner,input.foreign]]);
 await db.query('COMMIT');transaction=false;
 console.log(JSON.stringify({passed:true,run_id:input.run_id,objects_removed:keys.length,fixture_rows_removed:true,workflow_status:workflow.status.name,workflow_history_retained:true}));
}catch{if(transaction)await db.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({passed:false,run_id:input.run_id,code:'FIXTURE_CLEANUP_UNCONFIRMED'}));process.exitCode=1;}
finally{store.close();await connection?.close();await db.end();}
