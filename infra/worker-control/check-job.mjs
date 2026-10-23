import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const host=JSON.parse(readFileSync('work/railway-worker-host.json')),project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
const cleanup=process.argv.includes('--cleanup');
const statePath='work/railway-job-probe.json',q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-dev-job-20261023'};
const call=(args,input,timeout=30000)=>execFileSync('railway',args,{input,encoding:'utf8',timeout,env,stdio:['pipe','pipe','pipe']});
try{
 if(host.project_id!==project||host.environment_id!==environment||(!cleanup&&existsSync(statePath))||(cleanup&&!existsSync(statePath)))throw Error('Reconcile existing probe before starting another');
 const secrets=JSON.parse(readFileSync('work/railway-dev-runtime-secrets.json'));if(secrets.project_id!==project||secrets.environment_id!==environment)throw Error();
 const vars=JSON.parse(call(['variables','--project',project,'--environment',environment,'--service','758bf0c1-56b5-452f-be8d-fe67af927267','--json']));
 const s3=JSON.parse(call(['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment',environment,'--json']));
 const app=new URL(vars.DATABASE_URL);app.username='desvio_app';app.password=secrets.passwords.APP_DATABASE_PASSWORD;
 const state=cleanup?JSON.parse(readFileSync(statePath)):{run_id:randomUUID(),owner:randomUUID(),foreign:randomUUID(),project_id:project,environment_id:environment,started_at:new Date().toISOString()};if(!cleanup)writeFileSync(statePath,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
 const input={...state,admin_url:vars.DATABASE_URL,app_url:app.href,database_name:vars.PGDATABASE,storage:{endpoint:s3.endpoint,region:s3.region,bucket:s3.bucketName,accessKeyId:s3.accessKeyId,secretAccessKey:s3.secretAccessKey}};
 const image=JSON.parse(readFileSync('docs/evidence/worker-image-inventory.json')).images.find(i=>i.role==='trusted_worker')?.image_id;
 if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('Missing worker image');
 const command='docker run --rm -i --name desvio-job-acceptance-'+state.run_id+' --network host --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --tmpfs /tmp:rw,nosuid,size=32m '+image+' node --input-type=module -e '+q(readFileSync(cleanup?'infra/worker-control/job-probe-cleanup.mjs':'infra/worker-control/job-probe.mjs','utf8'));
 let out;try{out=call(['sandbox','exec','--id',host.id,'--project',project,'--environment',environment,'--timeout','180','--',command],JSON.stringify(input),190000);}catch(e){out=e.stdout;if(!out)throw Error('Inspect existing probe container before retrying');}
 const result=JSON.parse(out);writeFileSync(statePath,JSON.stringify({...state,...(cleanup?{cleanup_result:result}:{result})},null,2)+'\n',{mode:0o600});
 const report={checked_at:new Date().toISOString(),sandbox_id:host.id,...result,scope:cleanup?'Exact acceptance fixture cleanup only; Temporal history retained under normal retention.':'Actual dev application service methods, forced RLS, signed S3 upload, durable outbox/Temporal/worker scanning and canonical readback with administrative fixture identities. No browser/session/email or paid provider acceptance.',live_model_or_social_calls:false};writeFileSync(cleanup?'docs/evidence/railway-worker-job-cleanup.json':'docs/evidence/railway-worker-job.json',JSON.stringify(report,null,2)+'\n');if(cleanup&&result.passed){const prior=JSON.parse(readFileSync('docs/evidence/railway-worker-job.json'));if(prior.run_id!==result.run_id)throw Error();prior.fixture_cleanup_pending=false;prior.cleanup_evidence='docs/evidence/railway-worker-job-cleanup.json';writeFileSync('docs/evidence/railway-worker-job.json',JSON.stringify(prior,null,2)+'\n');}console.log(JSON.stringify(report));if(!result.passed)process.exitCode=1;
}catch{console.error('JOB_ACCEPTANCE_UNCONFIRMED_RECONCILE_EXISTING_PROBE');process.exitCode=1;}
