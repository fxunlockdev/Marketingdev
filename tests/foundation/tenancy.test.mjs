import { test, before, after, beforeEach } from 'node:test';
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
import { MailQueue } from '../../dist/mail.js';
import { startMailbox,messageLink } from './smtp.mjs';

const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
const admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
admin.on('error',()=>{});
let runtime, base, alice, bob, orgA, orgB, brandA,smtp;
async function request(path,{cookie,body,method='GET',origin=config.origin,key,headers={}}={}) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(origin?{origin}:{}),
    ...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers:response.headers};
}
async function signup(label) {
  const result=await request('/api/auth/sign-up/email',{method:'POST',body:{name:label,email:`${label}@example.test`,password:'a-strong-test-password-2026'}});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.cookie,'');
  await drainMail();
  const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===`${label}@example.test` && m.subject==='Verify your Desvio email'));
  const verified=await fetch(base+link.pathname+link.search,{redirect:'manual'});assert.ok([200,302].includes(verified.status));
  const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email:`${label}@example.test`,password:'a-strong-test-password-2026'}});
  assert.equal(login.status,200);assert.ok(login.cookie);
  return {cookie:login.cookie,id:result.body.user.id,email:`${label}@example.test`};
}
async function drainMail() {for(let i=0;i<30;i++){if(!await runtime.mailWorker.runOnce()) return;}throw new Error('Unexpected email queue size');}
async function createOrg(user,name) {
  const result=await request('/api/v1/workspaces',{method:'POST',cookie:user.cookie,body:{name}});
  assert.equal(result.status,201,JSON.stringify(result.body)); return result.body;
}
before(async()=>{
  smtp=await startMailbox();config.smtp.port=smtp.port;
  runtime=await createApplication(config); await runtime.app.listen(0,'127.0.0.1'); base=await runtime.app.getUrl();
  alice=await signup('alice'); bob=await signup('bob');
  orgA=await createOrg(alice,'Client A'); orgB=await createOrg(bob,'Client B');
});
beforeEach(async()=>{await admin.query('DELETE FROM auth."rateLimit"');});
after(async()=>{await runtime?.close();await admin.end();await smtp?.close();});

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
  assert.throws(()=>configFromEnv({APP_MODE:'production',APP_ORIGIN:'https://desvio.example',AUTH_SECRET:'x'.repeat(32)}),/Production launch blocked/);
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

test('verification is required and queued emails keep links/recipients encrypted at rest',async()=>{
  const email='not-yet-verified@example.test';
  const created=await request('/api/auth/sign-up/email',{method:'POST',body:{name:'Not yet verified',email,password:'a-strong-test-password-2026'}});
  assert.equal(created.status,200);assert.equal(created.cookie,'');assert.equal(created.body.user.emailVerified,false);
  assert.equal((await request('/api/auth/sign-in/email',{method:'POST',body:{email,password:'a-strong-test-password-2026'}})).status,403);
  const {rows:[queued]}=await admin.query(`SELECT * FROM delivery.outbox WHERE kind='verify' AND status='pending' ORDER BY created_at DESC LIMIT 1`);
  assert.ok(queued.encrypted_payload);assert.equal(queued.encrypted_payload.includes(Buffer.from(email)),false);
  await drainMail();
  const message=smtp.messages.findLast(m=>m.to.value[0].address===email),url=messageLink(message);
  assert.equal(url.origin,config.origin);
  const verified=await fetch(base+url.pathname+url.search,{redirect:'manual'});assert.ok([200,302].includes(verified.status));
  const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email,password:'a-strong-test-password-2026'}});
  assert.equal(login.status,200);assert.equal(login.body.user.emailVerified,true);
  const {rows:[sent]}=await admin.query('SELECT status,encrypted_payload FROM delivery.outbox WHERE id=$1',[queued.id]);
  assert.equal(sent.status,'accepted');assert.equal(sent.encrypted_payload,null);
});

