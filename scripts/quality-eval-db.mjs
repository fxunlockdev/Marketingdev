#!/usr/bin/env node
/** Database-backed quality tests (tests/quality/*.db.test.mjs) against disposable local PostgreSQL,
 * object storage and the isolated skill sandbox. Same isolation as scripts/foundation-test.mjs:
 * containers labelled desvio.purpose=isolated-test, loopback only, no external database URL, no
 * provider key. Temporal and the malware scanner are not needed: jobs run in-process.
 *
 *   npm run build && node scripts/quality-eval-db.mjs
 */
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {Pool} from 'pg';
import {S3Client, HeadBucketCommand} from '@aws-sdk/client-s3';
import {migrate} from './migrate.mjs';
import {port} from './storage-test-services.mjs';
import {prepareSkillImage} from './skill-test-image.mjs';

const POSTGRES = 'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
const GARAGE = 'dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000}).trim();
const hex = () => randomBytes(32).toString('hex');
const containers = [];

async function postgres(dir) {
  const name = `desvio-foundation-${randomUUID()}`, password = hex(), pgPort = await port();
  docker('run', '--rm', '-d', '--name', name, '--label', 'desvio.purpose=isolated-test', '-v', `${dir}:/var/lib/postgresql/data`, '-p', `127.0.0.1:${pgPort}:5432`, '-e', `POSTGRES_PASSWORD=${password}`, POSTGRES);
  containers.push(name);
  const url = (user, pass) => `postgresql://${user}:${pass}@127.0.0.1:${pgPort}/postgres`;
  const pool = new Pool({connectionString: url('postgres', password), connectionTimeoutMillis: 1000});
  pool.on('error', () => {});
  for (const deadline = Date.now() + 90000; ; await setTimeout(200)) {
    try {await pool.query('SELECT 1'); break;} catch (error) {if (Date.now() > deadline) throw error;}
  }
  const pass = {app: hex(), auth: hex(), worker: hex(), dispatch: hex(), mail: hex()};
  // Passwords are hex generated here, never operator input.
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE ROLE desvio_app LOGIN PASSWORD '${pass.app}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_auth LOGIN PASSWORD '${pass.auth}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_worker LOGIN PASSWORD '${pass.worker}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_dispatcher LOGIN PASSWORD '${pass.dispatch}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_bootstrap NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_mail LOGIN PASSWORD '${pass.mail}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    CREATE ROLE desvio_access NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`);
  await migrate(pool);
  await pool.end();
  return {admin: url('postgres', password), app: url('desvio_app', pass.app), auth: url('desvio_auth', pass.auth), worker: url('desvio_worker', pass.worker), dispatch: url('desvio_dispatcher', pass.dispatch), mail: url('desvio_mail', pass.mail)};
}

async function storage(dir) {
  const config = {endpoint: `http://127.0.0.1:${await port()}`, region: 'garage', bucket: 'desvio-test', accessKeyId: `GK${randomBytes(16).toString('hex')}`, secretAccessKey: hex()};
  const file = resolve(dir, 'garage.toml');
  await writeFile(file, `metadata_dir = "/tmp/meta"\ndata_dir = "/tmp/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "127.0.0.1:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${hex()}"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\nroot_domain = ".s3.localhost"\n`, {mode: 0o600});
  const name = `desvio-storage-${randomUUID()}`;
  docker('run', '--rm', '-d', '--name', name, '--label', 'desvio.purpose=isolated-test', '-p', `127.0.0.1:${new URL(config.endpoint).port}:3900`, '-v', `${file}:/etc/garage.toml:ro`, '-e', `GARAGE_DEFAULT_ACCESS_KEY=${config.accessKeyId}`, '-e', `GARAGE_DEFAULT_SECRET_KEY=${config.secretAccessKey}`, '-e', `GARAGE_DEFAULT_BUCKET=${config.bucket}`, GARAGE, '/garage', 'server', '--single-node', '--default-bucket');
  containers.push(name);
  const client = new S3Client({endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: {accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey}});
  try {
    for (let i = 0; ; i++) {
      try {await client.send(new HeadBucketCommand({Bucket: config.bucket}), {abortSignal: AbortSignal.timeout(1000)}); break;}
      catch (error) {if (i > 60) throw error; await setTimeout(250);}
    }
  } finally {client.destroy();}
  return config;
}

const dir = await mkdtemp(resolve('work/quality-db-'));
try {
  const [db, store] = await Promise.all([mkdtemp(resolve(dir, 'pg-')).then(postgres), mkdtemp(resolve(dir, 'garage-')).then(storage)]);
  const image = prepareSkillImage();
  const config = {mode: 'test', origin: 'http://127.0.0.1:3100', authSecret: hex(), authDatabaseUrl: db.auth, appDatabaseUrl: db.app, mailDatabaseUrl: db.mail, storage: store, scanner: {host: '127.0.0.1', port: 1},
    jobs: {workerDatabaseUrl: db.worker, dispatcherDatabaseUrl: db.dispatch, address: '127.0.0.1:1', namespace: 'desvio-test', taskQueue: 'assets'}, publicSignupEnabled: true, mailEncryptionKey: hex(), smtp: {host: '127.0.0.1', port: 1, secure: false, from: 'accounts@desvio.test'}};
  const files = (await readdir('tests/quality')).filter(f => f.endsWith('.db.test.mjs')).map(f => `tests/quality/${f}`);
  process.exitCode = await new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {stdio: 'inherit', env: {...process.env, DESVIO_TEST_CONFIG: JSON.stringify(config), DESVIO_TEST_ADMIN_URL: db.admin, SKILL_RUNTIME_IMAGE: image}});
    child.on('error', fail); child.on('exit', code => done(code ?? 1));
  });
} finally {
  for (const name of containers.reverse()) {try {docker('rm', '-f', name);} catch {/* --rm may already have removed it */}}
  await rm(dir, {recursive: true, force: true}).catch(() => {});
}
