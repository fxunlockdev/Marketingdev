// Real, disposable local services. No cloud credentials or externally supplied endpoint.
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm,readFile,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer,createConnection} from 'node:net';
import {setTimeout} from 'node:timers/promises';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {S3Client,HeadBucketCommand} from '@aws-sdk/client-s3';
const GARAGE='dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
const CLAM='clamav/clamav@sha256:b5fffca589275b71a4c610afc69d32a8d9c6cf4454c6d06529ddb08da17d0c30';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
export async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
async function runtime(){
  const pins={darwin_arm64:'41e0425378fcb4fb5766340b97435e20fe47bbff2d7bf644ec2d51f7662b7c56',darwin_x64:'48cdd6c84c56e27ae8e4d9a47052b89289a9c552dee029b49dd312c6fb72873f',linux_x64:'09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5',linux_arm64:'6c57c352d52fc3df34412376fd9ba6f74b7e3ace8e426e6cba8600156d36a145'};
  const platform=`${process.platform}_${process.arch}`,hash=pins[platform];if(!hash)throw new Error('Unsupported Temporal test platform');
  const dir=resolve('work/runtime');await mkdir(dir,{recursive:true});
  const archive=resolve(dir,`temporal-1.9.1-${platform}.tgz`),binary=resolve(dir,`temporal-1.9.1-${platform}`);
  let bytes;try{bytes=await readFile(archive);}catch{const response=await fetch(`https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_${process.platform}_${process.arch==='x64'?'amd64':'arm64'}.tar.gz`,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Unable to download pinned test server');bytes=Buffer.from(await response.arrayBuffer());}
  if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Temporal test archive checksum mismatch');await writeFile(archive,bytes,{mode:0o600});
  const temp=await mkdtemp(resolve(dir,'extract-'));try{execFileSync('tar',['-xzf',archive,'-C',temp,'temporal']);await writeFile(binary,await readFile(resolve(temp,'temporal')),{mode:0o700});await chmod(binary,0o700);}finally{await rm(temp,{recursive:true,force:true});}
  return binary;
}
export async function startAssetServices(){
  const dir=await mkdtemp(resolve('work/asset-services-')),containers=[];let temporal;const keepAlive=setInterval(()=>{},1000);
  const close=async()=>{try{await temporal?.teardown();}finally{for(const name of containers.reverse()){try{docker('rm','-f',name);}catch{}}try{await rm(dir,{recursive:true,force:true});}finally{clearInterval(keepAlive);}}};
  try{
    const storage={endpoint:`http://127.0.0.1:${await port()}`,region:'garage',bucket:'desvio-test',accessKeyId:`GK${randomBytes(16).toString('hex')}`,secretAccessKey:randomBytes(32).toString('hex')};
    const garageConfig=resolve(dir,'garage.toml');await writeFile(garageConfig,`metadata_dir = "/tmp/meta"\ndata_dir = "/tmp/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "127.0.0.1:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\nroot_domain = ".s3.localhost"\n`,{mode:0o600});
    const gn=`desvio-storage-${randomUUID()}`;docker('run','--rm','-d','--name',gn,'--label','desvio.purpose=isolated-test','-p',`127.0.0.1:${new URL(storage.endpoint).port}:3900`,'-v',`${garageConfig}:/etc/garage.toml:ro`,'-e',`GARAGE_DEFAULT_ACCESS_KEY=${storage.accessKeyId}`,'-e',`GARAGE_DEFAULT_SECRET_KEY=${storage.secretAccessKey}`,'-e',`GARAGE_DEFAULT_BUCKET=${storage.bucket}`,GARAGE,'/garage','server','--single-node','--default-bucket');containers.push(gn);
    const client=new S3Client({endpoint:storage.endpoint,region:storage.region,forcePathStyle:true,credentials:{accessKeyId:storage.accessKeyId,secretAccessKey:storage.secretAccessKey}});
    let ready=false;for(let i=0;i<60;i++){try{await client.send(new HeadBucketCommand({Bucket:storage.bucket}),{abortSignal:AbortSignal.timeout(1000)});ready=true;break;}catch{await setTimeout(250);}}client.destroy();if(!ready)throw new Error('Local private object store did not start');
    const scanner={host:'127.0.0.1',port:await port()},clamConfig=resolve(dir,'clamd.conf');
    await writeFile(clamConfig,'Foreground yes\nTCPSocket 3310\nTCPAddr 0.0.0.0\nDatabaseDirectory /var/lib/clamav\nStreamMaxLength 20M\nMaxFileSize 20M\nMaxScanSize 40M\nMaxRecursion 8\nMaxFiles 1000\nMaxThreads 2\nConcurrentDatabaseReload no\nAlertExceedsMax yes\n',{mode:0o644});
    const cn=`desvio-scanner-${randomUUID()}`;docker('run','--rm','-d','--name',cn,'--label','desvio.purpose=isolated-test','--platform','linux/amd64','-p',`127.0.0.1:${scanner.port}:3310`,'-v',`${clamConfig}:/etc/clamav/desvio.conf:ro`,'--entrypoint','clamd',CLAM,'--config-file=/etc/clamav/desvio.conf');containers.push(cn);
    ready=false;for(let i=0;i<160;i++){try{await new Promise((res,rej)=>{const s=createConnection(scanner);s.setTimeout(1000,()=>{s.destroy();rej(new Error('timeout'));});s.on('connect',()=>s.write('zPING\0'));s.on('error',rej);s.on('end',()=>rej(new Error('scanner closed')));s.on('data',b=>{s.destroy();b.toString().startsWith('PONG')?res():rej(new Error('ping'));});});ready=true;break;}catch{await setTimeout(500);}}if(!ready)throw new Error('Local full-signature scanner did not start');
    const address=`127.0.0.1:${await port()}`;
    temporal=await TestWorkflowEnvironment.createLocal({server:{executable:{type:'existing-path',path:await runtime()},dbFilename:resolve(dir,'temporal.db'),namespace:'desvio-test',ip:'127.0.0.1',port:Number(address.split(':')[1]),ui:false,log:{level:'error',format:'json'}}});
    console.log('Actual local Garage 2.4.1, ClamAV 1.5.4 and Temporal CLI 1.9.1 services ready; no paid providers');
    return {storage,scanner,address,close};
  }catch(error){await close();throw error;}
}
