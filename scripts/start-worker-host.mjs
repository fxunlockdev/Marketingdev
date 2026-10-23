// Trusted, dedicated-host control only. Never expose through a customer route.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerConfigFromEnv} from '../dist/config.js';
const allowed=['APP_MODE','WORKER_DATABASE_URL','DISPATCHER_DATABASE_URL','TEMPORAL_ADDRESS','TEMPORAL_NAMESPACE','TEMPORAL_TASK_QUEUE','POSTIZ_PROVISION_TASK_QUEUE','S3_ENDPOINT','S3_REGION','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','CLAMD_HOST','CLAMD_PORT','DOCUMENT_PARSER_IMAGE','SKILL_RUNTIME_IMAGE','RENDER_RUNTIME_IMAGE','VIDEO_RUNTIME_IMAGE','OPENAI_API_KEY','GEMINI_API_KEY','VIDEO_ENABLED','VIDEO_ENCRYPTION_KEY','HIGGSFIELD_CREDENTIALS','HIGGSFIELD_OUTPUT_ORIGINS','POSTIZ_ENABLED','POSTIZ_PUBLISHING_ENABLED','POSTIZ_BASE_URL','POSTIZ_MEDIA_ORIGINS','POSTIZ_CALLBACK_ORIGIN','POSTIZ_ENCRYPTION_KEY','OAUTH_ENCRYPTION_KEY'];
const imageKeys=['DESVIO_WORKER_IMAGE','DOCUMENT_PARSER_IMAGE','SKILL_RUNTIME_IMAGE','RENDER_RUNTIME_IMAGE','VIDEO_RUNTIME_IMAGE'];
export function workerHostSpec(env){
 if(env.DOCKER_HOST||env.DOCKER_CONTEXT)throw new Error('WORKER_LOCAL_DAEMON_REQUIRED');
 for(const key of ['MIGRATION_DATABASE_URL','AUTH_DATABASE_URL','APP_DATABASE_URL','MAIL_DATABASE_URL','SMTP_PASSWORD','POSTIZ_PROVISIONER_DATABASE_URL'])if(env[key])throw new Error('WORKER_EXCESS_PRIVILEGE');
 for(const key of imageKeys)if(!/^sha256:[a-f0-9]{64}$/.test(env[key]??''))throw new Error('WORKER_PIN_REQUIRED');
 for(const key of ['VIDEO_ENABLED','POSTIZ_ENABLED','POSTIZ_PUBLISHING_ENABLED'])if(!['true','false'].includes(env[key]))throw new Error('WORKER_EXPLICIT_FLAGS_REQUIRED');
 const values=Object.fromEntries(allowed.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
 try{workerConfigFromEnv(values);}catch{throw new Error('WORKER_CONFIGURATION_INVALID');}
 const configurationHash=createHash('sha256').update(JSON.stringify({image:env.DESVIO_WORKER_IMAGE,values})).digest('hex');
 return {image:env.DESVIO_WORKER_IMAGE,values,configurationHash,images:imageKeys.map(k=>env[k])};
}
export function startWorkerHost(env=process.env,{check=false}={}){
 const spec=workerHostSpec(env),name='desvio-trusted-worker';
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:env.PATH,...spec.values}}).trim();
 for(const image of spec.images){const info=JSON.parse(docker('image','inspect',image))[0];if(info.Architecture!=='amd64'||info.Os!=='linux')throw new Error('WORKER_ARCHITECTURE_MISMATCH');}
 const socket='/var/run/docker.sock',gid=statSync(socket).gid;
 if(!statSync(socket).isSocket())throw new Error('WORKER_LOCAL_SOCKET_REQUIRED');
 const inspect=()=>{const ids=docker('ps','-aq','--filter',`name=^/${name}$`);if(!ids)return null;return JSON.parse(docker('inspect',ids))[0];};
 const prior=inspect();
 const verify=info=>{if(info.Image!==spec.image||info.Config.Labels?.['desvio.configuration']!==spec.configurationHash||info.Config.Labels?.['desvio.purpose']!=='trusted-worker')throw new Error('WORKER_EXISTING_CONFIGURATION_DIFFERS');};
 if(prior)verify(prior);
 if(check)return {status:'configuration_checked',existing:prior?prior.State.Status:'absent',scope:'Local image/configuration only; no service or job readiness claim'};
 if(!prior){
  try{docker('create','--name',name,'--label','desvio.purpose=trusted-worker','--label',`desvio.configuration=${spec.configurationHash}`,'--restart','unless-stopped','--network','host','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--group-add',String(gid),'--pids-limit','256','--memory','2g','--memory-swap','2g','--cpus','2','--stop-timeout','120','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--mount',`type=bind,source=${socket},target=${socket}`,...Object.keys(spec.values).flatMap(k=>['-e',k]),spec.image);}
  catch{const raced=inspect();if(!raced)throw new Error('WORKER_CREATE_FAILED');verify(raced);}
 }
 const current=inspect();verify(current);
 if(!current.State.Running)docker('start',name);
 const started=inspect();verify(started);
 return {status:started.State.Status,image:spec.image,scope:'Container process only; Temporal registration, database roles and end-to-end jobs must be checked separately'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.slice(2).some(a=>a!=='--check'))throw new Error('WORKER_USAGE');console.log(JSON.stringify(startWorkerHost(process.env,{check:process.argv.includes('--check')})));}
 catch(e){console.error(/^WORKER_[A-Z_]+$/.test(e.message)?e.message:'WORKER_HOST_OPERATION_FAILED');process.exitCode=1;}
}
