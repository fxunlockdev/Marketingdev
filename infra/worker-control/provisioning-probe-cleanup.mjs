import {Pool} from 'pg';import assert from 'node:assert/strict';import {Connection,Client} from '@temporalio/client';
let raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw);raw='';const db=new Pool({connectionString:input.admin_url,connectionTimeoutMillis:10000});let connection,transaction=false;
try{
 const r=input.result;assert.equal(r.passed,true);assert.equal(r.run_id,input.run_id);
 assert.equal((await db.query('select current_database() as name')).rows[0].name,input.database_name);
 connection=await Connection.connect({address:'desvio-dev-temporal.railway.internal:7233'});const client=new Client({connection,namespace:'desvio-dev'}),workflow=await client.workflow.getHandle('desvio-social-provision-'+r.job_id).describe();assert.equal(workflow.status.name,'COMPLETED');
 await db.query('BEGIN');transaction=true;
 const org=(await db.query('SELECT name,created_by FROM app.organizations WHERE id=$1 FOR UPDATE',[r.organization_id])).rows[0];assert.equal(org?.name,'Provision acceptance '+input.run_id);assert.equal(org.created_by,input.owner);
 const users=(await db.query('SELECT id,name,email FROM auth."user" WHERE id=ANY($1)',[[input.owner,input.foreign]])).rows;assert.equal(users.length,2);for(const u of users){assert.equal(u.name,'Desvio provision acceptance '+input.run_id);assert.equal(u.email,`${u.id}@desvio-probe.invalid`);}
 const jobs=(await db.query('SELECT id,status,kind FROM app.jobs WHERE organization_id=$1 FOR UPDATE',[r.organization_id])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].id,r.job_id);assert.equal(jobs[0].kind,'social.provision');assert.equal(jobs[0].status,'succeeded');
 const brands=(await db.query('SELECT id FROM app.brands WHERE organization_id=$1',[r.organization_id])).rows;assert.equal(brands.length,1);assert.equal(brands[0].id,r.brand_id);
 for(const table of ['social_channels','social_authorizations','assets'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM app.${table} WHERE organization_id=$1`,[r.organization_id])).rows[0].n,0);
 for(const table of ['social_provisioning','postiz_accounts','job_dispatch','jobs','audit_events','outbox','idempotency','business_memberships','brands','account_entitlements','personal_accounts','memberships'])await db.query(`DELETE FROM app.${table} WHERE organization_id=$1`,[r.organization_id]);
 await db.query('DELETE FROM app.organizations WHERE id=$1',[r.organization_id]);await db.query('DELETE FROM auth."user" WHERE id=ANY($1)',[[input.owner,input.foreign]]);await db.query('COMMIT');transaction=false;
 console.log(JSON.stringify({passed:true,run_id:input.run_id,fixture_rows_removed:true,workflow_status:workflow.status.name,postiz_synthetic_organization_retained:true}));
}catch{if(transaction)await db.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({passed:false,run_id:input.run_id,code:'PROVISIONING_CLEANUP_UNCONFIRMED'}));process.exitCode=1;}finally{await connection?.close();await db.end();}
