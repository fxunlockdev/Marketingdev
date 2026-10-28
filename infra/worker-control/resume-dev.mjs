import {readFileSync} from 'node:fs';
import {activationIO} from './activate-dev.mjs';
import {API_ACTIVATION_FLAGS} from './activation.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Resume only the already-authorized, checkpointed operation. No new pause
// deployment and no duplicate worker swap are allowed.
export async function resumeCheckpoint(initial,makeIO=activationIO){
let j=structuredClone(initial);
if(!['awaiting_pause_deployment','worker_swap_requested','worker_verified','restore_pending','restore_deployment_blocked','verified'].includes(j.stage))throw Error('RESUME_STAGE_INVALID');
const io=makeIO({onDeployment:async d=>{
 j={...j,stage:'restore_pending',restore_deployment_id:d.deployment_id};
 await io.journal(j);
}});
const snap=await io.snapshot();
const expectedDeployment=j.restore_deployment_id??j.pause_deployment_id;
if(snap.api.deploymentId!==expectedDeployment||snap.api.status!=='SUCCESS'||snap.api.stopped)throw Error('RESUME_DEPLOYMENT_NOT_READY');
const same=(w,x)=>w?.running&&Object.keys(x).every(k=>w[k]===x[k]);
const desired={image:j.plan.worker.image,configuration:j.plan.worker.configuration};
if(snap.spec.image!==desired.image||snap.spec.configurationHash!==desired.configuration)throw Error('RESUME_DESIRED_WORKER_DRIFT');
if(j.stage!=='verified')await io.assertLock(j.token);
if(j.stage==='verified'){
 if(!same(snap.observed.worker,desired))throw Error('RESUME_WORKER_DRIFT');
 await io.verifyAPI(j.plan.api.after);
 console.log(JSON.stringify({status:'already_verified',deployment_id:expectedDeployment}));
}else if(j.stage==='restore_deployment_blocked'){
 if(j.restore_attempt?.variables_restored!==true||j.restore_attempt?.running_api_deployment!==j.pause_deployment_id||j.restore_deployment_id)throw Error('RESUME_BLOCKED_STATE_INVALID');
 if(!same(snap.observed.worker,desired))throw Error('RESUME_WORKER_DRIFT');
 await io.verifyWorker();await io.verifyAPI(j.plan.api.after);
 // The platform explicitly rejected creation; variables alone do not mean the
 // running container received them. One new deployment is required, not a swap.
 j={...j,stage:'restore_creation_requested'};await io.journal(j);
 await io.setAPI(j.plan.api.after,{forceRedeploy:true});
 await io.verifyAPI(j.plan.api.after);
 await io.journal({...j,stage:'verified',verified_at:new Date().toISOString()});
 await io.unlock(j.token);
 console.log(JSON.stringify({status:'activated',deployment_id:j.restore_deployment_id}));
}else if(j.restore_deployment_id){
 if(!same(snap.observed.worker,desired))throw Error('RESUME_WORKER_DRIFT');
 await io.verifyWorker();await io.verifyAPI(j.plan.api.after);
 await io.journal({...j,stage:'verified',verified_at:new Date().toISOString()});
 await io.unlock(j.token);
 console.log(JSON.stringify({status:'activated',deployment_id:expectedDeployment}));
}else{
 const paused={...j.plan.api.before,...Object.fromEntries(API_ACTIVATION_FLAGS.map(k=>[k,'false']))};
 await io.verifyAPI(paused);
 if(same(snap.observed.worker,j.plan.worker.before)){
  await io.assertIdle();
  const fresh=await io.snapshot();
  if(fresh.api.deploymentId!==j.pause_deployment_id||fresh.api.status!=='SUCCESS'||fresh.api.stopped||!same(fresh.observed.worker,j.plan.worker.before)||fresh.spec.image!==desired.image||fresh.spec.configurationHash!==desired.configuration)throw Error('RESUME_PREFLIGHT_DRIFT');
  await io.assertLock(j.token);
  await io.verifyAPI(paused);
  j={...j,stage:'worker_swap_requested'};await io.journal(j);
  try{
   await io.swapWorker(j.plan.worker,j.backup,j.token);
   await io.startWorker();await io.verifyWorker();
  }catch(e){
   await io.restoreWorker(j.plan.worker,j.backup,j.token);
   // Keep the pause and lock if recovery is ambiguous; never pretend activation.
   j={...j,stage:'reconcile_required',reason:'Resume worker replacement failed; old worker restored, API remains paused'};await io.journal(j);
   throw e;
  }
 }else if(!same(snap.observed.worker,desired))throw Error('RESUME_WORKER_DRIFT');
 await io.verifyWorker();j={...j,stage:'worker_verified'};await io.journal(j);
 // Exact deployment ID is journaled immediately after creation. If this wait
 // times out during an outage, retain the healthy worker and lock, then resume
 // observation of that same deployment instead of creating another one.
 await io.setAPI(j.plan.api.after);await io.verifyAPI(j.plan.api.after);
 await io.journal({...j,stage:'verified',verified_at:new Date().toISOString()});
 await io.unlock(j.token);
 console.log(JSON.stringify({status:'activated',deployment_id:j.restore_deployment_id}));
}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await resumeCheckpoint(JSON.parse(readFileSync('work/provider-activation-journal.json')));
