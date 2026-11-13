import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerEnvironment,DEV_ENVIRONMENT_ID} from '../../infra/worker-control/environment.mjs';
test('unset environment keeps the original dev target and paths',()=>{
 const t=workerEnvironment({});
 assert.equal(t.environment,DEV_ENVIRONMENT_ID);assert.equal(t.bucket,'9355c904-bbb8-434b-b1b9-7f7a11ff7f32');
 assert.equal(t.statePath,'work/railway-worker-host.json');assert.equal(t.secretsPath,'work/railway-dev-runtime-secrets.json');
 assert.equal(t.bundleDirectory,'work/worker-bundle');assert.equal(t.inventoryPath,'docs/evidence/worker-image-inventory.json');
 assert.equal(t.evidence('railway-worker-start.json'),'docs/evidence/railway-worker-start.json');
});
test('dev2 has its own host state, secrets, bucket, bundle and evidence',()=>{
 const id='36a03b4f-6f19-4424-8a8e-289cfe220561',t=workerEnvironment({DESVIO_RAILWAY_ENVIRONMENT:id});
 assert.equal(t.environment,id);assert.equal(t.bucket,'9cf91ffc-1417-4e72-acac-10d43c3dcba7');
 assert.equal(t.statePath,`work/railway-worker-host-${id}.json`);assert.equal(t.secretsPath,`work/railway-runtime-secrets-${id}.json`);
 assert.equal(t.bundleDirectory,`work/worker-bundle-${id}`);assert.equal(t.inventoryPath,'docs/evidence/environments/dev2/worker-image-inventory.json');
 assert.notEqual(t.journalPath,workerEnvironment({}).journalPath);
});
test('unknown or malformed environments are refused',()=>{
 for(const value of ['production','00000000-0000-0000-0000-000000000000','../x'])assert.throws(()=>workerEnvironment({DESVIO_RAILWAY_ENVIRONMENT:value}),/WORKER_ENVIRONMENT_UNKNOWN/);
});
