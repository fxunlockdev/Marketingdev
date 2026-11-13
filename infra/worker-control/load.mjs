// Import the verified, transferred image archive into the private host's Docker daemon.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {workerEnvironment,evidenceFile} from './environment.mjs';
import {validateWorkerInventory} from './image-inventory.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-worker-load'};
try{
 const target=workerEnvironment();
 const state=JSON.parse(await readFile(target.statePath,'utf8'));
 const bundle=JSON.parse(await readFile(target.bundleDirectory+'/bundle.json','utf8'));
 const transfer=JSON.parse(await readFile(target.evidence('railway-worker-transfer.json'),'utf8'));
 if(state.project_id!==target.project||state.environment_id!==target.environment||!/^[-a-f0-9]{36}$/.test(state.id))throw Error('LOAD_SCOPE_INVALID');
 if(!/^[a-f0-9]{64}$/.test(bundle.sha256)||transfer.sha256!==bundle.sha256||transfer.sandbox_id!==state.id||transfer.verified!==true||transfer.temporary_private_object_removed!==true)throw Error('LOAD_TRANSFER_NOT_VERIFIED');
 const images=validateWorkerInventory({images:bundle.images}).map(i=>i.image_id);
 const code=`import json,subprocess,sys
images=json.load(sys.stdin)
archive='/opt/desvio/images/${bundle.sha256}.tar.gz'
r=subprocess.run(['docker','load','--input',archive],capture_output=True,text=True)
if r.returncode: print('LOAD_REMOTE_FAILED',file=sys.stderr); sys.exit(1)
found=[]
for image in images:
 info=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
 found.append({'id':info['Id'],'architecture':info['Architecture'],'os':info['Os'],'user':info['Config']['User']})
print(json.dumps({'images':found}))`;
 const out=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',target.project,'--environment',target.environment,'--timeout','900','--','python3 -c '+quote(code)],{input:JSON.stringify(images),encoding:'utf8',timeout:920000,maxBuffer:1024*1024,env,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(out);
 if(images.some(id=>!result.images.some(i=>i.id===id&&i.architecture==='amd64'&&i.os==='linux')))throw Error('LOAD_IMAGE_MISMATCH');
 const report={checked_at:new Date().toISOString(),sandbox_id:state.id,environment_id:target.environment,archive_sha256:bundle.sha256,...result,scope:'Images imported into the private host daemon; scanner, worker start and registration are checked separately'};
 await writeFile(evidenceFile(target,'railway-worker-load.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(/^(?:LOAD|WORKER)_[A-Z_]+$/.test(e.message)?e.message:'LOAD_FAILED_CHECK_HOST_BEFORE_RETRY');process.exitCode=1;}
