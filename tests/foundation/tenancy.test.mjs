import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { createApplication } from '../../dist/app.js';
import { configFromEnv } from '../../dist/config.js';
import { TenantDatabase } from '../../dist/database.js';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../../dist/auth.js';

const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
const admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
admin.on('error',()=>{});
let runtime, base, alice, bob, orgA, orgB, brandA;
async function request(path,{cookie,body,method='GET',origin=config.origin,key,headers={}}={}) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(origin?{origin}:{}),
    ...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers:response.headers};
}
async function signup(label) {
  const result=await request('/api/auth/sign-up/email',{method:'POST',body:{name:label,email:`${label}@example.test`,password:'a-strong-test-password-2026'}});
  assert.equal(result.status,200,JSON.stringify(result.body)); assert.ok(result.cookie);
  return {cookie:result.cookie,id:result.body.user.id,email:`${label}@example.test`};
}
async function createOrg(user,name) {
  const result=await request('/api/v1/workspaces',{method:'POST',cookie:user.cookie,body:{name}});
  assert.equal(result.status,201,JSON.stringify(result.body)); return result.body;
}
before(async()=>{
  runtime=await createApplication(config); await runtime.app.listen(0,'127.0.0.1'); base=await runtime.app.getUrl();
  alice=await signup('alice'); bob=await signup('bob');
  orgA=await createOrg(alice,'Client A'); orgB=await createOrg(bob,'Client B');
});
after(async()=>{await runtime?.close();await admin.end();});

test('actual sign-in sessions, client ownership and absence of forged-user access',async()=>{
  assert.equal((await request('/api/v1/workspaces')).status,401);
  assert.equal((await request('/api/v1/workspaces',{headers:{'x-user-id':alice.id}})).status,401);
  const list=await request('/api/v1/workspaces',{cookie:alice.cookie});
  assert.deepEqual(list.body.workspaces,[{id:orgA.id,name:'Client A',role:'owner'}]);
  assert.equal((await request(`/api/v1/workspaces/${orgB.id}/brands`,{cookie:alice.cookie})).status,404);
  const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email:alice.email,password:'a-strong-test-password-2026'}});
  assert.equal(login.status,200);assert.ok(login.cookie);
});

test('strict mutation origin and malformed input checks',async()=>{
  for (const origin of [null,'https://attacker.example',`${config.origin}.attacker.example`]) {
    assert.equal((await request('/api/v1/workspaces',{cookie:alice.cookie,method:'POST',body:{name:'bad'},origin})).status,403);
  }
  assert.equal((await request('/api/v1/workspaces',{cookie:alice.cookie,method:'POST',body:{name:'bad',userId:bob.id}})).status,400);
  assert.equal((await request('/api/v1/workspaces/not-a-uuid/brands',{cookie:alice.cookie})).status,400);
  for (const path of ['/api/v1/workspaces','/api/auth/sign-up/email']) {
    assert.equal((await request(path,{cookie:alice.cookie,method:'POST',body:{name:'x'.repeat(40000)}})).status,413);
    const malformed=await fetch(base+path,{method:'POST',headers:{origin:config.origin,'content-type':'application/json',cookie:alice.cookie},body:'{'});
    assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'Invalid request body');
  }
});

test('failed outbox insert rolls back brand, audit and idempotency together',async()=>{
  await admin.query(`CREATE FUNCTION app.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END $$;
    CREATE TRIGGER test_outbox_failure BEFORE INSERT ON app.outbox FOR EACH ROW EXECUTE FUNCTION app.test_fail_outbox();`);
  const key=randomUUID(), path=`/api/v1/workspaces/${orgB.id}/brands`;
  try {
    const failed=await request(path,{method:'POST',cookie:bob.cookie,key,body:{name:'Recovery brand'}});
    assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed.body).includes('test-only failure'));
    const count=await admin.query('SELECT count(*)::int AS count FROM app.brands WHERE organization_id=$1',[orgB.id]);
    assert.equal(count.rows[0].count,0);
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM app.idempotency WHERE organization_id=$1',[orgB.id])).rows[0].count,0);
  } finally {await admin.query('DROP TRIGGER test_outbox_failure ON app.outbox; DROP FUNCTION app.test_fail_outbox()');}
  const recovered=await request(path,{method:'POST',cookie:bob.cookie,key,body:{name:'Recovery brand'}});assert.equal(recovered.status,201);
});

