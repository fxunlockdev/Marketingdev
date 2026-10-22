// One-shot deployment administration. Never import this into a customer service.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {applyMigrations} from './migrate.mjs';

export const runtimeRoles = Object.freeze({
 desvio_app:'APP_DATABASE_PASSWORD', desvio_auth:'AUTH_DATABASE_PASSWORD',
 desvio_mail:'MAIL_DATABASE_PASSWORD', desvio_worker:'WORKER_DATABASE_PASSWORD',
 desvio_dispatcher:'DISPATCHER_DATABASE_PASSWORD', desvio_provisioner:'POSTIZ_PROVISIONER_DATABASE_PASSWORD',
});
const helpers=['desvio_bootstrap','desvio_access'];
const names=[...Object.keys(runtimeRoles),...helpers];
const fingerprint=(role,password)=>createHash('sha256').update(role+'\0'+password).digest('hex');
export class BootstrapError extends Error {constructor(code){super(code);this.code=code;}}
const deny=code=>{throw new BootstrapError(code);};
export function bootstrapInput(env=process.env){
 if(!['test','development','staging'].includes(env.APP_MODE))deny('BOOTSTRAP_MODE_DENIED');
 if(env.DESVIO_BOOTSTRAP_CONFIRM!=='initialize-isolated-desvio-database')deny('BOOTSTRAP_CONFIRMATION_REQUIRED');
 if(!env.MIGRATION_DATABASE_URL||!env.DESVIO_DATABASE_NAME)deny('BOOTSTRAP_TARGET_REQUIRED');
 const passwords=Object.fromEntries(Object.entries(runtimeRoles).map(([role,key])=>[role,env[key]]));
 validatePasswords(passwords);return {url:env.MIGRATION_DATABASE_URL,expectedDatabase:env.DESVIO_DATABASE_NAME,passwords};
}
function validatePasswords(passwords){
 if(Object.keys(passwords).length!==Object.keys(runtimeRoles).length||Object.keys(runtimeRoles).some(role=>typeof passwords[role]!=='string'||! /^[a-f0-9]{64}$/.test(passwords[role])))deny('BOOTSTRAP_DISTINCT_RANDOM_PASSWORDS_REQUIRED');
 if(new Set(Object.values(passwords)).size!==Object.keys(runtimeRoles).length)deny('BOOTSTRAP_DISTINCT_RANDOM_PASSWORDS_REQUIRED');
}
async function assertRoles(db){
 const {rows}=await db.query('SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication FROM pg_roles WHERE rolname=ANY($1)',[names]);
 if(rows.length!==names.length||rows.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolinherit||r.rolreplication||r.rolbypassrls!==helpers.includes(r.rolname)))deny('BOOTSTRAP_UNSAFE_ROLE');
 const membership=await db.query('SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) OR member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) LIMIT 1',[names]);
 if(membership.rowCount)deny('BOOTSTRAP_UNEXPECTED_ROLE_MEMBERSHIP');
 const owned=await db.query(`SELECT 1 FROM pg_class WHERE relowner IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1)) LIMIT 1`,[Object.keys(runtimeRoles)]);
 if(owned.rowCount)deny('BOOTSTRAP_RUNTIME_OWNS_DATA');
}
export async function bootstrapDatabase(pool,passwords,expectedDatabase){
 validatePasswords(passwords);const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='30s'; SET LOCAL statement_timeout='120s'");await db.query('SELECT pg_advisory_xact_lock(724106230)');
  const {rows:[target]}=await db.query('SELECT current_database() AS name,rolsuper FROM pg_roles WHERE rolname=current_user');
  if(!expectedDatabase||target.name!==expectedDatabase)deny('BOOTSTRAP_DATABASE_MISMATCH');
  if(!target.rolsuper)deny('BOOTSTRAP_PRIVILEGED_MIGRATION_ROLE_REQUIRED');
  const existing=(await db.query("SELECT to_regclass('desvio_migrations.runtime_credentials') AS registry")).rows[0].registry;
  if(!existing){
   // Desvio role names are cluster-wide. Never adopt roles or a nonempty database
   // belonging to Postiz, another environment, or an unrelated application.
   if((await db.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)',[names])).rowCount)deny('BOOTSTRAP_UNMANAGED_ROLES_EXIST');
   if((await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1")).rowCount)deny('BOOTSTRAP_DATABASE_NOT_EMPTY');
   await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
   for(const role of names.filter(n=>n!=='desvio_provisioner'))await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER ${helpers.includes(role)?'BYPASSRLS':'NOBYPASSRLS'} NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`);
  }else{
   const stored=(await db.query('SELECT role_name,credential_fingerprint FROM desvio_migrations.runtime_credentials')).rows;
   if(stored.length!==Object.keys(runtimeRoles).length||stored.some(r=>!Object.hasOwn(runtimeRoles,r.role_name)||r.credential_fingerprint!==fingerprint(r.role_name,passwords[r.role_name])))deny('BOOTSTRAP_CREDENTIAL_ROTATION_REQUIRED');
  }
  await applyMigrations(db);await assertRoles(db);
  if(!existing){
   await db.query('CREATE TABLE desvio_migrations.runtime_credentials(role_name text PRIMARY KEY,credential_fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON desvio_migrations.runtime_credentials FROM PUBLIC');
   // Only fixed role names and validated random hex passwords enter this SQL.
   // Never print SQL, connection strings, environment values or caught PG errors.
   await db.query("SET LOCAL password_encryption='scram-sha-256'");
   for(const [role,password] of Object.entries(passwords)){
    await db.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    await db.query('INSERT INTO desvio_migrations.runtime_credentials(role_name,credential_fingerprint) VALUES($1,$2)',[role,fingerprint(role,password)]);
   }
  }
  const login=(await db.query('SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname=ANY($1)',[names])).rows;
  if(login.some(r=>r.rolcanlogin!==Object.hasOwn(runtimeRoles,r.rolname)))deny('BOOTSTRAP_UNSAFE_LOGIN_STATE');
  // Database identifiers come from the server and are escaped as identifiers.
  const database='"'+target.name.replaceAll('"','""')+'"';
  await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await db.query(`GRANT CONNECT ON DATABASE ${database} TO ${Object.keys(runtimeRoles).join(',')}`);
  await db.query('COMMIT');return {status:'configured',scope:'database-roles-and-migrations-only',replayed:!!existing,roles:Object.keys(runtimeRoles)};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});if(error instanceof BootstrapError)throw error;throw new BootstrapError('BOOTSTRAP_FAILED_TRANSACTION_ROLLED_BACK');}
 finally{db.release();}
}
export async function verifyRuntimeLogins(url,passwords){
 validatePasswords(passwords);
 const results=await Promise.allSettled(Object.keys(runtimeRoles).map(async role=>{
  const connection=new URL(url);connection.username=role;connection.password=passwords[role];
  const db=new Pool({connectionString:connection.href,max:1,connectionTimeoutMillis:5000,query_timeout:5000});db.on('error',()=>{});
  try{const {rows:[r]}=await db.query('SELECT current_user AS name');if(r.name!==role)deny('BOOTSTRAP_RUNTIME_LOGIN_CHECK_FAILED');}
  finally{await db.end();}
 }));
 if(results.some(r=>r.status==='rejected'))deny('BOOTSTRAP_RUNTIME_LOGIN_CHECK_FAILED');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let pool;try{const input=bootstrapInput();pool=new Pool({connectionString:input.url,max:1,connectionTimeoutMillis:10000});pool.on('error',()=>{});const result=await bootstrapDatabase(pool,input.passwords,input.expectedDatabase);await verifyRuntimeLogins(input.url,input.passwords);process.stdout.write(JSON.stringify(result)+'\n');}
 catch(error){process.stderr.write((error instanceof BootstrapError?error.code:'BOOTSTRAP_CONNECTION_FAILED')+'\n');process.exitCode=1;}
 finally{await pool?.end();}
}