test('password recovery hides account existence, rejects external redirects and revokes all sessions atomically',async()=>{
  const user=await signup('recovery');
  const requestReset=email=>request('/api/auth/request-password-reset',{method:'POST',body:{email,redirectTo:config.origin+'/reset-password'}});
  const absent=await requestReset('missing@example.test'),present=await requestReset(user.email);
  assert.equal(present.status,200);assert.deepEqual(absent.body,present.body);
  assert.equal((await request('/api/auth/request-password-reset',{method:'POST',body:{email:user.email,redirectTo:'https://attacker.example/'}})).status,403);
  await drainMail();
  const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===user.email&&m.subject==='Reset your Desvio password'));
  const token=link.pathname.split('/').at(-1);
  // Inject a real DB failure during session revocation. Password/token must roll back together.
  await admin.query(`CREATE FUNCTION auth.test_revoke_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$;
    CREATE TRIGGER test_revoke_failure BEFORE DELETE ON auth.session FOR EACH ROW EXECUTE FUNCTION auth.test_revoke_failure();`);
  const errors=[],originalError=console.error;console.error=(...args)=>errors.push(args);
  try {
    const failed=await request('/api/auth/reset-password',{method:'POST',body:{token,newPassword:'new-strong-password-2026'}});
    assert.equal(failed.status,503);assert.equal(failed.body.error,'Account service is temporarily unavailable. Please try again.');
    assert.equal((await request('/api/v1/workspaces',{cookie:user.cookie})).status,200);
    assert.equal(errors.length,0,'Private database errors must not be printed');
  } finally {console.error=originalError;await admin.query('DROP TRIGGER test_revoke_failure ON auth.session;DROP FUNCTION auth.test_revoke_failure()');}
  const results=await Promise.all([1,2].map(()=>request('/api/auth/reset-password',{method:'POST',body:{token,newPassword:'new-strong-password-2026'}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  assert.equal((await request('/api/v1/workspaces',{cookie:user.cookie})).status,401);
  assert.equal((await request('/api/auth/sign-in/email',{method:'POST',body:{email:user.email,password:'a-strong-test-password-2026'}})).status,401);
  assert.equal((await request('/api/auth/sign-in/email',{method:'POST',body:{email:user.email,password:'new-strong-password-2026'}})).status,200);
  assert.equal((await request('/api/auth/reset-password',{method:'POST',body:{token,newPassword:'another-strong-password'}})).status,400);
});

test('expired recovery tokens and untrusted verification callbacks cannot change the account',async()=>{
  const user=await signup('expired-recovery');
  const reset=await request('/api/auth/request-password-reset',{method:'POST',body:{email:user.email,redirectTo:config.origin+'/reset-password'}});assert.equal(reset.status,200);
  await drainMail();
  const token=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===user.email&&m.subject==='Reset your Desvio password')).pathname.split('/').at(-1);
  await admin.query('UPDATE auth.verification SET "expiresAt"=now()-interval \'1 second\' WHERE value=$1',[user.id]);
  assert.equal((await request('/api/auth/reset-password',{method:'POST',body:{token,newPassword:'another-long-password'}})).status,400);
  const malicious=await request('/api/auth/send-verification-email',{method:'POST',body:{email:user.email,callbackURL:'https://attacker.example'}});
  assert.equal(malicious.status,403);
});

