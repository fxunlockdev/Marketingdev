import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerReadiness} from '../../infra/worker-control/readiness.mjs';
const image='sha256:'+'a'.repeat(64),hash='b'.repeat(64);
const spec={image,images:[image],configurationHash:hash,values:{VIDEO_ENABLED:'false',POSTIZ_PUBLISHING_ENABLED:'false',OPENAI_API_KEY:'secret-not-for-output'}};
const observed=()=>({images:[{id:image,architecture:'amd64',os:'linux'}],worker:{image,configuration:hash,purpose:'trusted-worker',running:true}});
test('readiness distinguishes matching, absent, stopped and changed workers without leaking credentials',()=>{
 const report=workerReadiness(spec,observed());assert.equal(report.status,'configuration_matches');assert.equal(report.running,true);assert.equal(report.changed_services,false);assert.equal(report.paid_calls,false);
 assert.equal(report.credentials_present.OPENAI_API_KEY,true);assert.ok(!JSON.stringify(report).includes(spec.values.OPENAI_API_KEY));
 assert.equal(workerReadiness(spec,{...observed(),worker:null}).status,'worker_absent');
 assert.equal(workerReadiness(spec,{...observed(),worker:{...observed().worker,running:false}}).running,false);
 assert.equal(workerReadiness({...spec,configurationHash:'changed'},observed()).status,'replacement_required');
});
test('readiness rejects wrong image platform, missing pins and unrelated containers',()=>{
 for(const snapshot of [{...observed(),images:[]},{...observed(),images:[{id:image,architecture:'arm64',os:'linux'}]},{...observed(),worker:{...observed().worker,purpose:'unrelated'}}])assert.throws(()=>workerReadiness(spec,snapshot),/WORKER_/);
});
