import {createHash,randomUUID} from 'node:crypto';
import {workerReadiness} from './readiness.mjs';
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export const API_ACTIVATION_FLAGS=['VIDEO_ENABLED','POSTIZ_ENABLED','POSTIZ_PROVISIONING_ENABLED','POSTIZ_PUBLISHING_ENABLED','POSTIZ_OAUTH_ENABLED'];
export const API_ACTIVATION_KEYS=[...API_ACTIVATION_FLAGS,'VIDEO_RUNTIME_IMAGE','RENDER_RUNTIME_IMAGE'];
export const apiSettingDefault=key=>API_ACTIVATION_FLAGS.includes(key)?'false':'';
const disabled=values=>({...values,...Object.fromEntries(API_ACTIVATION_FLAGS.map(k=>[k,'false']))});
const fail=code=>{throw Error(code);};
export function activationPlan({spec,observed,api}){
 const readiness=workerReadiness(spec,observed);
 if(!observed.worker?.running||!observed.worker.id)fail('ACTIVATION_RUNNING_WORKER_REQUIRED');
 if(!api.deploymentId||api.status!=='SUCCESS')fail('ACTIVATION_HEALTHY_API_REQUIRED');
 const social=spec.values.POSTIZ_ENABLED??'false',publishing=spec.values.POSTIZ_PUBLISHING_ENABLED??'false';
 if(!['true','false'].includes(social)||!['true','false'].includes(publishing)||publishing==='true'&&social!=='true')fail('ACTIVATION_SOCIAL_FLAGS_INVALID');
 const oauth=api.variables.POSTIZ_OAUTH_ENABLED??'false';if(!['true','false'].includes(oauth))fail('ACTIVATION_SOCIAL_FLAGS_INVALID');
 const after={POSTIZ_OAUTH_ENABLED:social==='true'?oauth:'false',VIDEO_ENABLED:spec.values.VIDEO_ENABLED,POSTIZ_ENABLED:social,POSTIZ_PROVISIONING_ENABLED:social,POSTIZ_PUBLISHING_ENABLED:publishing,VIDEO_RUNTIME_IMAGE:spec.values.VIDEO_RUNTIME_IMAGE,RENDER_RUNTIME_IMAGE:spec.values.RENDER_RUNTIME_IMAGE};
 const before=Object.fromEntries(Object.keys(after).map(k=>[k,api.variables[k]??apiSettingDefault(k)]));
 const plan={version:1,worker:{before:{id:observed.worker.id,image:observed.worker.image,configuration:observed.worker.configuration},image:spec.image,configuration:spec.configurationHash,replace:readiness.status==='replacement_required'},api:{before,after,deploymentId:api.deploymentId,update:canonical(before)!==canonical(after)}};
 return {...plan,preview_sha256:createHash('sha256').update(canonical(plan)).digest('hex')};
}

// Adapters carry credentials privately. The plan/journal contain only pins, flags and hashes.
export async function activate(plan,approval,io){
 if(approval!==plan.preview_sha256)fail('ACTIVATION_APPROVAL_MISMATCH');
 const token=randomUUID(),backup='desvio-worker-rollback-'+token;
 let locked=false,workerTouched=false,apiTouched=false;
 try{
  await io.lock(token);locked=true;
  const current=activationPlan(await io.snapshot());
  if(current.preview_sha256!==approval)fail('ACTIVATION_PREVIEW_STALE');
  if(!plan.worker.replace&&!plan.api.update){await io.verifyWorker();return {status:'unchanged',preview_sha256:approval};}
  await io.assertIdle();
  // Recheck under the operator lock after the potentially slow idle query.
  if(activationPlan(await io.snapshot()).preview_sha256!==approval)fail('ACTIVATION_PREVIEW_STALE');
  await io.journal({stage:'starting',token,backup,plan});
  if(API_ACTIVATION_FLAGS.some(k=>plan.api.before[k]==='true')){
   apiTouched=true;await io.setAPI(disabled(plan.api.before));
  }
  if(plan.worker.replace){
   workerTouched=true;await io.swapWorker(plan.worker,backup,token);
   await io.startWorker();await io.verifyWorker();
  }else await io.verifyWorker();
  apiTouched=true;await io.setAPI(plan.api.after);
  await io.verifyAPI(plan.api.after);
  await io.journal({stage:'verified',token,backup:workerTouched?backup:null,plan});
  return {status:'activated',preview_sha256:approval,backup_container:workerTouched?backup:null,scope:'Worker registration and API deployment/configuration only; provider calls and business allowances are not verified.'};
 }catch(error){
  if(workerTouched||apiTouched){
   try{
    if(apiTouched)await io.setAPI(disabled(plan.api.before));
    if(workerTouched){await io.restoreWorker(plan.worker,backup,token);await io.verifyWorker(true);}
    if(apiTouched){await io.setAPI(plan.api.before);await io.verifyAPI(plan.api.before);}
    await io.journal({stage:'rolled_back',token,backup,plan});
   }catch{
    await io.journal({stage:'reconcile_required',token,backup,plan}).catch(()=>{});
    locked=false; // Retain the lock: an uncertain recovery must not permit another activation.
    fail('ACTIVATION_ROLLBACK_REQUIRES_RECONCILIATION');
   }
  }
  throw error;
 }finally{if(locked)await io.unlock(token);}
}