async function invite(user,org,email,role='viewer',requestKey=randomUUID()) {
  const result=await request(`/api/v1/workspaces/${org}/invitations`,{method:'POST',cookie:user.cookie,key:requestKey,body:{email,role}});
  assert.equal(result.status,201,JSON.stringify(result.body));await drainMail();
  const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===email&&m.subject==='Your Desvio client invitation'));
  return {...result.body,token:new URLSearchParams(link.hash.slice(1)).get('token')};
}
test('invitations are scoped, idempotent, recipient-bound and accept once without duplicate membership/audit',async()=>{
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/members`,{cookie:bob.cookie})).status,404);
  const path=`/api/v1/workspaces/${orgA.id}/invitations`,key=randomUUID();
  const responses=await Promise.all([1,2,3].map(()=>request(path,{method:'POST',cookie:alice.cookie,key,body:{email:bob.email,role:'viewer'}})));
  responses.forEach(r=>assert.equal(r.status,201));assert.equal(new Set(responses.map(r=>r.body.id)).size,1);
  assert.ok(!Object.hasOwn(responses[0].body,'token'));
  await drainMail();
  const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===bob.email&&m.subject==='Your Desvio client invitation'));
  const token=new URLSearchParams(link.hash.slice(1)).get('token');
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:alice.cookie,body:{token}})).status,404);
  const accepted=await Promise.all([1,2].map(()=>request('/api/v1/invitations/accept',{method:'POST',cookie:bob.cookie,body:{token}})));
  accepted.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));
  assert.equal((await request('/api/v1/workspaces',{cookie:bob.cookie})).body.workspaces.length,2);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:bob.cookie,method:'POST',key:randomUUID(),body:{name:'not allowed'}})).status,403);
  const {rows:[count]}=await admin.query(`SELECT count(*)::int AS count FROM app.audit_events WHERE resource_id=$1 AND action='invitation.accepted'`,[responses[0].body.id]);assert.equal(count.count,1);
  assert.equal((await request(path,{method:'POST',cookie:alice.cookie,key,body:{email:bob.email,role:'editor'}})).status,409);
  assert.equal((await request(`/api/v1/workspaces/${orgB.id}/invitations`,{cookie:alice.cookie})).status,404);
});

test('revoked, expired and sender-deauthorized invitations cannot grant access',async()=>{
  const recipient=await signup('invited-later');
  const revoked=await invite(alice,orgA.id,recipient.email);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/invitations/${revoked.id}/revoke`,{method:'POST',cookie:alice.cookie,body:{}})).status,201);
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:revoked.token}})).status,404);
  const expired=await invite(alice,orgA.id,recipient.email);
  await admin.query('UPDATE app.invitations SET expires_at=now()-interval \'1 second\' WHERE id=$1',[expired.id]);
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:expired.token}})).status,404);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/members/${bob.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'admin',active:true}})).status,200);
  const fromAdmin=await invite(bob,orgA.id,recipient.email,'editor');
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/members/${bob.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'viewer',active:true}})).status,200);
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:fromAdmin.token}})).status,404);
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/brands`,{cookie:recipient.cookie})).status,404);
});

test('replacing an invitation invalidates its older grant and cancels queued mail',async()=>{
  const recipient=await signup('replacement');const path=`/api/v1/workspaces/${orgA.id}/invitations`;
  const first=await request(path,{method:'POST',cookie:alice.cookie,key:randomUUID(),body:{email:recipient.email,role:'editor'}});assert.equal(first.status,201);
  const {rows:[queued]}=await admin.query('SELECT m.* FROM delivery.outbox m JOIN app.invitations i ON i.mail_id=m.id WHERE i.id=$1',[first.body.id]);
  const mail=new MailQueue(config.origin,config.mailEncryptionKey),payload=mail.decrypt(queued);
  const oldToken=new URLSearchParams(new URL(payload.url).hash.slice(1)).get('token');
  const second=await invite(alice,orgA.id,recipient.email,'viewer');
  assert.equal((await admin.query('SELECT status FROM delivery.outbox WHERE id=$1',[queued.id])).rows[0].status,'canceled');
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:oldToken}})).status,404);
  const accepted=await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:second.token}});
  assert.equal(accepted.status,201);assert.equal(accepted.body.role,'viewer');
  assert.equal((await request(`/api/v1/workspaces/${orgA.id}/members/${recipient.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'viewer',active:false}})).status,200);
  assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:recipient.cookie,body:{token:second.token}})).status,404);
});

