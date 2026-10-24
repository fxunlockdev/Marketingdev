// Operator-only CLI controller. Railway retains its existing authenticated session.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
const statePath=resolve('work/railway-worker-host.json');
const run=args=>JSON.parse(execFileSync('railway',['sandbox',...args,'--project',project,'--environment',environment,'--json'],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-worker-transfer-20261023'}}));
async function save(state){await mkdir(dirname(statePath),{recursive:true});await writeFile(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
async function load(){try{return JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
try{
 const command=process.argv[2];if(!['ensure','inspect'].includes(command))throw new Error('HOST_USAGE');
 let state=await load();if(state&&state.environment_id!==environment)throw new Error('HOST_STATE_SCOPE_MISMATCH');
 let hosts=run(['list']);
 if(state&&!state.id){
  const candidates=hosts.filter(s=>!state.previous_ids.includes(s.id)&&Date.parse(s.createdAt)>=Date.parse(state.started_at)&&s.status!=='DESTROYED');
  if(candidates.length!==1)throw new Error('HOST_CREATE_OUTCOME_NEEDS_RECONCILIATION');
  state={...state,id:candidates[0].id};await save(state);
 }
 if(!state){
  if(command!=='ensure')throw new Error('HOST_NOT_PROVISIONED');
  if(hosts.some(s=>!['DESTROYED','FAILED','STOPPED'].includes(s.status)))throw new Error('HOST_EXISTING_SANDBOX_REQUIRES_SELECTION');
  state={project_id:project,environment_id:environment,started_at:new Date().toISOString(),previous_ids:hosts.map(s=>s.id),id:null,private_network_requested:true};await save(state);
  const created=run(['create','--private-network','--idle-timeout-minutes','0']);
  if(!created.id)throw new Error('HOST_CREATE_OUTCOME_NEEDS_RECONCILIATION');
  state={...state,id:created.id};await save(state);hosts=run(['list']);
 }
 const host=hosts.find(h=>h.id===state.id);if(!host||host.environmentId!==environment)throw new Error('HOST_NOT_FOUND_RECONCILE');
 if(['STOPPED','DESTROYED','FAILED'].includes(host.status))throw new Error('HOST_TERMINAL_REPLACEMENT_REQUIRES_RECONCILIATION');
 if(host.idleTimeoutMinutes!==0)throw new Error('HOST_IDLE_POLICY_MISMATCH');
 await save({...state,last_observed:host,observed_at:new Date().toISOString()});
 console.log(JSON.stringify({...host,private_network_requested:true,scope:'Host state only; private service connectivity, worker registration and recovery remain unverified'}));
}catch(e){console.error(/^HOST_[A-Z_]+$/.test(e.message)?e.message:'HOST_OPERATION_FAILED_RECONCILE_BEFORE_RETRY');process.exitCode=1;}
