import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import {createServer} from 'node:net';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {webRuntimeConfig} from '../../scripts/start-web.mjs';
import {chromium} from '@playwright/test';
import {bootstrapDatabase,bootstrapInput,runtimeRoles} from '../../scripts/bootstrap-database.mjs';
import {listenAddress} from '../../dist/listen.js';
const adminURL=process.env.DESVIO_TEST_ADMIN_URL;
assert.ok(adminURL&&new URL(adminURL).hostname==='127.0.0.1','Only harness-owned loopback PostgreSQL');
const pool=new Pool({connectionString:adminURL,max:4});pool.on('error',()=>{});after(()=>pool.end());
const passwords=Object.fromEntries(Object.keys(runtimeRoles).map(r=>[r,randomBytes(32).toString('hex')]));
const runtimeURL=role=>{const u=new URL(adminURL);u.username=role;u.password=passwords[role];return u.href;};
const bootstrapEnv={APP_MODE:'staging',DESVIO_BOOTSTRAP_CONFIRM:'initialize-isolated-desvio-database',DESVIO_DATABASE_NAME:'postgres',MIGRATION_DATABASE_URL:adminURL,...Object.fromEntries(Object.entries(runtimeRoles).map(([r,k])=>[k,passwords[r]]))};
async function withRole(role,fn){const p=new Pool({connectionString:runtimeURL(role),max:1});p.on('error',()=>{});try{return await fn(p);}finally{await p.end();}}
async function runCLI(env){return new Promise((resolve,reject)=>{let output='';const child=spawn(process.execPath,['scripts/bootstrap-database.mjs'],{env:{PATH:process.env.PATH,...env}});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.once('error',reject);child.once('exit',code=>resolve({code,output}));});}