test('concurrent retries create one persisted brand, audit and outbox entry',async()=>{
  const path=`/api/v1/workspaces/${orgA.id}/brands`, key=randomUUID();
  const responses=await Promise.all(Array.from({length:6},()=>request(path,{method:'POST',cookie:alice.cookie,key,body:{name:'Acme',website:'https://example.test'}})));
  responses.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));
  assert.equal(new Set(responses.map(r=>r.body.id)).size,1);brandA=responses[0].body;
  const {rows:[counts]}=await admin.query(`SELECT
    (SELECT count(*)::int FROM app.brands WHERE organization_id=$1) brands,
    (SELECT count(*)::int FROM app.audit_events WHERE organization_id=$1 AND action='brand.created') audit,
    (SELECT count(*)::int FROM app.outbox WHERE organization_id=$1) outbox`,[orgA.id]);
  assert.deepEqual(counts,{brands:1,audit:1,outbox:1});
  assert.equal((await request(path,{method:'POST',cookie:alice.cookie,key,body:{name:'different'}})).status,409);
});

test('cross-client IDs fail for reads, edits and writes even with forged organization headers',async()=>{
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands/${brandA.id}`,{cookie:bob.cookie,headers:{'x-organization-id':orgA.id}})).status,404);
  assert.equal((await request(`/api/v1/workspaces/${orgB.id}/brands/${brandA.id}`,{cookie:bob.cookie})).status,404);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands/${brandA.id}`,{cookie:bob.cookie,method:'PATCH',body:{name:'attack',revision:1}})).status,404);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:bob.cookie,method:'POST',key:randomUUID(),body:{name:'attack'}})).status,404);
});

test('multiple brands share a workspace but a brand-scoped transaction cannot read its sibling',async()=>{
  const sibling=await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:alice.cookie,method:'POST',key:randomUUID(),body:{name:'Sibling'}});
  assert.equal(sibling.status,201);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:alice.cookie})).body.brands.length,2);
  await runtime.database.transaction(alice.id,orgA.id,false,async db=>{
    assert.deepEqual((await db.query('SELECT id FROM app.brands')).rows,[{id:brandA.id}]);
    const {rows}=await db.query('SELECT brand_id FROM app.audit_events');
    assert.ok(rows.length>0);assert.ok(rows.every(r=>r.brand_id===brandA.id));
  },brandA.id);
});

test('optimistic revisions reject stale saves and persist the accepted edit',async()=>{
  const path=`/api/v1/workspaces/${orgA.id}/brands/${brandA.id}`;
  const saved=await request(path,{cookie:alice.cookie,method:'PATCH',body:{name:'Acme revised',website:'https://example.test/revised',revision:1}});
  assert.equal(saved.status,200);assert.equal(saved.body.revision,2);
  assert.equal((await request(path,{cookie:alice.cookie,method:'PATCH',body:{name:'stale',revision:1}})).status,409);
  assert.equal((await request(path,{cookie:alice.cookie})).body.name,'Acme revised');
  const partial=await request(path,{cookie:alice.cookie,method:'PATCH',body:{name:'Acme revised',revision:2}});
  assert.equal(partial.status,200);assert.equal(partial.body.website,'https://example.test/revised');
  const cleared=await request(path,{cookie:alice.cookie,method:'PATCH',body:{website:null,revision:3}});
  assert.equal(cleared.status,200);assert.equal(cleared.body.name,'Acme revised');assert.equal(cleared.body.website,null);
});

test('database RLS and least privileges prevent foreign access without application predicates',async()=>{
  const db=await runtime.database.pool.connect();
  try {
    assert.equal((await db.query('SELECT * FROM app.brands')).rows.length,0);
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)`,[bob.id,orgA.id]);
    assert.equal((await db.query('SELECT * FROM app.brands')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM app.audit_events')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM app.outbox')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM app.idempotency')).rows.length,0);
    await assert.rejects(db.query(`INSERT INTO app.brands(organization_id,name) VALUES($1,'foreign')`,[orgA.id]),e=>e.code==='42501');
    await db.query('ROLLBACK');
    await assert.rejects(db.query('SELECT * FROM auth.session'),e=>e.code==='42501');
    await assert.rejects(db.query('SET ROLE desvio_bootstrap'),e=>e.code==='42501');
    await assert.rejects(db.query(`UPDATE app.memberships SET role='owner'`),e=>e.code==='42501');
    assert.equal((await db.query('SELECT * FROM app.brands')).rows.length,0);
    const tables=await admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND relkind='r'`);
    assert.ok(tables.rows.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
  } finally {await db.query('ROLLBACK');db.release();}
});

