// Local run stack: paths, ports, generated secrets and per-process environments.
// Everything lives under work/local-stack (git-ignored). Nothing here is ever used by
// staging or production; the processes it configures run with APP_MODE=development.
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const STACK_DIR=resolve(ROOT,'work/local-stack');
export const PATHS=Object.freeze({
 secrets:join(STACK_DIR,'secrets.json'),
 state:join(STACK_DIR,'state.json'),
 logs:join(STACK_DIR,'logs'),
 postgres:join(STACK_DIR,'postgres'),
 garage:join(STACK_DIR,'garage'),
 clamav:join(STACK_DIR,'clamav'),
 temporal:join(STACK_DIR,'temporal'),
 mail:join(STACK_DIR,'mail'),
 webBuild:join(STACK_DIR,'web-build.json'),
});
export const LABEL='desvio.purpose=local-stack';
export const CONTAINERS=Object.freeze({postgres:'desvio-local-postgres',storage:'desvio-local-storage',scanner:'desvio-local-scanner'});
export const DATABASE_NAME='desvio';
export const TEMPORAL_NAMESPACE='desvio-local';
export const TEMPORAL_TASK_QUEUE='assets';
export const BUCKET='desvio-local';
export const SENDER='accounts@desvio.localhost';

/** Fixed loopback ports so URLs and stored settings survive restarts. --web-port overrides the web port. */
export const DEFAULT_PORTS=Object.freeze({web:3000,api:3101,postgres:55432,storage:53900,scanner:53310,temporal:57233,temporalHttp:57243,temporalMetrics:57253,smtp:52525,mock:54010});

const hex=bytes=>randomBytes(bytes).toString('hex');
const ROLE_KEYS=['APP_DATABASE_PASSWORD','AUTH_DATABASE_PASSWORD','MAIL_DATABASE_PASSWORD','WORKER_DATABASE_PASSWORD','DISPATCHER_DATABASE_PASSWORD','POSTIZ_PROVISIONER_DATABASE_PASSWORD'];

export function ensureDirectories(){
 for(const dir of [STACK_DIR,...Object.values(PATHS).filter(p=>!p.endsWith('.json'))])mkdirSync(dir,{recursive:true,mode:0o700});
}

function freshSecrets(){
 const roles=Object.fromEntries(ROLE_KEYS.map(key=>[key,hex(32)]));
 return {version:1,postgresPassword:hex(32),roles,authSecret:hex(32),mailEncryptionKey:hex(32),oauthEncryptionKey:hex(32),
  storageAccessKeyId:`GK${hex(12)}`,storageSecretAccessKey:hex(32),garageRpcSecret:hex(32)};
}
/** Local-only generated credentials, created once and kept with the persistent data they protect. */
export function loadSecrets(){
 ensureDirectories();
 if(!existsSync(PATHS.secrets)){writeFileSync(PATHS.secrets,JSON.stringify(freshSecrets(),null,1)+'\n',{mode:0o600});}
 chmodSync(PATHS.secrets,0o600);
 const secrets=JSON.parse(readFileSync(PATHS.secrets,'utf8'));
 if(secrets.version!==1||ROLE_KEYS.some(k=>!/^[a-f0-9]{64}$/.test(secrets.roles?.[k]??'')))throw new Error('work/local-stack/secrets.json is damaged; run "node scripts/local-stack.mjs reset --yes" to start over');
 return secrets;
}

export function readState(){try{return JSON.parse(readFileSync(PATHS.state,'utf8'));}catch{return null;}}
export function writeState(state){writeFileSync(PATHS.state,JSON.stringify(state,null,1)+'\n',{mode:0o600});}

export const databaseUrl=(ports,user,password)=>`postgresql://${user}:${password}@127.0.0.1:${ports.postgres}/${DATABASE_NAME}`;

/** Environment for every Desvio process: the shell environment minus provider keys and
 * anything that could redirect a process to another database, storage or provider. */
function baseEnvironment(){
 const env={...process.env};
 for(const key of Object.keys(env))if(/^(OPENAI_|VECTEEZY_|POSTFORME_|GEMINI_|RUNWAY|HIGGSFIELD|PEXELS_|DESVIO_DEV_|DATABASE_URL|MIGRATION_|PG[A-Z]+$|S3_|AWS_|SMTP_|RESEND_|TEMPORAL_|APP_|API_ORIGIN|AUTH_|MAIL_|POSTIZ_|DOCKER_HOST$|DOCKER_CONTEXT$)/.test(key))delete env[key];
 return {...env,NEXT_TELEMETRY_DISABLED:'1'};
}

