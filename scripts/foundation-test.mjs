import {prepareRenderImage} from './render-test-image.mjs';
import {prepareSkillImage} from "./skill-test-image.mjs";
// Disposable local PostgreSQL only. Never accepts an external database URL.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import {resolve} from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../dist/auth.js';
import { migrate } from './migrate.mjs';
import {prepareDocumentImage} from './document-test-image.mjs';
import {startAssetServices} from './storage-test-services.mjs';

const IMAGE = 'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
const container = `desvio-foundation-${randomUUID()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 60000 }).trim();
const password = randomBytes(32).toString('hex');
let pool, authMigrationPool,services;
let started = false;
// Host-backed disposable data avoids exhausting Docker's shared VM disk and
// survives the deliberate database restart in the recovery tests.
const databaseDir=await mkdtemp(resolve('work/foundation-data-'));
try {
  // Docker can reassign an automatically published port on restart. Reserve an explicit
  // loopback port so recovery tests exercise the database, not a changed endpoint.
  const reservation=createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const reservedPort=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  docker('run','--rm','-d','--name',container,'--label','desvio.purpose=isolated-test',
    '-v',`${databaseDir}:/var/lib/postgresql/data`,
    '-p',`127.0.0.1:${reservedPort}:5432`,'-e',`POSTGRES_PASSWORD=${password}`,IMAGE);
  started = true;
  const port = docker('port',container,'5432/tcp').split(':').at(-1);
  const url = (user, pass) => `postgresql://${user}:${pass}@127.0.0.1:${port}/postgres`;
  pool = new Pool({ connectionString: url('postgres',password), connectionTimeoutMillis: 1000 });
  pool.on('error', () => {});
  let ready = false;
  for (let i=0;i<100;i++) {
    try { await pool.query('SELECT 1'); ready=true; break; } catch { await setTimeout(200); }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not start');
  const workerPass=randomBytes(32).toString('hex'),dispatchPass=randomBytes(32).toString('hex');
  const appPass=randomBytes(32).toString('hex'), authPass=randomBytes(32).toString('hex'),mailPass=randomBytes(32).toString('hex');
  // Passwords are hex generated here, never operator-controlled SQL input.
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE ROLE desvio_app LOGIN PASSWORD '${appPass}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_auth LOGIN PASSWORD '${authPass}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_worker LOGIN PASSWORD '${workerPass}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_dispatcher LOGIN PASSWORD '${dispatchPass}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_bootstrap NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_mail LOGIN PASSWORD '${mailPass}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_access NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`);
  const config = { mode:'test', origin:'http://127.0.0.1:3100', authSecret:randomBytes(32).toString('hex'),
    authDatabaseUrl:url('desvio_auth',authPass), appDatabaseUrl:url('desvio_app',appPass),mailDatabaseUrl:url('desvio_mail',mailPass),
    storage:{endpoint:'http://127.0.0.1:1',region:'garage',bucket:'desvio-test',accessKeyId:'test',secretAccessKey:'test'},scanner:{host:'127.0.0.1',port:1},
    jobs:{workerDatabaseUrl:url('desvio_worker',workerPass),dispatcherDatabaseUrl:url('desvio_dispatcher',dispatchPass),address:'127.0.0.1:1',namespace:'desvio-test',taskQueue:'assets'},
    mailEncryptionKey:randomBytes(32).toString('hex'),smtp:{host:'127.0.0.1',port:1,secure:false,from:'accounts@desvio.test'} };
  if (process.argv.includes('--generate-auth')) {
    await pool.query('CREATE SCHEMA auth');
    authMigrationPool = new Pool({ connectionString:url('postgres',password), options:'-c search_path=auth' });
    const plan = await getMigrations(authOptions(authMigrationPool,config));
    const sql = await plan.compileMigrations();
    await writeFile(new URL('../database/migrations/000_auth.sql',import.meta.url),
      '-- Generated from pinned Better Auth 1.7.12 authOptions; reviewed before execution.\nCREATE SCHEMA auth;\nREVOKE ALL ON SCHEMA auth FROM PUBLIC;\nSET LOCAL search_path = auth;\n'+sql+'\nSET LOCAL search_path = public;\nGRANT USAGE ON SCHEMA auth TO desvio_auth;\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO desvio_auth;\n');
    console.log('Generated auth schema for review; no application migrations or tests run.');
  } else {
    await migrate(pool);
    await migrate(pool); // Reapply must be a verified no-op.
    const version = (await pool.query('SHOW server_version')).rows[0].server_version;
    const provisionPass=randomBytes(32).toString('hex');await pool.query(`ALTER ROLE desvio_provisioner LOGIN PASSWORD '${provisionPass}'`);config.provisionerDatabaseUrl=url('desvio_provisioner',provisionPass);
    console.log(`Disposable PostgreSQL ${version}; image ${IMAGE}; migration replay passed`);
    const operatorOnly=process.argv.includes('--operator');
    const documentOnly=process.argv.includes('--documents');
    const visualReviewOnly=process.argv.includes('--visual-reviews'),accountOnly=process.argv.includes('--accounts')||visualReviewOnly,videoStorageOnly=process.argv.includes('--video-storage'),videoOnly=process.argv.includes('--video-provider')||videoStorageOnly;
    const publishingWeb=process.argv.includes('--publishing-web'),publishingOnly=process.argv.includes('--publishing')||publishingWeb;
    const socialWeb=process.argv.includes('--social-web');
    const exportOnly=process.argv.includes('--exports')||process.argv.includes('--carousel-generation')||publishingOnly,socialOnly=process.argv.includes('--social')||socialWeb;
    const planningOnly=process.argv.includes('--planning'),aiPlanningOnly=process.argv.includes('--ai-planning');
    const photoOnly=process.argv.includes('--product-photos');
    const customerWeb=process.argv.includes('--customer-web'),canvasWeb=process.argv.includes('--canvas-web'),browserSuite=process.argv.includes('--web')||canvasWeb||customerWeb,intakeOnly=process.argv.includes('--intake'),canvasOnly=process.argv.includes('--canvas')||photoOnly;
    if(!operatorOnly&&!documentOnly&&!videoOnly&&!accountOnly&&!intakeOnly&&!planningOnly&&!exportOnly&&!socialOnly)process.env.SKILL_RUNTIME_IMAGE=prepareSkillImage();
    if(!operatorOnly&&!documentOnly&&!videoOnly&&!accountOnly&&!intakeOnly&&!planningOnly&&!aiPlanningOnly&&!socialOnly){process.env.RENDER_RUNTIME_IMAGE=prepareRenderImage();config.renderImage=process.env.RENDER_RUNTIME_IMAGE;}
    if(!operatorOnly&&!videoOnly&&!accountOnly&&!socialOnly&&!exportOnly&&!browserSuite&&!canvasOnly&&!planningOnly&&!aiPlanningOnly)process.env.DOCUMENT_PARSER_IMAGE=prepareDocumentImage();
    const code = operatorOnly||documentOnly||videoOnly||socialOnly||exportOnly||browserSuite||intakeOnly||canvasOnly||planningOnly||aiPlanningOnly?0:await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,['--test','--test-concurrency=1',visualReviewOnly?'tests/foundation/brand-visual-review.test.mjs':'tests/foundation/tenancy.test.mjs'], {
        stdio:'inherit', env:{...process.env, DESVIO_TEST_CONFIG:JSON.stringify(config), DESVIO_TEST_ADMIN_URL:url('postgres',password), DESVIO_TEST_CONTAINER:container} });
      child.on('error',reject); child.on('exit', code=>resolve(code ?? 1));
    });
    process.exitCode=code;
    if(code===0&&!accountOnly){
      if(!operatorOnly&&!intakeOnly&&!planningOnly){services=await startAssetServices();Object.assign(config,{storage:services.storage,scanner:services.scanner});config.jobs.address=services.address;}
      process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test','--test-concurrency=1',...(process.argv.includes('--carousel-generation')?['--test-name-pattern=carousel generation|durable carousel']:[]),...(operatorOnly?['tests/foundation/operator-configuration.test.mjs']:photoOnly?['tests/foundation/assets.test.mjs','tests/foundation/creative.test.mjs']:documentOnly?['tests/foundation/brand-brain.test.mjs']:videoStorageOnly?['tests/foundation/assets.test.mjs','tests/foundation/video-storage.test.mjs']:videoOnly?['tests/foundation/video-provider.test.mjs']:publishingWeb?['tests/browser/publishing.test.mjs']:publishingOnly?['tests/foundation/publication.test.mjs']:socialWeb?['tests/browser/connections.test.mjs']:socialOnly?['tests/foundation/social.test.mjs','tests/foundation/social-oauth.test.mjs','tests/foundation/social-provisioning.test.mjs']:exportOnly?['tests/foundation/exports.test.mjs']:aiPlanningOnly?['tests/foundation/planning-generation.test.mjs']:planningOnly?['tests/foundation/content-plan.test.mjs']:browserSuite?(customerWeb?['tests/browser/customer.test.mjs']:canvasWeb?['tests/browser/canvas.test.mjs']:['tests/browser/customer.test.mjs','tests/browser/canvas.test.mjs','tests/browser/connections.test.mjs','tests/browser/publishing.test.mjs']):intakeOnly?['tests/foundation/intake.test.mjs']:canvasOnly?['tests/foundation/creative.test.mjs']:['tests/foundation/operator-configuration.test.mjs','tests/foundation/assets.test.mjs','tests/foundation/brand-visual-review.test.mjs','tests/foundation/brand-brain.test.mjs','tests/foundation/intake.test.mjs','tests/foundation/creative.test.mjs','tests/foundation/content-plan.test.mjs','tests/foundation/planning-generation.test.mjs','tests/foundation/exports.test.mjs','tests/foundation/social.test.mjs','tests/foundation/social-oauth.test.mjs','tests/foundation/social-provisioning.test.mjs','tests/foundation/publication.test.mjs','tests/foundation/video-provider.test.mjs','tests/foundation/video-storage.test.mjs'])],{stdio:'inherit',env:{...process.env,DESVIO_TEST_CONFIG:JSON.stringify(config),DESVIO_TEST_ADMIN_URL:url('postgres',password)}});child.on('error',reject);child.on('exit',code=>resolve(code??1));});
    }
  }
} finally {
  await services?.close();
  await authMigrationPool?.end(); await pool?.end();
  if (started) {try{docker('rm','-f',container);}catch{/* --rm may already have removed a failed database. */}}
  await rm(databaseDir,{recursive:true,force:true});
}
