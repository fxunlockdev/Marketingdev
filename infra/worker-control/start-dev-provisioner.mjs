import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {provisionerHostSpec,provisionerStartProbe} from './provisioner-spec.mjs';
const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-provisioner-rollout'};
try{
 if(process.argv.length!==2)throw Error();
 const host=JSON.parse(readFileSync('work/railway-worker-host.json')),roles=JSON.parse(readFileSync('work/railway-dev-runtime-secrets.json')),path='work/postiz-dev-infrastructure-secrets.json',social=JSON.parse(readFileSync(path));
 if([host,social].some(s=>s.project_id!==project||s.environment_id!==environment)||roles.environment_id!==environment||social.postiz_service_id!=='12fba8b8-e4f0-45c4-900f-fa4cb05f5c83')throw Error();
 const db=JSON.parse(execFileSync('railway',['variables','--project',project,'--environment',environment,'--service','758bf0c1-56b5-452f-be8d-fe67af927267','--json'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe'],env}));
 const url=new URL(db.DATABASE_URL);url.username='desvio_provisioner';url.password=roles.passwords.POSTIZ_PROVISIONER_DATABASE_PASSWORD;
 if(!url.password||!social.jwt_secret)throw Error();
 social.encryption_key??=randomBytes(32).toString('hex');writeFileSync(path,JSON.stringify(social,null,2)+'\n',{mode:0o600});
 const image=JSON.parse(readFileSync('docs/evidence/worker-image-inventory.json')).images.find(i=>i.role==='trusted_worker').image_id;
 const origin='https://desvio-dev-web-dev.up.railway.app';
 const spec=provisionerHostSpec({DESVIO_WORKER_IMAGE:image,APP_MODE:'staging',POSTIZ_PROVISIONER_DATABASE_URL:url.toString(),TEMPORAL_ADDRESS:'desvio-dev-temporal.railway.internal:7233',TEMPORAL_NAMESPACE:'desvio-dev',POSTIZ_PROVISION_TASK_QUEUE:'desvio-provision',POSTIZ_BASE_URL:'http://desvio-dev-postiz.railway.internal:5000/api',POSTIZ_MEDIA_ORIGINS:origin,POSTIZ_CALLBACK_ORIGIN:origin,POSTIZ_ENCRYPTION_KEY:social.encryption_key,POSTIZ_ENTERPRISE_SIGNING_SECRET:social.jwt_secret});
 const output=execFileSync('railway',['sandbox','exec','--id',host.id,'--project',project,'--environment',environment,'--timeout','45','--','python3 -c '+quote(provisionerStartProbe)],{input:JSON.stringify(spec),encoding:'utf8',timeout:55000,stdio:['pipe','pipe','pipe'],env});
 const report={checked_at:new Date().toISOString(),sandbox_id:host.id,...JSON.parse(output),scope:'Restricted provisioner container process only; registration, real Postiz account provisioning and tenant isolation remain separate acceptance.'};
 writeFileSync('docs/evidence/railway-provisioner-start.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('DEV_PROVISIONER_START_FAILED_RECONCILE');process.exitCode=1;}