function storageEnvironment(ports,secrets){
 return {S3_ENDPOINT:`http://127.0.0.1:${ports.storage}`,S3_REGION:'garage',S3_BUCKET:BUCKET,S3_ACCESS_KEY_ID:secrets.storageAccessKeyId,S3_SECRET_ACCESS_KEY:secrets.storageSecretAccessKey};
}

/** Provider settings for one mode. Live keys come only from the operator's shell (`liveKeys`). */
export function providerEnvironment({mode,ports,liveKeys},service){
 if(mode==='mock'){
  const mock=`http://127.0.0.1:${ports.mock}`;
  // The OpenAI SDK honours OPENAI_BASE_URL; no product change is needed to reach the mock.
  // Post for Me: a development-only mock on the next port (mock-postforme.mjs); the product accepts
  // POSTFORME_BASE_URL only in development/test and only on loopback. Vecteezy is not mocked.
  const postforme={POSTFORME_ENABLED:'true',POSTFORME_API_KEY:'local-mock-postforme-key',POSTFORME_BASE_URL:`http://127.0.0.1:${ports.mock+1}`};
  return service==='worker'?{OPENAI_API_KEY:'local-mock-openai-key',OPENAI_BASE_URL:`${mock}/v1`,...postforme}:{...postforme,POSTFORME_PUBLISHING_ENABLED:'true'};
 }
 const env={};
 const pick=(...keys)=>{for(const key of keys)if(liveKeys[key])env[key]=liveKeys[key];};
 if(service==='worker')pick('OPENAI_API_KEY','VECTEEZY_API_KEY','VECTEEZY_ACCOUNT_ID','GEMINI_API_KEY');
 if(liveKeys.POSTFORME_API_KEY){pick('POSTFORME_API_KEY');env.POSTFORME_ENABLED='true';if(service==='api')env.POSTFORME_PUBLISHING_ENABLED='true';}
 return env;
}

export function apiEnvironment(context){
 const {ports,secrets}=context,origin=`http://127.0.0.1:${ports.web}`;
 return {...baseEnvironment(),APP_MODE:'development',APP_ORIGIN:origin,PORT:String(ports.api),LISTEN_HOST:'127.0.0.1',
  AUTH_SECRET:secrets.authSecret,MAIL_ENCRYPTION_KEY:secrets.mailEncryptionKey,PUBLIC_SIGNUP_ENABLED:'true',
  AUTH_DATABASE_URL:databaseUrl(ports,'desvio_auth',secrets.roles.AUTH_DATABASE_PASSWORD),
  APP_DATABASE_URL:databaseUrl(ports,'desvio_app',secrets.roles.APP_DATABASE_PASSWORD),
  MAIL_DATABASE_URL:databaseUrl(ports,'desvio_mail',secrets.roles.MAIL_DATABASE_PASSWORD),
  MAIL_PROVIDER:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(ports.smtp),SMTP_SECURE:'false',SMTP_FROM:SENDER,
  ...storageEnvironment(ports,secrets),
  ...(context.images.render?{RENDER_RUNTIME_IMAGE:context.images.render}:{}),
  ...providerEnvironment(context,'api')};
}

export function workerEnvironment(context){
 const {ports,secrets,images}=context;
 const imageEnv=Object.fromEntries(Object.entries({SKILL_RUNTIME_IMAGE:images.skill,RENDER_RUNTIME_IMAGE:images.render,DOCUMENT_PARSER_IMAGE:images.document,WEBSITE_RENDER_IMAGE:images.website,VIDEO_RUNTIME_IMAGE:images.video}).filter(([,v])=>v));
 return {...baseEnvironment(),APP_MODE:'development',
  WORKER_DATABASE_URL:databaseUrl(ports,'desvio_worker',secrets.roles.WORKER_DATABASE_PASSWORD),
  DISPATCHER_DATABASE_URL:databaseUrl(ports,'desvio_dispatcher',secrets.roles.DISPATCHER_DATABASE_PASSWORD),
  TEMPORAL_ADDRESS:`127.0.0.1:${ports.temporal}`,TEMPORAL_NAMESPACE,TEMPORAL_TASK_QUEUE,
  CLAMD_HOST:'127.0.0.1',CLAMD_PORT:String(ports.scanner),
  ...storageEnvironment(ports,secrets),...imageEnv,...providerEnvironment(context,'worker')};
}

export function webEnvironment({ports}){
 return {...baseEnvironment(),API_ORIGIN:`http://127.0.0.1:${ports.api}`,S3_BROWSER_ORIGIN:`http://127.0.0.1:${ports.storage}`};
}