test('team management denies escalation, rejects foreign members and preserves the last owner under races',async()=>{
  const path=`/api/v1/workspaces/${orgA.id}`;
  assert.equal((await request(`${path}/members/${alice.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'viewer',active:true}})).status,409);
  assert.equal((await request(`${path}/members/${bob.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'admin',active:true}})).status,200);
  assert.equal((await request(`${path}/invitations`,{method:'POST',cookie:bob.cookie,key:randomUUID(),body:{email:'new-admin@example.test',role:'admin'}})).status,403);
  assert.equal((await request(`${path}/members/${bob.id}`,{method:'PATCH',cookie:bob.cookie,body:{role:'owner',active:true}})).status,403);
  assert.equal((await request(`/api/v1/workspaces/${orgB.id}/members/${bob.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'viewer',active:false}})).status,404);
  assert.equal((await request(`${path}/members/${bob.id}`,{method:'PATCH',cookie:alice.cookie,body:{role:'owner',active:true}})).status,200);
  const changes=await Promise.all([alice,bob].map(user=>request(`${path}/members/${user.id}`,{method:'PATCH',cookie:user.cookie,body:{role:'viewer',active:true}})));
  assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  const {rows:[owners]}=await admin.query(`SELECT count(*)::int AS count FROM app.memberships WHERE organization_id=$1 AND role='owner' AND active`,[orgA.id]);assert.equal(owners.count,1);
});

test('SMTP temporary/permanent failures and lost acknowledgements preserve honest durable status',async()=>{
  const queue=new MailQueue(config.origin,config.mailEncryptionKey);
  const enqueue=()=>queue.enqueue(admin,'verify',{to:'mail-errors@example.test',url:config.origin+'/verify?test='+randomUUID()},new Date(Date.now()+60000));
  try {
    smtp.setBehavior('temporary');const id=await enqueue();
    assert.deepEqual(await runtime.mailWorker.runOnce(),{id,status:'retry'});
    assert.equal(await runtime.mailWorker.runOnce(),null);
    await admin.query('UPDATE delivery.outbox SET available_at=now() WHERE id=$1',[id]);smtp.setBehavior('accept');
    assert.deepEqual(await runtime.mailWorker.runOnce(),{id,status:'accepted'});
    smtp.setBehavior('permanent');const failed=await enqueue();assert.deepEqual(await runtime.mailWorker.runOnce(),{id:failed,status:'failed'});
    smtp.setBehavior('drop-after-data');const ambiguous=await enqueue();const before=smtp.messages.length;
    assert.deepEqual(await runtime.mailWorker.runOnce(),{id:ambiguous,status:'unknown'});
    assert.equal(smtp.messages.length,before+1);assert.equal(await runtime.mailWorker.runOnce(),null);
    const {rows:[row]}=await admin.query('SELECT status,attempts,error_code FROM delivery.outbox WHERE id=$1',[ambiguous]);
    assert.deepEqual(row,{status:'unknown',attempts:1,error_code:'SMTP_OUTCOME_UNKNOWN'});
  } finally {smtp.setBehavior('accept');}
});

test('concurrent invitations cannot exceed the workspace daily cap',async()=>{
  const org=await createOrg(alice,'Invitation quota');
  await admin.query(`WITH seeded AS (
    INSERT INTO delivery.outbox(id,kind,organization_id,actor_id,dedupe_key,status,expires_at)
    SELECT gen_random_uuid(),'invite',$1,$2,gen_random_uuid()::text,'expired',now()-interval '1 day' FROM generate_series(1,99) RETURNING id
  ) INSERT INTO app.invitations(id,organization_id,email,role,invited_by,token_hash,status,expires_at,mail_id)
    SELECT gen_random_uuid(),$1,'seed@example.test','viewer',$2,gen_random_uuid()::text,'revoked',now()-interval '1 day',id FROM seeded`,[org.id,alice.id]);
  const results=await Promise.all([1,2].map(n=>request(`/api/v1/workspaces/${org.id}/invitations`,{
    method:'POST',cookie:alice.cookie,key:randomUUID(),body:{email:`quota-${n}@example.test`,role:'viewer'}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM app.invitations WHERE organization_id=$1',[org.id])).rows[0].count,100);
  await drainMail();
});

test('concurrent email workers, corrupt ciphertext, expired mail and interrupted workers do not duplicate delivery',async()=>{
  const queue=new MailQueue(config.origin,config.mailEncryptionKey);
  const enqueue=expires=>queue.enqueue(admin,'verify',{to:'queue-tests@example.test',url:config.origin+'/verify?test='+randomUUID()},expires);
  const id=await enqueue(new Date(Date.now()+60000)),before=smtp.messages.length;
  const attempts=await Promise.all([1,2,3].map(()=>runtime.mailWorker.runOnce()));
  assert.equal(attempts.filter(Boolean).length,1);assert.equal(smtp.messages.length,before+1);
  const corrupt=await enqueue(new Date(Date.now()+60000));
  await admin.query('UPDATE delivery.outbox SET encrypted_payload=$2 WHERE id=$1',[corrupt,Buffer.alloc(60)]);
  assert.deepEqual(await runtime.mailWorker.runOnce(),{id:corrupt,status:'failed'});
  const expired=await enqueue(new Date(Date.now()-1000));assert.equal(await runtime.mailWorker.runOnce(),null);
  assert.equal((await admin.query('SELECT status FROM delivery.outbox WHERE id=$1',[expired])).rows[0].status,'expired');
  const interrupted=await enqueue(new Date(Date.now()+60000));
  await admin.query(`UPDATE delivery.outbox SET status='processing',leased_until=now()-interval '1 second',lease_id=$2 WHERE id=$1`,[interrupted,randomUUID()]);
  assert.equal(await runtime.mailWorker.runOnce(),null);
  assert.equal((await admin.query('SELECT status FROM delivery.outbox WHERE id=$1',[interrupted])).rows[0].status,'unknown');
  await assert.rejects(runtime.mailWorker.db.query('SELECT * FROM auth.session'),e=>e.code==='42501');
  await assert.rejects(runtime.mailWorker.db.query('SELECT * FROM app.brands'),e=>e.code==='42501');
  await assert.rejects(runtime.database.pool.query('SET ROLE desvio_access'),e=>e.code==='42501');
});


test('business invitations grant only selected clients, preserve independent roles and reject foreign scopes',async()=>{
 const owner=await signup('scoped-owner'),seat=await signup('scoped-seat'),org=await createOrg(owner,'Selected business team');
 const create=async name=>{const r=await request(`/api/v1/workspaces/${org.id}/brands`,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{name}});assert.equal(r.status,201);return r.body;};
 const a=await create('Selected A'),b=await create('Selected B'),c=await create('Private C'),endpoint=`/api/v1/workspaces/${org.id}/invitations`;
 const send=async(ids,role)=>{const r=await request(endpoint,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{email:seat.email,role,business_ids:ids}});assert.equal(r.status,201,JSON.stringify(r.body));await drainMail();const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===seat.email&&m.subject==='Your Desvio client invitation'));return new URLSearchParams(link.hash.slice(1)).get('token');};
 assert.equal((await request(endpoint,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{email:seat.email,role:'viewer',business_ids:[brandA.id]}})).status,404);
 const token=await send([a.id],'viewer');for(let i=0;i<2;i++)assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:seat.cookie,body:{token}})).status,201);
 let list=(await request('/api/v1/businesses',{cookie:seat.cookie})).body.businesses;assert.deepEqual(list.filter(x=>x.organization_id===org.id).map(x=>[x.id,x.role]),[[a.id,'viewer']]);
 assert.equal((await request(`/api/v1/workspaces/${org.id}/members`,{cookie:seat.cookie})).status,403);
 assert.equal((await request(endpoint,{cookie:seat.cookie,method:'POST',key:randomUUID(),body:{email:owner.email,role:'admin',business_ids:[c.id]}})).status,403);
 const second=await send([b.id],'editor');assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:seat.cookie,body:{token:second}})).status,201);
 list=(await request('/api/v1/businesses',{cookie:seat.cookie})).body.businesses;assert.deepEqual(new Map(list.filter(x=>x.organization_id===org.id).map(x=>[x.id,x.role])),new Map([[a.id,'viewer'],[b.id,'editor']]));assert.ok(!list.some(x=>x.id===c.id));
 const direct=new TenantDatabase(runtime.database.pool);await assert.rejects(direct.transaction(seat.id,org.id,true,async()=>{},a.id));await direct.transaction(seat.id,org.id,true,async()=>{},b.id);await assert.rejects(direct.transaction(seat.id,org.id,false,async()=>{},c.id));
 assert.equal((await request(`/api/v1/workspaces/${org.id}/members/${seat.id}`,{cookie:owner.cookie,method:'PATCH',body:{role:'owner',active:true}})).status,403);
 await assert.rejects(direct.transaction(seat.id,org.id,false,db=>db.query('SELECT * FROM app.team_members()')));
 const teamPath=`/api/v1/businesses/${b.id}/team`;
 const team=(await request(teamPath,{cookie:owner.cookie}));assert.equal(team.status,200,JSON.stringify(team.body));assert.equal(team.body.can_manage,true);assert.ok(team.body.members.some(m=>m.user_id===seat.id&&m.role==='editor'));
 assert.equal((await request(teamPath+'/members/'+seat.id,{cookie:seat.cookie,method:'PATCH',body:{role:'admin',active:true}})).status,403);
 assert.equal((await request(teamPath+'/members/'+owner.id,{cookie:owner.cookie,method:'PATCH',body:{role:'viewer',active:false}})).status,403);
 assert.equal((await request(teamPath+'/members/'+seat.id,{cookie:owner.cookie,method:'PATCH',body:{role:'admin',active:true}})).status,200);
 await direct.transaction(seat.id,org.id,false,async db=>{assert.equal((await db.query('SELECT app.social_manager($1,$2) AS allowed',[org.id,b.id])).rows[0].allowed,true);assert.equal((await db.query('SELECT app.creative_reviewer($1,$2) AS allowed',[org.id,a.id])).rows[0].allowed,false);},b.id);
 assert.equal((await request(teamPath+'/members/'+seat.id,{cookie:owner.cookie,method:'PATCH',body:{role:'viewer',active:false}})).status,200);
 assert.equal((await request('/api/v1/invitations/accept',{cookie:seat.cookie,method:'POST',body:{token:second}})).status,201);
 assert.equal((await request(teamPath,{cookie:seat.cookie})).status,404);assert.equal((await request(`/api/v1/businesses/${a.id}/team`,{cookie:seat.cookie})).status,200);
 assert.ok((await request(teamPath,{cookie:owner.cookie})).body.activity.some(e=>e.action==='business.member_removed'));
 for(const role of ['reviewer','analyst']){
  const scopedToken=await send([a.id],role);assert.equal((await request('/api/v1/invitations/accept',{cookie:seat.cookie,method:'POST',body:{token:scopedToken}})).status,201);
  const roles=(await request('/api/v1/businesses',{cookie:seat.cookie})).body.businesses;assert.equal(roles.find(x=>x.id===a.id).role,role);
  await assert.rejects(direct.transaction(seat.id,org.id,true,async()=>{},a.id));
  assert.equal((await request(endpoint,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{email:seat.email,role}})).status,400);
 }
 const third=await send([c.id],'viewer');const pending=(await request(endpoint,{cookie:owner.cookie})).body.invitations.find(i=>i.status==='pending');await request(endpoint+'/'+pending.id+'/revoke',{cookie:owner.cookie,method:'POST',body:{}});assert.equal((await request('/api/v1/invitations/accept',{cookie:seat.cookie,method:'POST',body:{token:third}})).status,404);
});

test('profile name, password changes and session controls remain bound to the authenticated user',async()=>{
 const user=await signup('profile-controls'),other=await signup('profile-other');
 for(const body of [{name:''},{name:'x'.repeat(121)},{name:'New name',role:'owner'},{email:'changed@example.test'}])assert.equal((await request('/api/auth/update-user',{method:'POST',cookie:user.cookie,body})).status,400);
 const login=()=>request('/api/auth/sign-in/email',{method:'POST',body:{email:user.email,password:'a-strong-test-password-2026'}});
 const second=await login();assert.equal(second.status,200);
 assert.equal((await request('/api/auth/update-user',{method:'POST',cookie:user.cookie,body:{name:'Updated profile'}})).status,200);
 assert.equal((await request('/api/auth/get-session',{cookie:user.cookie})).body.user.name,'Updated profile');
 assert.notEqual((await request('/api/auth/get-session',{cookie:other.cookie})).body.user.name,'Updated profile');
 const sessions=await request('/api/auth/list-sessions',{cookie:user.cookie});assert.equal(sessions.status,200);assert.ok(sessions.body.length>=2);assert.ok(sessions.body.every(s=>s.userId===user.id));
 const foreign=(await request('/api/auth/list-sessions',{cookie:other.cookie})).body[0];
 await request('/api/auth/revoke-session',{cookie:user.cookie,method:'POST',body:{token:foreign.token}});assert.ok((await request('/api/auth/get-session',{cookie:other.cookie})).body?.user);
 assert.equal((await request('/api/auth/revoke-other-sessions',{cookie:user.cookie,method:'POST',body:{}})).status,200);
 assert.equal((await request('/api/auth/get-session',{cookie:second.cookie})).body,null);
 const wrong=await request('/api/auth/change-password',{cookie:user.cookie,method:'POST',body:{currentPassword:'incorrect-password',newPassword:'new-profile-password-2026',revokeOtherSessions:true}});assert.equal(wrong.status,400);
 // Separate the password-rotation phase from the already-tested login rate window.
 await admin.query('DELETE FROM auth."rateLimit"');
 const third=await login();assert.equal(third.status,200);
 const changed=await request('/api/auth/change-password',{cookie:user.cookie,method:'POST',body:{currentPassword:'a-strong-test-password-2026',newPassword:'new-profile-password-2026',revokeOtherSessions:true}});assert.equal(changed.status,200);assert.ok(changed.cookie);
 assert.equal((await request('/api/auth/get-session',{cookie:third.cookie})).body,null);
 assert.equal((await login()).status,401);
 const replacement=await request('/api/auth/sign-in/email',{method:'POST',body:{email:user.email,password:'new-profile-password-2026'}});assert.equal(replacement.status,200);
 assert.equal((await request('/api/auth/update-user',{method:'POST',cookie:replacement.cookie,origin:'https://other.example',body:{name:'forged'}})).status,403);
 assert.equal((await request('/api/auth/list-sessions')).status,401);
});

test('delegated business admins manage scoped teammates without account or sibling escalation',async()=>{
 const fixtureUser=async label=>{await admin.query('DELETE FROM auth."rateLimit"');return signup(label);};
 const owner=await fixtureUser('delegate-owner'),manager=await fixtureUser('delegate-manager'),member=await fixtureUser('delegate-member'),late=await fixtureUser('delegate-late'),org=await createOrg(owner,'Delegated team');
 const create=async name=>(await request(`/api/v1/workspaces/${org.id}/brands`,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{name}})).body;
 const a=await create('Managed business'),b=await create('Other business');
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'editor','selected')",[org.id,manager.id]);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'admin'),($1,$4,$3,'viewer')",[org.id,a.id,manager.id,b.id]);
 const root=`/api/v1/businesses/${a.id}/team`,send=(email,role='editor',business_ids=[a.id],cookie=manager.cookie)=>request(root+'/invitations',{method:'POST',cookie,key:randomUUID(),body:{email,role,business_ids}});
 const view=await request(root,{cookie:manager.cookie});assert.equal(view.body.can_manage,true);assert.equal(view.body.can_assign_admin,false);assert.equal(view.body.can_manage_account,false);
 assert.equal((await request(`/api/v1/businesses/${b.id}/team`,{cookie:manager.cookie})).body.can_manage,false);
 assert.equal((await send(member.email,'admin')).status,403);
 assert.equal((await send(member.email,'editor',[a.id,b.id])).status,403);
 assert.equal((await request(`/api/v1/workspaces/${org.id}/invitations`,{method:'POST',cookie:manager.cookie,key:randomUUID(),body:{email:member.email,role:'editor',business_ids:[a.id]}})).status,403);
 const replayKey=randomUUID(),inviteBody={email:member.email,role:'editor',business_ids:[a.id]};
 const invitation=await request(root+'/invitations',{method:'POST',cookie:manager.cookie,key:replayKey,body:inviteBody});assert.equal(invitation.status,201,JSON.stringify(invitation.body));
 const replay=await request(root+'/invitations',{method:'POST',cookie:manager.cookie,key:replayKey,body:inviteBody});assert.equal(replay.status,201);assert.equal(replay.body.id,invitation.body.id);
 assert.equal((await request(root+'/invitations',{method:'POST',cookie:manager.cookie,key:replayKey,body:{...inviteBody,role:'viewer'}})).status,409);
 await new TenantDatabase(runtime.database.pool).transaction(manager.id,org.id,false,async db=>{
  assert.equal((await db.query('SELECT * FROM app.idempotency')).rowCount,0);
  assert.equal((await db.query('SELECT * FROM app.business_invitation_requests')).rowCount,1);
 },a.id);
 await drainMail();const tokenFor=email=>new URLSearchParams(messageLink(smtp.messages.findLast(m=>m.to.value[0].address===email&&m.subject==='Your Desvio client invitation')).hash.slice(1)).get('token');
 assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:member.cookie,body:{token:tokenFor(member.email)}})).status,201);
 assert.equal((await request(root+'/members/'+member.id,{method:'PATCH',cookie:manager.cookie,body:{role:'reviewer',active:true}})).status,200);
 for(const target of [owner.id,manager.id])assert.equal((await request(root+'/members/'+target,{method:'PATCH',cookie:manager.cookie,body:{role:'viewer',active:false}})).status,403);
 assert.equal((await request(root+'/members/'+member.id,{method:'PATCH',cookie:manager.cookie,body:{role:'admin',active:true}})).status,403);
 assert.equal((await request(root+'/members/'+member.id,{method:'PATCH',cookie:manager.cookie,body:{role:'viewer',active:false}})).status,200);
 assert.equal((await request(root+'/members/'+member.id,{method:'PATCH',cookie:manager.cookie,body:{role:'analyst',active:true}})).status,200);
 const ownerMulti=await send(late.email,'viewer',[a.id,b.id],owner.cookie);assert.equal(ownerMulti.status,201,JSON.stringify(ownerMulti.body));
 assert.equal((await request(root+'/invitations/'+ownerMulti.body.id+'/revoke',{method:'POST',cookie:owner.cookie,body:{}})).status,201);
 await admin.query("UPDATE app.business_memberships SET role='admin' WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3",[org.id,b.id,manager.id]);
 const delegatedMulti=await send(late.email,'reviewer',[a.id,b.id]);assert.equal(delegatedMulti.status,201,JSON.stringify(delegatedMulti.body));
 assert.equal((await request(root+'/invitations/'+delegatedMulti.body.id+'/revoke',{method:'POST',cookie:manager.cookie,body:{}})).status,201);
 await admin.query("UPDATE app.business_memberships SET role='viewer' WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3",[org.id,b.id,manager.id]);
 const sibling=await request(`/api/v1/businesses/${b.id}/team/invitations`,{method:'POST',cookie:owner.cookie,key:randomUUID(),body:{email:late.email,role:'viewer'}});assert.equal(sibling.status,201);
 assert.ok(!(await request(root,{cookie:manager.cookie})).body.invitations.some(i=>i.id===sibling.body.id));
 assert.equal((await request(root+'/invitations/'+sibling.body.id+'/revoke',{method:'POST',cookie:manager.cookie,body:{}})).status,404);
 const revoke=await send(late.email);assert.equal(revoke.status,201);assert.equal((await request(root+'/invitations/'+revoke.body.id+'/revoke',{method:'POST',cookie:manager.cookie,body:{}})).status,201);
 const selfInvite=await send(manager.email,'viewer');assert.equal(selfInvite.status,201);await drainMail();
 assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:manager.cookie,body:{token:tokenFor(manager.email)}})).status,409);
 const pending=await send(late.email);assert.equal(pending.status,201);await drainMail();const token=tokenFor(late.email);
 await admin.query("UPDATE app.business_memberships SET role='viewer' WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3",[org.id,a.id,manager.id]);
 assert.equal((await request('/api/v1/invitations/accept',{method:'POST',cookie:late.cookie,body:{token}})).status,404);
 assert.equal((await send(late.email)).status,403);
 assert.equal((await request(root+'/members/'+member.id,{method:'PATCH',cookie:manager.cookie,body:{role:'editor',active:true}})).status,403);
 const direct=new TenantDatabase(runtime.database.pool);
 await assert.rejects(direct.transaction(manager.id,org.id,true,db=>db.query('SELECT app.change_business_member($1,$2,$3,$4)',[b.id,member.id,'editor',true])));
 assert.equal((await admin.query('SELECT role FROM app.business_memberships WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3',[org.id,a.id,member.id])).rows[0].role,'analyst');
});
