import {validateWorkerInventory} from './image-inventory.mjs';
import {devSocialSettings} from './social-settings.mjs';
import {providerRuntimeSettings} from './provider-settings.mjs';
import {workerHostSpec} from '../../scripts/start-worker-host.mjs';
import {workerReadiness,readinessProbe} from './readiness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cliEnv={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-worker-rollout-20261023'};
const call=args=>execFileSync('railway',args,{encoding:'utf8',env:cliEnv,stdio:['ignore','pipe','pipe'],timeout:30000});
export function loadDevWorker(){
 const state=JSON.parse(readFileSync('work/railway-worker-host.json')),secrets=JSON.parse(readFileSync('work/railway-dev-runtime-secrets.json')),images=JSON.parse(readFileSync('docs/evidence/worker-image-inventory.json')).images;
 if(secrets.environment_id!==state.environment_id||state.project_id!=='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12'||state.environment_id!=='6a760b10-9ed8-4f01-9c4a-77a25919755a')throw Error();
 const db=JSON.parse(call(['variables','--project',state.project_id,'--environment',state.environment_id,'--service','758bf0c1-56b5-452f-be8d-fe67af927267','--json']));
 const s3=JSON.parse(call(['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment',state.environment_id,'--json']));
 const url=(role,key)=>{const u=new URL(db.DATABASE_URL);u.username=role;u.password=secrets.passwords[key];return u.toString();};
 validateWorkerInventory({images});
 const image=role=>images.find(i=>i.role===role).image_id;
 const values={APP_MODE:'staging',WORKER_DATABASE_URL:url('desvio_worker','WORKER_DATABASE_PASSWORD'),DISPATCHER_DATABASE_URL:url('desvio_dispatcher','DISPATCHER_DATABASE_PASSWORD'),TEMPORAL_ADDRESS:'desvio-dev-temporal.railway.internal:7233',TEMPORAL_NAMESPACE:'desvio-dev',TEMPORAL_TASK_QUEUE:'desvio-assets',POSTIZ_PROVISION_TASK_QUEUE:'desvio-provision',S3_ENDPOINT:s3.endpoint,S3_REGION:s3.region,S3_BUCKET:s3.bucketName,S3_ACCESS_KEY_ID:s3.accessKeyId,S3_SECRET_ACCESS_KEY:s3.secretAccessKey,CLAMD_HOST:'desvio-dev-scanner.railway.internal',CLAMD_PORT:'3310',DOCUMENT_PARSER_IMAGE:image('documents'),SKILL_RUNTIME_IMAGE:image('skills'),RENDER_RUNTIME_IMAGE:image('static_renderer'),VIDEO_RUNTIME_IMAGE:image('video_renderer'),DESVIO_WORKER_IMAGE:image('trusted_worker'),VIDEO_ENABLED:'false',POSTIZ_ENABLED:'false',POSTIZ_PUBLISHING_ENABLED:'false'};
 const websiteImage=images.find(i=>i.role==='website_renderer');
 if(websiteImage)values.WEBSITE_RENDER_IMAGE=websiteImage.image_id;
 const providers=providerRuntimeSettings(JSON.parse(call(['variables','--project',state.project_id,'--environment',state.environment_id,'--service','0d25c782-f1bf-4480-b136-b04e231e8279','--json'])));
 Object.assign(values,providers);
 const socialPath='work/postiz-dev-infrastructure-secrets.json';
 if(existsSync(socialPath)){
  const social=JSON.parse(readFileSync(socialPath));
  if(social.social_enabled===true){
   const api=JSON.parse(call(['variables','--project',state.project_id,'--environment',state.environment_id,'--service','21260f12-2ad2-413c-9f67-2a1c4d6f8c83','--json']));
   const settings=devSocialSettings(social,api.OAUTH_ENCRYPTION_KEY);
   for(const probe of ['check-postiz.mjs','check-provisioner.mjs'])execFileSync('node',['infra/worker-control/'+probe],{encoding:'utf8',timeout:80000,stdio:['ignore','pipe','pipe']});
   Object.assign(values,settings);
  }
 }
 return {state,values,spec:workerHostSpec(values),adminURL:db.DATABASE_URL};
}
export function inspectDevWorker({state,spec}){
  const observed=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',state.project_id,'--environment',state.environment_id,'--timeout','30','--','python3 -c '+quote(readinessProbe)],{input:JSON.stringify({images:spec.images}),env:cliEnv,encoding:'utf8',timeout:40000,stdio:['pipe','pipe','pipe']});
 return JSON.parse(observed);
}
export function startDevWorker({state,values}){
 const code=`import sys,json,subprocess,os
values=json.load(sys.stdin)
env=dict(os.environ,**values)
args=['docker','run','--rm','--network','host','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--group-add',str(os.stat('/var/run/docker.sock').st_gid),'--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock']
for key in values: args+=['-e',key]
args += [values['DESVIO_WORKER_IMAGE'],'node','scripts/start-worker-host.mjs']
p=subprocess.run(args,env=env,capture_output=True,text=True)
if p.returncode: print('WORKER_START_FAILED',file=sys.stderr);sys.exit(1)
print(p.stdout,end='')`;
 const result=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',state.project_id,'--environment',state.environment_id,'--timeout','90','--','python3 -c '+quote(code)],{input:JSON.stringify(values),env:cliEnv,encoding:'utf8',timeout:100000,stdio:['pipe','pipe','pipe']});
 return {checked_at:new Date().toISOString(),sandbox_id:state.id,...JSON.parse(result)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
try{
 if(process.argv.slice(2).some(a=>a!=='--check')||process.argv.length>3)throw Error('WORKER_USAGE');
 const context=loadDevWorker(),check=process.argv.includes('--check');
 const report=check?{checked_at:new Date().toISOString(),sandbox_id:context.state.id,...workerReadiness(context.spec,inspectDevWorker(context))}:startDevWorker(context);
 writeFileSync(check?'docs/evidence/railway-worker-readiness.json':'docs/evidence/railway-worker-start.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(/^(?:INVALID_(?:PROVIDER|VIDEO)_SETTINGS|WORKER_[A-Z_]+)$/.test(e.message)?e.message:'DEV_WORKER_START_FAILED_RECONCILE');process.exitCode=1;}

}
