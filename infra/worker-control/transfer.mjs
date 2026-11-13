// Private temporary object transfer. Signed URL travels over stdin, never command arguments/logs.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {S3Client,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {uploadInParts} from './multipart.mjs';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {workerEnvironment,evidenceFile} from './environment.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const target=workerEnvironment(),project=target.project,environment=target.environment,bucketId=target.bucket,directory=target.bundleDirectory;
const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-worker-transfer-20261023'};
let client,bucket,key,uploaded=false;
try{
 const state=JSON.parse(await readFile(target.statePath,'utf8')),bundle=JSON.parse(await readFile(directory+'/bundle.json','utf8'));
 if(state.environment_id!==environment||!/^[-a-f0-9]{36}$/.test(state.id)||!/^[a-f0-9]{64}$/.test(bundle.sha256)||bundle.archive!==`${directory}/${bundle.sha256}.tar.gz`||!Number.isSafeInteger(bundle.bytes)||bundle.bytes<1||bundle.bytes>5_000_000_000)throw new Error('TRANSFER_SCOPE_INVALID');
 const prefix=['sandbox','exec','--id',state.id,'--project',project,'--environment',environment];
 const probe=JSON.parse(execFileSync('railway',[...prefix,'--timeout','20','--','python3 -c '+quote('import json,platform,shutil; print(json.dumps({"arch":platform.machine(),"free":shutil.disk_usage("/opt").free}))')],{encoding:'utf8',timeout:30000,env,stdio:['ignore','pipe','pipe']}));
 if(probe.arch!=='x86_64'||probe.free<bundle.bytes*3)throw new Error('TRANSFER_HOST_CAPACITY_INVALID');
 const c=JSON.parse(execFileSync('railway',['bucket','credentials','--bucket',bucketId,'--environment',environment,'--json'],{encoding:'utf8',timeout:30000,env,stdio:['ignore','pipe','pipe']}));
 bucket=c.bucketName;key='deployment-worker-bundle/'+bundle.sha256+'.tar.gz';
 client=new S3Client({endpoint:c.endpoint,region:c.region,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 uploaded=true;
 await uploadInParts(client,{Bucket:bucket,Key:key,path:bundle.archive,bytes:bundle.bytes,metadata:{sha256:bundle.sha256}});
 console.log('Private image archive uploaded; downloading and hashing on the worker host.');
 const url=await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:900});
 const code=`import sys,hashlib,json,os,urllib.request
from pathlib import Path
root=Path('/opt/desvio/images'); root.mkdir(parents=True,exist_ok=True)
partial=root/'${bundle.sha256}.download'; target=root/'${bundle.sha256}.tar.gz'
h=hashlib.sha256(); total=0
url=sys.stdin.readline().strip()
try:
 with urllib.request.urlopen(url,timeout=60) as response, partial.open('wb') as f:
  while True:
   chunk=response.read(1048576)
   if not chunk: break
   total+=len(chunk)
   if total>${bundle.bytes}: raise RuntimeError('size')
   h.update(chunk); f.write(chunk)
  f.flush(); os.fsync(f.fileno())
 if total!=${bundle.bytes} or h.hexdigest()!='${bundle.sha256}': raise RuntimeError('integrity')
 partial.replace(target)
 print(json.dumps({'sha256':h.hexdigest(),'bytes':total,'verified':True}))
except Exception:
 partial.unlink(missing_ok=True); print('TRANSFER_REMOTE_FAILED',file=sys.stderr); sys.exit(1)`;
 const out=execFileSync('railway',[...prefix,'--timeout','900','--','python3 -c '+quote(code)],{input:url+'\n',encoding:'utf8',timeout:920000,maxBuffer:8192,env,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(out);if(result.sha256!==bundle.sha256||result.bytes!==bundle.bytes||result.verified!==true)throw new Error('TRANSFER_RESULT_MISMATCH');
 await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));uploaded=false;
 const report={checked_at:new Date().toISOString(),sandbox_id:state.id,environment_id:environment,...result,temporary_private_object_removed:true,scope:'Exact Docker archive bytes transferred and hashed on private host; image import and worker readiness not yet proven'};
 await writeFile(evidenceFile(target,'railway-worker-transfer.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(/^TRANSFER_[A-Z_]+$/.test(e.message)?e.message:'TRANSFER_FAILED_CHECK_HOST_BEFORE_RETRY');process.exitCode=1;}
finally{if(uploaded&&client){try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}catch{console.error('TRANSFER_TEMPORARY_OBJECT_CLEANUP_REQUIRED');}}client?.destroy();}
