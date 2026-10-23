import {providerSettings} from './provider-settings.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('work/railway-worker-host.json')),secrets=JSON.parse(readFileSync('work/railway-dev-runtime-secrets.json')),images=JSON.parse(readFileSync('docs/evidence/worker-image-inventory.json')).images;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cliEnv={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-worker-rollout-20261023'};
const call=args=>execFileSync('railway',args,{encoding:'utf8',env:cliEnv,stdio:['ignore','pipe','pipe'],timeout:30000});
try{
 if(secrets.environment_id!==state.environment_id)throw Error();
 const db=JSON.parse(call(['variables','--project',state.project_id,'--environment',state.environment_id,'--service','758bf0c1-56b5-452f-be8d-fe67af927267','--json']));
 const s3=JSON.parse(call(['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment',state.environment_id,'--json']));
 const url=(role,key)=>{const u=new URL(db.DATABASE_URL);u.username=role;u.password=secrets.passwords[key];return u.toString();};
 const image=role=>images.find(i=>i.role===role).image_id;
 const values={APP_MODE:'staging',WORKER_DATABASE_URL:url('desvio_worker','WORKER_DATABASE_PASSWORD'),DISPATCHER_DATABASE_URL:url('desvio_dispatcher','DISPATCHER_DATABASE_PASSWORD'),TEMPORAL_ADDRESS:'desvio-dev-temporal.railway.internal:7233',TEMPORAL_NAMESPACE:'desvio-dev',TEMPORAL_TASK_QUEUE:'desvio-assets',POSTIZ_PROVISION_TASK_QUEUE:'desvio-provision',S3_ENDPOINT:s3.endpoint,S3_REGION:s3.region,S3_BUCKET:s3.bucketName,S3_ACCESS_KEY_ID:s3.accessKeyId,S3_SECRET_ACCESS_KEY:s3.secretAccessKey,CLAMD_HOST:'desvio-dev-scanner.railway.internal',CLAMD_PORT:'3310',DOCUMENT_PARSER_IMAGE:image('documents'),SKILL_RUNTIME_IMAGE:image('skills'),RENDER_RUNTIME_IMAGE:image('static_renderer'),VIDEO_RUNTIME_IMAGE:image('video_renderer'),DESVIO_WORKER_IMAGE:image('trusted_worker'),VIDEO_ENABLED:'false',POSTIZ_ENABLED:'false',POSTIZ_PUBLISHING_ENABLED:'false'};
 const providers=providerSettings(JSON.parse(call(['variables','--project',state.project_id,'--environment',state.environment_id,'--service','0d25c782-f1bf-4480-b136-b04e231e8279','--json'])));
 Object.assign(values,providers);
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
 const report={checked_at:new Date().toISOString(),sandbox_id:state.id,...JSON.parse(result)};writeFileSync('docs/evidence/railway-worker-start.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('DEV_WORKER_START_FAILED_RECONCILE');process.exitCode=1;}
