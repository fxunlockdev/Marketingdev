import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrate} from '../../scripts/migrate.mjs';

test('database dump restores tenant data, policies and migration history into a separate database', {timeout:180000}, async()=>{
 const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
 const container=process.env.DESVIO_TEST_CONTAINER;
 assert.equal(config.mode,'test');
 assert.match(container,/^desvio-foundation-[0-9a-f-]{36}$/);
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']});
 assert.equal(docker('inspect','--format','{{index .Config.Labels "desvio.purpose"}}',container).trim(),'isolated-test');
 const originalUrl=new URL(process.env.DESVIO_TEST_ADMIN_URL);
 assert.equal(originalUrl.hostname,'127.0.0.1');
 const admin=new Pool({connectionString:originalUrl.href});
 const target=`recovery_${randomUUID().replaceAll('-','')}`;
 const targetUrl=new URL(originalUrl);targetUrl.pathname='/'+target;
 let restored,app;
 const report={passed:false,scope:'Disposable local logical database restore; not hosted backup, PITR, role recovery or object storage recovery',tenants:2};
 try {
  const tenants=[];
  for(let i=0;i<2;i++){
   const user=randomUUID(),org=randomUUID(),brand=randomUUID();tenants.push({user,org,brand});
   await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[user,`Recovery ${i}`,`recovery-${i}@example.test`]);
   await admin.query('INSERT INTO app.organizations(id,name,created_by) VALUES($1,$2,$3)',[org,`Recovery ${i}`,user]);
   await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[org,user]);
   await admin.query('INSERT INTO app.brands(id,organization_id,name) VALUES($1,$2,$3)',[brand,org,`Restored brand ${i}`]);
  }
  const before=(await admin.query('SELECT name,sha256 FROM desvio_migrations.applied ORDER BY name')).rows;
  const policies=(await admin.query("SELECT * FROM pg_policies WHERE schemaname IN ('app','auth') ORDER BY schemaname,tablename,policyname")).rows;
  const started=performance.now();
  docker('exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom','--file=/tmp/recovery.dump');
  // Mutate only the disposable source after the snapshot, proving restore uses
  // the archive rather than reading the still-running source database.
  await admin.query('UPDATE app.brands SET name=$1 WHERE id=$2',['Changed after backup',tenants[0].brand]);
  await admin.query(`CREATE DATABASE ${target} TEMPLATE template0`);
  docker('exec',container,'pg_restore','-U','postgres','--dbname='+target,'--exit-on-error','--single-transaction','/tmp/recovery.dump');
  report.dump_and_restore_ms=Math.round(performance.now()-started);
  restored=new Pool({connectionString:targetUrl.href});
  assert.deepEqual((await restored.query('SELECT name,sha256 FROM desvio_migrations.applied ORDER BY name')).rows,before);
  assert.deepEqual((await restored.query("SELECT * FROM pg_policies WHERE schemaname IN ('app','auth') ORDER BY schemaname,tablename,policyname")).rows,policies);
  await migrate(restored); // Restored migration checksums must remain replayable.
  const appUrl=new URL(config.appDatabaseUrl);appUrl.pathname='/'+target;
  app=new Pool({connectionString:appUrl.href});
  const client=await app.connect();
  try {
   assert.equal((await client.query('SELECT * FROM app.brands')).rowCount,0);
   for(const [i,t] of tenants.entries()){
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true),set_config('app.brand_id',$3,true)",[t.user,t.org,t.brand]);
    assert.deepEqual((await client.query('SELECT id,name FROM app.brands')).rows,[{id:t.brand,name:`Restored brand ${i}`}]);
    assert.equal((await client.query('SELECT id FROM app.brands WHERE id=$1',[tenants[1-i].brand])).rowCount,0);
    assert.equal((await client.query('UPDATE app.brands SET name=$1 WHERE id=$2 RETURNING id',['Forbidden',tenants[1-i].brand])).rowCount,0);
    await client.query('ROLLBACK');
   }
   await assert.rejects(client.query('SELECT * FROM auth."user"'),{code:'42501'});
  } finally {await client.query('ROLLBACK');client.release();}
  assert.equal((await admin.query('SELECT name FROM app.brands WHERE id=$1',[tenants[0].brand])).rows[0].name,'Changed after backup');
  report.migrations=before.length;report.policies=policies.length;report.passed=true;
 } finally {
  await app?.end();await restored?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);await admin.end();
  await writeFile('work/recovery-measurements.json',JSON.stringify(report,null,2)+'\n');
 }
});
