import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerHostSpec} from '../../scripts/start-worker-host.mjs';
const fixture=()=>({APP_MODE:'test',DESVIO_WORKER_IMAGE:'sha256:'+'a'.repeat(64),DOCUMENT_PARSER_IMAGE:'sha256:'+'b'.repeat(64),SKILL_RUNTIME_IMAGE:'sha256:'+'c'.repeat(64),RENDER_RUNTIME_IMAGE:'sha256:'+'d'.repeat(64),VIDEO_RUNTIME_IMAGE:'sha256:'+'e'.repeat(64),WORKER_DATABASE_URL:'postgres://fixture-worker',DISPATCHER_DATABASE_URL:'postgres://fixture-dispatcher',TEMPORAL_ADDRESS:'localhost:7233',TEMPORAL_NAMESPACE:'fixture',TEMPORAL_TASK_QUEUE:'fixture',CLAMD_HOST:'localhost',CLAMD_PORT:'3310',S3_ENDPOINT:'http://localhost:9000',S3_REGION:'fixture',S3_BUCKET:'fixture',S3_ACCESS_KEY_ID:'fixture',S3_SECRET_ACCESS_KEY:'fixture',POSTIZ_ENABLED:'false',POSTIZ_PUBLISHING_ENABLED:'false',VIDEO_ENABLED:'false'});
test('host configuration keeps exact pins, disabled providers and only allowlisted environment',()=>{
 const env={...fixture(),UNRELATED_SECRET:'must-not-forward'},spec=workerHostSpec(env);
 assert.equal(spec.values.UNRELATED_SECRET,undefined);assert.equal(spec.values.POSTIZ_PUBLISHING_ENABLED,'false');assert.equal(spec.values.VIDEO_ENABLED,'false');assert.equal(spec.images.length,5);
 assert.equal(workerHostSpec(fixture()).configurationHash,spec.configurationHash);
 assert.notEqual(workerHostSpec({...fixture(),S3_SECRET_ACCESS_KEY:'changed'}).configurationHash,spec.configurationHash);
});
test('remote Docker, extra administrative credentials, mutable images and implicit enabling are denied',()=>{
 for(const change of [{DOCKER_HOST:'tcp://example.test:2375'},{DOCKER_CONTEXT:'other'},{MIGRATION_DATABASE_URL:'secret'},{APP_DATABASE_URL:'secret'},{SMTP_PASSWORD:'secret'},{DESVIO_WORKER_IMAGE:'latest'},{VIDEO_RUNTIME_IMAGE:undefined},{POSTIZ_PUBLISHING_ENABLED:undefined},{APP_MODE:'production'}])assert.throws(()=>workerHostSpec({...fixture(),...change}),/WORKER_/);
});

test('worker host forwards only the explicit authenticated video policy and rejects conflicting modes',()=>{
 const env={...fixture(),OPENAI_API_KEY:'fixture',VIDEO_ENABLED:'true',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),HIGGSFIELD_CREDENTIALS:'fixture:key',HIGGSFIELD_OUTPUT_POLICY:'authenticated_provider_result'};
 assert.equal(workerHostSpec(env).values.HIGGSFIELD_OUTPUT_POLICY,'authenticated_provider_result');
 for(const change of [{HIGGSFIELD_OUTPUT_POLICY:'all'},{HIGGSFIELD_OUTPUT_POLICY:'exact_origins'},{HIGGSFIELD_OUTPUT_ORIGINS:'https://example.com'}])assert.throws(()=>workerHostSpec({...env,...change}),/WORKER_CONFIGURATION_INVALID/);
});

test('optional website renderer is pinned, forwarded, inspected and fingerprints readiness',()=>{
 const prior=workerHostSpec(fixture()),image='sha256:'+'f'.repeat(64);
 const next=workerHostSpec({...fixture(),WEBSITE_RENDER_IMAGE:image});
 assert.equal(next.values.WEBSITE_RENDER_IMAGE,image);assert.equal(next.images.length,6);assert.ok(next.images.includes(image));assert.notEqual(next.configurationHash,prior.configurationHash);
 for(const value of ['latest','','repo:tag','sha256:nope'])assert.throws(()=>workerHostSpec({...fixture(),WEBSITE_RENDER_IMAGE:value}),/WORKER_PIN_REQUIRED/);
});
