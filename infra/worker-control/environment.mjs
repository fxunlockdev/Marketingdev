// Operator target selection for the private worker host scripts.
// DESVIO_RAILWAY_ENVIRONMENT picks the Railway environment; unset keeps the original dev target and paths.
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const PROJECT_ID='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12';
export const DEV_ENVIRONMENT_ID='6a760b10-9ed8-4f01-9c4a-77a25919755a';

// The bucket is the environment's own media bucket: the worker stores media there and the
// image transfer uses a temporary private object in it.
const KNOWN={
 [DEV_ENVIRONMENT_ID]:{name:'dev',bucket:'9355c904-bbb8-434b-b1b9-7f7a11ff7f32'},
 '36a03b4f-6f19-4424-8a8e-289cfe220561':{name:'dev2',bucket:'9cf91ffc-1417-4e72-acac-10d43c3dcba7'},
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function workerEnvironment(env=process.env){
 const id=env.DESVIO_RAILWAY_ENVIRONMENT||DEV_ENVIRONMENT_ID;
 const entry=KNOWN[id];
 if(!UUID.test(id)||!entry)throw Error('WORKER_ENVIRONMENT_UNKNOWN');
 const original=id===DEV_ENVIRONMENT_ID;
 const local=(devPath,scopedPath)=>original?devPath:scopedPath;
 const evidence=name=>original?`docs/evidence/${name}`:`docs/evidence/environments/${entry.name}/${name}`;
 return {
  project:PROJECT_ID,environment:id,name:entry.name,bucket:entry.bucket,original,
  statePath:local('work/railway-worker-host.json',`work/railway-worker-host-${id}.json`),
  secretsPath:local('work/railway-dev-runtime-secrets.json',`work/railway-runtime-secrets-${id}.json`),
  socialSecretsPath:local('work/postiz-dev-infrastructure-secrets.json',`work/postiz-${id}-infrastructure-secrets.json`),
  bundleDirectory:local('work/worker-bundle',`work/worker-bundle-${id}`),
  journalPath:local('work/provider-activation-journal.json',`work/provider-activation-journal-${id}.json`),
  inventoryPath:evidence('worker-image-inventory.json'),
  evidence,
 };
}

// Evidence for a non-default environment lives in its own directory, created on first write.
export function evidenceFile(target,name){
 const path=target.evidence(name);
 mkdirSync(dirname(path),{recursive:true});
 return path;
}