test('viewer role and revoked membership are enforced on every request',async()=>{
  await admin.query(`INSERT INTO app.memberships VALUES($1,$2,'viewer',true)`,[orgA.id,bob.id]);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:bob.cookie})).status,200);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:bob.cookie,method:'POST',key:randomUUID(),body:{name:'no'}})).status,403);
  await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[orgA.id,bob.id]);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:bob.cookie})).status,404);
});

test('revoked session cannot access saved work and survives API restart with a new sign-in',async()=>{
  const out=await request('/api/auth/sign-out',{method:'POST',body:{},cookie:alice.cookie});assert.equal(out.status,200);
  assert.equal((await request('/api/v1/workspaces',{cookie:alice.cookie})).status,401);
  const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email:alice.email,password:'a-strong-test-password-2026'}});
  assert.equal(login.status,200);alice.cookie=login.cookie;
  await runtime.close(); runtime=await createApplication(config);await runtime.app.listen(0,'127.0.0.1');base=await runtime.app.getUrl();
  const loaded=await request(`/api/v1/workspaces/${orgA.id}/brands/${brandA.id}`,{cookie:alice.cookie});
  assert.equal(loaded.status,200);assert.equal(loaded.body.name,'Acme revised');
});

test('auth migration matches pinned SDK and runtime refuses privileged database credentials',async()=>{
  const schemaPool=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL,options:'-c search_path=auth'});
  try {
    const plan=await getMigrations(authOptions(schemaPool,config));
    assert.deepEqual(plan.toBeCreated,[]);assert.deepEqual(plan.toBeAdded,[]);assert.deepEqual(plan.schemaProblems,[]);
  } finally {await schemaPool.end();}
  const database=new TenantDatabase(admin);await assert.rejects(database.assertRuntimeRole(),/Unsafe/);
  assert.throws(()=>configFromEnv({APP_MODE:'production',APP_ORIGIN:'https://desvio.example',AUTH_SECRET:'x'.repeat(32)}),/External auth launch blocked/);
});

test('expired session, tampered cookie and wrong password are rejected; passwords are hashed',async()=>{
  const charlie=await signup('charlie');
  await admin.query('UPDATE auth.session SET "expiresAt"=now()-interval \'1 hour\' WHERE "userId"=$1',[charlie.id]);
  assert.equal((await request('/api/v1/workspaces',{cookie:charlie.cookie})).status,401);
  assert.equal((await request('/api/v1/workspaces',{cookie:alice.cookie+'tampered'})).status,401);
  assert.equal((await request('/api/auth/sign-in/email',{method:'POST',body:{email:alice.email,password:'wrong-password-value'}})).status,401);
  const {rows:[account]}=await admin.query('SELECT password FROM auth.account WHERE "userId"=$1',[alice.id]);
  assert.ok(account.password);assert.notEqual(account.password,'a-strong-test-password-2026');
});

test('authentication rate limit cannot be bypassed by spoofing proxy/IP headers',async()=>{
  await admin.query('DELETE FROM auth."rateLimit"');
  let throttled=false;
  for(let i=0;i<15;i++) {
    const response=await request('/api/auth/sign-in/email',{method:'POST',body:{email:'absent@example.test',password:'bad-but-long-password'},
      headers:{'x-forwarded-for':`192.0.2.${i+1}`,'x-desvio-peer-ip':`192.0.2.${i+1}`}});
    if(response.status===429) {throttled=true;break;}
    assert.equal(response.status,401);
  }
  assert.ok(throttled,'database-backed auth rate limit must reject attempts');
});

test('database restart preserves sessions and edits and pooled connections recover',async()=>{
  const container=process.env.DESVIO_TEST_CONTAINER;
  assert.match(container,/^desvio-foundation-[0-9a-f-]+$/);
  const exec=promisify(execFile);
  const {stdout:label}=await exec('docker',['inspect','--format','{{index .Config.Labels "desvio.purpose"}}',container]);
  assert.equal(label.trim(),'isolated-test');
  const {stdout:portBefore}=await exec('docker',['port',container,'5432/tcp']);
  await exec('docker',['restart','--time','1',container],{timeout:30000});
  const {stdout:portAfter}=await exec('docker',['port',container,'5432/tcp']);assert.equal(portBefore,portAfter);
  let loaded;
  for(let i=0;i<50;i++) {
    loaded=await request(`/api/v1/workspaces/${orgA.id}/brands/${brandA.id}`,{cookie:alice.cookie});
    if(loaded.status===200) break;
    assert.equal(loaded.status,503);await setTimeout(200);
  }
  assert.equal(loaded.status,200);assert.equal(loaded.body.name,'Acme revised');
});
