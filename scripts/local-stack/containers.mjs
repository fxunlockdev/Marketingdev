// Persistent local containers: PostgreSQL, Garage object storage and ClamAV.
// Pinned images are the same ones the disposable test stack uses; data stays under work/local-stack.
import {execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Pool} from 'pg';
import {S3Client,HeadBucketCommand,PutBucketCorsCommand} from '@aws-sdk/client-s3';
import {PATHS,LABEL,CONTAINERS,DATABASE_NAME,BUCKET} from './config.mjs';

export const POSTGRES_IMAGE='postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
const GARAGE_IMAGE='dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
const CLAMAV_IMAGE='clamav/clamav@sha256:b5fffca589275b71a4c610afc69d32a8d9c6cf4454c6d06529ddb08da17d0c30';

export const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();

export function containerState(name){
 try{return JSON.parse(docker('inspect','--format','{{json .State}}',name));}catch{return null;}
}
/** Only containers this stack labelled are ever removed. */
export function removeContainer(name){
 const labels=(()=>{try{return docker('inspect','--format','{{json .Config.Labels}}',name);}catch{return '';}})();
 if(!labels)return false;
 if(!labels.includes('"desvio.purpose":"local-stack"'))throw new Error(`Refusing to remove ${name}: it was not created by the local stack`);
 docker('rm','-f',name);return true;
}
function startContainer(name,args){
 const state=containerState(name);
 if(state?.Running)return 'running';
 if(state)removeContainer(name);
 docker('run','-d','--name',name,'--label',LABEL,...args);
 return 'started';
}

export async function startPostgres({ports,secrets}){
 mkdirSync(PATHS.postgres,{recursive:true});
 const result=startContainer(CONTAINERS.postgres,['-p',`127.0.0.1:${ports.postgres}:5432`,'-v',`${PATHS.postgres}:/var/lib/postgresql/data`,
  '-e',`POSTGRES_PASSWORD=${secrets.postgresPassword}`,'-e',`POSTGRES_DB=${DATABASE_NAME}`,POSTGRES_IMAGE]);
 const pool=adminPool({ports,secrets});
 try{
  for(const deadline=Date.now()+120000;Date.now()<deadline;){
   try{await pool.query('SELECT 1');return result;}catch{await sleep(300);}
  }
 }finally{await pool.end();}
 throw new Error(`PostgreSQL did not become ready; see "docker logs ${CONTAINERS.postgres}"`);
}
export function adminPool({ports,secrets},max=2){
 const pool=new Pool({host:'127.0.0.1',port:ports.postgres,user:'postgres',password:secrets.postgresPassword,database:DATABASE_NAME,max,connectionTimeoutMillis:2000});
 pool.on('error',()=>{});return pool;
}

export async function startStorage({ports,secrets}){
 const meta=join(PATHS.garage,'meta'),data=join(PATHS.garage,'data'),config=join(PATHS.garage,'garage.toml');
 mkdirSync(meta,{recursive:true});mkdirSync(data,{recursive:true});
 writeFileSync(config,`metadata_dir = "/var/lib/garage/meta"\ndata_dir = "/var/lib/garage/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "127.0.0.1:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${secrets.garageRpcSecret}"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\nroot_domain = ".s3.localhost"\n`,{mode:0o600});
 const result=startContainer(CONTAINERS.storage,['-p',`127.0.0.1:${ports.storage}:3900`,'-v',`${config}:/etc/garage.toml:ro`,'-v',`${meta}:/var/lib/garage/meta`,'-v',`${data}:/var/lib/garage/data`,
  '-e',`GARAGE_DEFAULT_ACCESS_KEY=${secrets.storageAccessKeyId}`,'-e',`GARAGE_DEFAULT_SECRET_KEY=${secrets.storageSecretAccessKey}`,'-e',`GARAGE_DEFAULT_BUCKET=${BUCKET}`,
  GARAGE_IMAGE,'/garage','server','--single-node','--default-bucket']);
 const client=storageClient({ports,secrets});
 try{
  for(const deadline=Date.now()+60000;Date.now()<deadline;){
   try{await client.send(new HeadBucketCommand({Bucket:BUCKET}),{abortSignal:AbortSignal.timeout(1000)});
    // Browser uploads go straight to storage from the web origin.
    await client.send(new PutBucketCorsCommand({Bucket:BUCKET,CORSConfiguration:{CORSRules:[{AllowedOrigins:[`http://127.0.0.1:${ports.web}`],AllowedMethods:['PUT','GET'],AllowedHeaders:['content-type'],MaxAgeSeconds:300}]}}));
    return result;
   }catch{await sleep(300);}
  }
 }finally{client.destroy();}
 throw new Error(`Object storage did not become ready; see "docker logs ${CONTAINERS.storage}"`);
}
export function storageClient({ports,secrets}){
 return new S3Client({endpoint:`http://127.0.0.1:${ports.storage}`,region:'garage',forcePathStyle:true,credentials:{accessKeyId:secrets.storageAccessKeyId,secretAccessKey:secrets.storageSecretAccessKey}});
}

/** Starts the scanner without waiting: signature refresh under amd64 emulation can take minutes. */
export function startScanner({ports}){
 mkdirSync(PATHS.clamav,{recursive:true});
 const config=join(PATHS.clamav,'clamd.conf');
 writeFileSync(config,'Foreground yes\nTCPSocket 3310\nTCPAddr 0.0.0.0\nDatabaseDirectory /var/lib/clamav\nStreamMaxLength 20M\nMaxFileSize 20M\nMaxScanSize 40M\nMaxRecursion 8\nMaxFiles 1000\nMaxThreads 2\nConcurrentDatabaseReload no\nAlertExceedsMax yes\n',{mode:0o644});
 return startContainer(CONTAINERS.scanner,['--platform','linux/amd64','-p',`127.0.0.1:${ports.scanner}:3310`,'-v',`${config}:/etc/clamav/desvio.conf:ro`,
  '--entrypoint','sh',CLAMAV_IMAGE,'-c','freshclam --stdout --log=/tmp/freshclam.log && exec clamd --config-file=/etc/clamav/desvio.conf']);
}
export function scannerPing({ports},timeout=1500){
 return new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port:ports.scanner});
  const done=ok=>{socket.destroy();resolve(ok);};
  socket.setTimeout(timeout,()=>done(false));
  socket.on('connect',()=>socket.write('zPING\0'));
  socket.on('error',()=>done(false));socket.on('end',()=>done(false));
  socket.on('data',b=>done(b.toString().startsWith('PONG')));
 });
}
export async function waitForScanner(context,timeoutMs=900000){
 for(const deadline=Date.now()+timeoutMs;Date.now()<deadline;){
  if(await scannerPing(context))return;
  const state=containerState(CONTAINERS.scanner);
  if(!state||['exited','dead'].includes(state.Status))throw new Error(`The malware scanner stopped; see "docker logs ${CONTAINERS.scanner}"`);
  await sleep(2000);
 }
 throw new Error('The malware scanner did not become ready in 15 minutes');
}
