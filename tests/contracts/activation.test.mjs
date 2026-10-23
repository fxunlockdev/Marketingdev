import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activationPlan,activate} from '../../infra/worker-control/activation.mjs';
const image='sha256:'+'a'.repeat(64),hash='b'.repeat(64);
const snapshot=()=>({spec:{image,images:[image],configurationHash:hash,values:{VIDEO_ENABLED:'true',VIDEO_RUNTIME_IMAGE:image,RENDER_RUNTIME_IMAGE:image,OPENAI_API_KEY:'private-fixture'}},observed:{images:[{id:image,os:'linux',architecture:'amd64'}],worker:{id:'old-container',image,configuration:'old',purpose:'trusted-worker',running:true}},api:{deploymentId:'old-api',status:'SUCCESS',variables:{VIDEO_ENABLED:'true',VIDEO_RUNTIME_IMAGE:image,RENDER_RUNTIME_IMAGE:image}}});
const adapter=s=>{
 const calls=[];let snapshots=0;
 const io={snapshot:async()=>{snapshots++;return structuredClone(s);},lock:async()=>calls.push('lock'),unlock:async()=>calls.push('unlock'),assertIdle:async()=>calls.push('idle'),journal:async x=>calls.push(x.stage),swapWorker:async()=>calls.push('swap'),startWorker:async()=>calls.push('start'),restoreWorker:async()=>calls.push('restore'),verifyWorker:async r=>calls.push(r?'verify-old':'verify-new'),setAPI:async v=>calls.push('api:'+v.VIDEO_ENABLED),verifyAPI:async()=>calls.push('verify-api')};
 return {calls,io,snapshots:()=>snapshots};
};
test('preview contains only exact pins, flags and fingerprints and rejects unready targets',()=>{
 const s=snapshot(),plan=activationPlan(s);assert.equal(plan.worker.replace,true);assert.ok(!JSON.stringify(plan).includes('private-fixture'));
 for(const mutate of [x=>x.observed.worker.running=false,x=>x.api.status='FAILED',x=>x.observed.worker.purpose='other']){const x=snapshot();mutate(x);assert.throws(()=>activationPlan(x));}
 delete s.api.variables.VIDEO_RUNTIME_IMAGE;assert.equal(activationPlan(s).api.before.VIDEO_RUNTIME_IMAGE,'');
});
test('matching configuration verifies worker without restarting or redeploying',async()=>{
 const s=snapshot();s.observed.worker.configuration=hash;const p=activationPlan(s),a=adapter(s);
 assert.equal((await activate(p,p.preview_sha256,a.io)).status,'unchanged');assert.deepEqual(a.calls,['lock','verify-new','unlock']);
});
test('activation disables video before replacing worker and only enables API after worker verification',async()=>{
 const s=snapshot(),p=activationPlan(s),a=adapter(s);assert.equal((await activate(p,p.preview_sha256,a.io)).status,'activated');
 assert.deepEqual(a.calls,['lock','idle','starting','api:false','swap','start','verify-new','api:true','verify-api','verified','unlock']);assert.equal(a.snapshots(),2);
});
test('wrong approval, stale snapshots and busy queues cannot mutate services',async()=>{
 const s=snapshot(),p=activationPlan(s),a=adapter(s);
 await assert.rejects(activate(p,'incorrect',a.io),/APPROVAL_MISMATCH/);assert.deepEqual(a.calls,[]);
 s.spec.configurationHash='changed';await assert.rejects(activate(p,p.preview_sha256,a.io),/PREVIEW_STALE/);assert.deepEqual(a.calls,['lock','unlock']);
 const b=adapter(snapshot());b.io.assertIdle=async()=>{throw Error('BUSY');};await assert.rejects(activate(p,p.preview_sha256,b.io),/BUSY/);assert.deepEqual(b.calls,['lock','unlock']);
});
test('drift during idle preflight is rejected before service mutations',async()=>{
 const s=snapshot(),p=activationPlan(s),a=adapter(s);a.io.assertIdle=async()=>{s.api.deploymentId='new-api';};
 await assert.rejects(activate(p,p.preview_sha256,a.io),/PREVIEW_STALE/);assert.deepEqual(a.calls,['lock','unlock']);
});
test('failed and ambiguous worker swaps restore exact previous worker and API before releasing lock',async()=>{
 for(const step of ['swapWorker','startWorker','verifyWorker']){
  const s=snapshot(),p=activationPlan(s),a=adapter(s);const original=a.io[step];let once=true;
  a.io[step]=async(...args)=>{if(once){once=false;throw Error('FIXTURE_FAILURE');}return original(...args);};
  await assert.rejects(activate(p,p.preview_sha256,a.io),/FIXTURE_FAILURE/);
  assert.ok(a.calls.includes('restore'));assert.ok(a.calls.includes('verify-old'));assert.ok(a.calls.includes('rolled_back'));assert.equal(a.calls.at(-1),'unlock');
 }
});
test('API verification failure rolls back both services and recovery ambiguity retains lock',async()=>{
 const s=snapshot(),p=activationPlan(s),a=adapter(s);let once=true;
 a.io.verifyAPI=async()=>{if(once){once=false;throw Error('BAD_API');}};
 await assert.rejects(activate(p,p.preview_sha256,a.io),/BAD_API/);assert.ok(a.calls.includes('rolled_back'));assert.equal(a.calls.at(-1),'unlock');
 const b=adapter(s);b.io.startWorker=async()=>{throw Error('START');};b.io.restoreWorker=async()=>{throw Error('UNKNOWN_RESTORE');};
 await assert.rejects(activate(p,p.preview_sha256,b.io),/ROLLBACK_REQUIRES_RECONCILIATION/);assert.equal(b.calls.at(-1),'reconcile_required');assert.ok(!b.calls.includes('unlock'));
});
test('social activation preserves publication opt-in and disables active APIs before worker swap',async()=>{
 const s=snapshot();s.spec.values.VIDEO_ENABLED='false';s.api.variables.VIDEO_ENABLED='false';s.spec.values.POSTIZ_ENABLED='true';s.spec.values.POSTIZ_PUBLISHING_ENABLED='false';s.api.variables.POSTIZ_ENABLED='true';s.api.variables.POSTIZ_PROVISIONING_ENABLED='true';
 const p=activationPlan(s),a=adapter(s),sets=[];a.io.setAPI=async v=>{sets.push(v);a.calls.push('set');};
 await activate(p,p.preview_sha256,a.io);
 assert.equal(sets[0].POSTIZ_ENABLED,'false');assert.equal(sets[0].POSTIZ_PROVISIONING_ENABLED,'false');assert.equal(sets.at(-1).POSTIZ_ENABLED,'true');assert.equal(sets.at(-1).POSTIZ_PUBLISHING_ENABLED,'false');assert.ok(a.calls.indexOf('set')<a.calls.indexOf('swap'));
 s.spec.values.POSTIZ_ENABLED='false';s.spec.values.POSTIZ_PUBLISHING_ENABLED='true';assert.throws(()=>activationPlan(s),/SOCIAL_FLAGS_INVALID/);
});