test('setup rejects missing consent, production, weak/reused credentials and wrong database before mutation',async()=>{
 assert.throws(()=>bootstrapInput({...bootstrapEnv,DESVIO_BOOTSTRAP_CONFIRM:''}),/CONFIRMATION/);
 assert.throws(()=>bootstrapInput({...bootstrapEnv,APP_MODE:'production'}),/MODE_DENIED/);
 assert.throws(()=>bootstrapInput({...bootstrapEnv,APP_DATABASE_PASSWORD:'guess'}),/PASSWORDS/);
 assert.throws(()=>bootstrapInput({...bootstrapEnv,APP_DATABASE_PASSWORD:passwords.desvio_auth}),/PASSWORDS/);
 await assert.rejects(bootstrapDatabase(pool,passwords,'another-database'),/DATABASE_MISMATCH/);
 assert.equal((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='desvio_app'")).rowCount,0);
 const failed=await runCLI({...bootstrapEnv,DESVIO_DATABASE_NAME:'wrong'});assert.equal(failed.code,1);assert.equal(failed.output.trim(),'BOOTSTRAP_DATABASE_MISMATCH');
 assert.ok(!failed.output.includes(passwords.desvio_app));assert.ok(!failed.output.includes(new URL(adminURL).password));
});
test('setup refuses to adopt unrelated data or cluster roles and preserves them',async()=>{
 await pool.query('CREATE TABLE public.unrelated(value text); INSERT INTO public.unrelated VALUES(\'preserve\')');
 await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/DATABASE_NOT_EMPTY/);assert.equal((await pool.query('SELECT value FROM public.unrelated')).rows[0].value,'preserve');await pool.query('DROP TABLE public.unrelated');
 await pool.query('CREATE ROLE desvio_app NOLOGIN');await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/UNMANAGED_ROLES/);assert.equal((await pool.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='desvio_app'")).rows[0].rolcanlogin,false);await pool.query('DROP ROLE desvio_app');
});
test('a database error during fresh setup rolls back roles and schema together',async()=>{
 const faultPool={connect:async()=>{const db=await pool.connect();return {release:()=>db.release(),query:(sql,args)=>db.query(sql.includes('CREATE SCHEMA IF NOT EXISTS desvio_migrations')?'SELECT 1/0':sql,args)};}};
 await assert.rejects(bootstrapDatabase(faultPool,passwords,'postgres'),/TRANSACTION_ROLLED_BACK/);
 assert.equal((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='desvio_app'")).rowCount,0);
 assert.equal((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='desvio_migrations'")).rowCount,0);
});
test('fresh setup atomically creates least-privilege service logins, all migrations and protected credential metadata',async()=>{
 const result=await bootstrapDatabase(pool,passwords,'postgres');assert.equal(result.replayed,false);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM desvio_migrations.applied')).rows[0].n,19);
 for(const role of Object.keys(runtimeRoles))await withRole(role,async db=>{
  const r=(await db.query('SELECT current_user AS name,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(r.name,role);assert.deepEqual([r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolinherit],[false,false,false,false,false]);
  await assert.rejects(db.query('SELECT * FROM desvio_migrations.runtime_credentials'),/permission denied/);
  await assert.rejects(db.query('CREATE TABLE public.escape(id int)'),/permission denied/);
  await assert.rejects(db.query('CREATE TEMP TABLE escape(id int)'),/permission denied/);
  await assert.rejects(db.query('SET ROLE desvio_access'),/permission denied/);
 });
 await withRole('desvio_app',async db=>assert.equal((await db.query('SELECT * FROM app.brands')).rowCount,0));
 await withRole('desvio_worker',async db=>{assert.equal((await db.query('SELECT * FROM app.jobs')).rowCount,0);await assert.rejects(db.query('SELECT * FROM auth.session'),/permission denied/);});
 const helpers=(await pool.query("SELECT rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname IN ('desvio_bootstrap','desvio_access')")).rows;assert.ok(helpers.every(r=>!r.rolcanlogin&&r.rolbypassrls));
});
test('concurrent replays are safe, unchanged passwords still authenticate and mismatched credentials never rotate silently',async()=>{
 const before=(await pool.query("SELECT rolpassword FROM pg_authid WHERE rolname='desvio_app'")).rows[0].rolpassword;
 const results=await Promise.all([bootstrapDatabase(pool,passwords,'postgres'),bootstrapDatabase(pool,passwords,'postgres')]);assert.ok(results.every(r=>r.replayed));
 await assert.rejects(bootstrapDatabase(pool,{...passwords,desvio_app:randomBytes(32).toString('hex')},'postgres'),/ROTATION_REQUIRED/);
 assert.equal((await pool.query("SELECT rolpassword FROM pg_authid WHERE rolname='desvio_app'")).rows[0].rolpassword,before);
 const replay=await runCLI(bootstrapEnv);assert.equal(replay.code,0,replay.output);assert.equal(JSON.parse(replay.output).replayed,true);for(const secret of Object.values(passwords))assert.ok(!replay.output.includes(secret));
});
test('replay refuses elevated roles, privilege membership, disabled logins and changed migration checksums',async()=>{
 await pool.query('ALTER ROLE desvio_app BYPASSRLS');await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/UNSAFE_ROLE/);await pool.query('ALTER ROLE desvio_app NOBYPASSRLS');
 await pool.query('CREATE ROLE unrelated_privilege NOLOGIN; GRANT unrelated_privilege TO desvio_worker');await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/ROLE_MEMBERSHIP/);await pool.query('REVOKE unrelated_privilege FROM desvio_worker; DROP ROLE unrelated_privilege');
 await pool.query('ALTER ROLE desvio_app NOLOGIN');await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/LOGIN_STATE/);await pool.query('ALTER ROLE desvio_app LOGIN');
 const old=(await pool.query("UPDATE desvio_migrations.applied SET sha256='altered' WHERE name='000_auth.sql' RETURNING (SELECT sha256 FROM desvio_migrations.applied WHERE name='000_auth.sql') AS sha")).rows[0].sha;
 await assert.rejects(bootstrapDatabase(pool,passwords,'postgres'),/TRANSACTION_ROLLED_BACK/);await pool.query("UPDATE desvio_migrations.applied SET sha256=$1 WHERE name='000_auth.sql'",[old]);
 assert.equal((await bootstrapDatabase(pool,passwords,'postgres')).replayed,true);
});
test('CLI verifies actual role passwords and reports external credential drift without rotating them',async()=>{
 const changed=randomBytes(32).toString('hex');await pool.query(`ALTER ROLE desvio_mail PASSWORD '${changed}'`);
 const result=await runCLI(bootstrapEnv);assert.equal(result.code,1);assert.equal(result.output.trim(),'BOOTSTRAP_RUNTIME_LOGIN_CHECK_FAILED');assert.ok(!result.output.includes(changed));
 await pool.query(`ALTER ROLE desvio_mail PASSWORD '${passwords.desvio_mail}'`);
 assert.equal((await runCLI(bootstrapEnv)).code,0);
});
test('bootstrapped cloud API and standalone web serve real routes and shut down cleanly',async()=>{
 assert.deepEqual(listenAddress({APP_MODE:'staging',PORT:'8080'}),{host:'::',port:8080});assert.deepEqual(listenAddress({APP_MODE:'test'}),{host:'127.0.0.1',port:3100});
 for(const port of ['0','-1','1.5','NaN','65536',' 3000'])assert.throws(()=>listenAddress({PORT:port}),/PORT/);
 assert.throws(()=>listenAddress({LISTEN_HOST:'untrusted.example'}),/LISTEN_HOST/);
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 let output='';const child=spawn(process.execPath,['dist/main.js'],{env:{PATH:process.env.PATH,APP_MODE:'staging',PORT:String(port),APP_ORIGIN:'https://desvio.test',AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_DATABASE_URL:runtimeURL('desvio_auth'),APP_DATABASE_URL:runtimeURL('desvio_app'),MAIL_DATABASE_URL:runtimeURL('desvio_mail'),MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',SMTP_USER:'local-unconnected',SMTP_PASSWORD:'local-unconnected',SMTP_FROM:'accounts@desvio.test',S3_ENDPOINT:'http://127.0.0.1:1',S3_BUCKET:'unconnected',S3_REGION:'test',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test'}});
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const exit=new Promise(resolve=>child.once('exit',code=>resolve(code)));
 try{
  let response;for(let i=0;i<100;i++){try{response=await fetch(`http://127.0.0.1:${port}/health`);break;}catch{if(child.exitCode!==null)break;await setTimeout(100);}}
  assert.ok(response,output);assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok',scope:'api-database-only'});
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/businesses`)).status,401);
  // Build and run the actual standalone output against the real bootstrapped API.
  const apiOrigin=`http://127.0.0.1:${port}`;
  let buildLog='';const build=spawn(process.execPath,['scripts/build-web.mjs'],{env:{PATH:process.env.PATH,API_ORIGIN:apiOrigin,NEXT_TELEMETRY_DISABLED:'1'}});build.stdout.on('data',d=>buildLog+=d);build.stderr.on('data',d=>buildLog+=d);
  assert.equal(await new Promise(r=>build.once('exit',r)),0,buildLog);
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const webPort=socket.address().port;await new Promise(r=>socket.close(r));
  const webOrigin=`http://127.0.0.1:${webPort}`,root=resolve('apps/web/.next/standalone');
  const webEnv={PATH:process.env.PATH,APP_MODE:'test',API_ORIGIN:apiOrigin,APP_ORIGIN:webOrigin,S3_BROWSER_ORIGIN:'http://127.0.0.1:1',PORT:String(webPort),NEXT_TELEMETRY_DISABLED:'1'};
  let webLog='';const web=spawn(process.execPath,[root+'/start-web.mjs'],{cwd:root,env:webEnv});web.stdout.on('data',d=>webLog+=d);web.stderr.on('data',d=>webLog+=d);const webExit=new Promise(r=>web.once('exit',r));let browser;
  try{
   let health;for(let i=0;i<100;i++){try{health=await fetch(webOrigin+'/health');break;}catch{if(web.exitCode!==null)break;await setTimeout(100);}}
   assert.ok(health,webLog);assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',scope:'web-process-only'});
   assert.equal((await fetch(webOrigin+'/api/v1/businesses')).status,401);
   browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(webOrigin+'/sign-in');await page.getByLabel('Email address').waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),1);assert.deepEqual(errors,[]);
   await browser.close();browser=undefined;web.kill('SIGTERM');assert.equal(await Promise.race([webExit,setTimeout(10000,'timeout')]),143); // Pinned Next graceful SIGTERM exit (128 + 15).
   const mismatch=spawn(process.execPath,[root+'/start-web.mjs'],{cwd:root,env:{...webEnv,API_ORIGIN:'http://127.0.0.1:1'}});let mismatchLog='';mismatch.stderr.on('data',d=>mismatchLog+=d);assert.equal(await new Promise(r=>mismatch.once('exit',r)),1);assert.equal(mismatchLog.trim(),'WEB_API_ORIGIN_REBUILD_REQUIRED');
  }finally{await browser?.close();if(web.exitCode===null){web.kill('SIGKILL');await webExit;}}
  child.kill('SIGTERM');assert.equal(await Promise.race([exit,setTimeout(10000,'timeout')]),0);
  for(const secret of Object.values(passwords))assert.ok(!output.includes(secret));
 }finally{if(child.exitCode===null){child.kill('SIGKILL');await exit;}}
});

test('web startup validates deployment origins, mode and port without disclosing supplied values',()=>{
 const valid={APP_MODE:'staging',APP_ORIGIN:'https://desvio.test',API_ORIGIN:'http://api.railway.internal:3100',S3_BROWSER_ORIGIN:'https://private-storage.test',PORT:'3000'},artifact={api_origin:valid.API_ORIGIN};
 assert.deepEqual(webRuntimeConfig(valid,artifact),{host:'::',port:'3000'});
 for(const env of [{...valid,APP_MODE:'production'},{...valid,APP_ORIGIN:'http://desvio.test'},{...valid,S3_BROWSER_ORIGIN:'http://storage.test'},{...valid,API_ORIGIN:'http://user:secret@api.test'},{...valid,PORT:'0'},{...valid,PORT:'2.5'},{...valid,LISTEN_HOST:'hostname.test'}])assert.throws(()=>webRuntimeConfig(env,artifact),/^Error: WEB_[A-Z_]+$/);
});
