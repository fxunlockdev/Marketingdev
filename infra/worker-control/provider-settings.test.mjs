import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerSettings,providerRuntimeSettings,imageRuntimeSettings} from './provider-settings.mjs';
test('copies only provider credentials, never infrastructure or enable flags', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',RUNWAYML_API_SECRET:'fixture:key',DATABASE_URL:'forbidden',WORKER_DATABASE_URL:'forbidden',VIDEO_ENABLED:'true',POSTIZ_PUBLISHING_ENABLED:'true',RAILWAY_TOKEN:'forbidden'}),{OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',RUNWAYML_API_SECRET:'fixture:key'});
});
test('video activation requires complete explicit settings and never forwards unrelated controls',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),RUNWAY_OUTPUT_POLICY:'exact_origins',RUNWAY_OUTPUT_ORIGINS:'https://video.example.org'};
 assert.deepEqual(providerRuntimeSettings({...input,POSTIZ_PUBLISHING_ENABLED:'true',APP_DATABASE_URL:'private'}),{...input,HIGGSFIELD_IMAGES_ENABLED:'false'});
 assert.deepEqual(providerRuntimeSettings({OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:'fixture:key'}),{OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:'fixture:key',VIDEO_ENABLED:'false',HIGGSFIELD_IMAGES_ENABLED:'false'});
 for(const key of ['OPENAI_API_KEY','RUNWAYML_API_SECRET','VIDEO_ENCRYPTION_KEY','RUNWAY_OUTPUT_ORIGINS']){
  const copy={...input};delete copy[key];assert.throws(()=>providerRuntimeSettings(copy),{message:'INVALID_VIDEO_SETTINGS'});
 }
 assert.equal(providerRuntimeSettings({...input,OPENAI_API_KEY:undefined,GEMINI_API_KEY:'fixture'}).VIDEO_ENABLED,'true');
});
test('video setup rejects malformed keys, implicit flags and unsafe or ambiguous download origins',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),RUNWAY_OUTPUT_POLICY:'exact_origins',RUNWAY_OUTPUT_ORIGINS:'https://video.example.org'};
 for(const changes of [{VIDEO_ENABLED:'yes'},{VIDEO_ENABLED:true},{RUNWAYML_API_SECRET:'Key prefix-is-not-part-of-the-value'},{VIDEO_ENCRYPTION_KEY:'short'},...['http://video.example.org','https://127.0.0.1','https://video.example.org/path','https://user:secret@video.example.org','https://*.example.org','https://video.example.org,https://video.example.org','https://video.example.org, https://other.example.org'].map(RUNWAY_OUTPUT_ORIGINS=>({RUNWAY_OUTPUT_ORIGINS}))])assert.throws(()=>providerRuntimeSettings({...input,...changes}),{message:'INVALID_VIDEO_SETTINGS'});
});
test('empty settings leave unpaid deployment usable; malformed secrets fail without disclosure', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:''}),{});
  for (const value of ['secret\nvalue',' secret','secret\0',123,'x'.repeat(8193)]) assert.throws(()=>providerSettings({OPENAI_API_KEY:value}),{message:'INVALID_PROVIDER_SETTINGS'});
});

test('complete copied Runway secret is preserved unchanged and never implicitly enables video',()=>{
 const key='MOCK-single-copied-token';
 assert.equal(providerRuntimeSettings({RUNWAYML_API_SECRET:key}).VIDEO_ENABLED,'false');
 const active=providerRuntimeSettings({VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:key,VIDEO_ENCRYPTION_KEY:'a'.repeat(64),RUNWAY_OUTPUT_POLICY:'exact_origins',RUNWAY_OUTPUT_ORIGINS:'https://video.example.org'});
 assert.equal(active.RUNWAYML_API_SECRET,key);
});

test('authenticated provider output is an explicit exclusive operator policy',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',RUNWAYML_API_SECRET:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),RUNWAY_OUTPUT_POLICY:'authenticated_provider_result'};
 assert.equal(providerRuntimeSettings(input).RUNWAY_OUTPUT_POLICY,'authenticated_provider_result');
 for(const change of [{RUNWAY_OUTPUT_ORIGINS:'https://example.com'},{RUNWAY_OUTPUT_POLICY:'any_url'},{VIDEO_ENCRYPTION_KEY:''}])assert.throws(()=>providerRuntimeSettings({...input,...change}),{message:'INVALID_VIDEO_SETTINGS'});
});

test('Maxun credential is forwarded privately without enabling generation or exposing infrastructure',()=>{
 assert.deepEqual(providerSettings({MAXUN_API_KEY:'fixture-maxun',DATABASE_URL:'never-forward'}),{MAXUN_API_KEY:'fixture-maxun'});
 for(const value of ['secret\nvalue',' secret','secret\0',123])assert.throws(()=>providerSettings({MAXUN_API_KEY:value}),/INVALID_PROVIDER_SETTINGS/);
});

test('still image replacement requires an explicit switch and separate valid encryption key',()=>{
 assert.deepEqual(imageRuntimeSettings({HIGGSFIELD_CREDENTIALS:'fixture'}),{HIGGSFIELD_IMAGES_ENABLED:'false'});
 const input={HIGGSFIELD_IMAGES_ENABLED:'true',HIGGSFIELD_CREDENTIALS:'fixture',HIGGSFIELD_IMAGE_ENCRYPTION_KEY:'b'.repeat(64)};
 assert.equal(imageRuntimeSettings(input).HIGGSFIELD_IMAGES_ENABLED,'true');
 for(const change of [{HIGGSFIELD_IMAGES_ENABLED:'yes'},{HIGGSFIELD_CREDENTIALS:''},{HIGGSFIELD_IMAGE_ENCRYPTION_KEY:'short'},{VIDEO_ENCRYPTION_KEY:input.HIGGSFIELD_IMAGE_ENCRYPTION_KEY}])assert.throws(()=>imageRuntimeSettings({...input,...change}));
});


test('Vecteezy credentials reach only the worker settings and numeric account IDs are validated',()=>{
 assert.deepEqual(providerSettings({VECTEEZY_API_KEY:'fixture',VECTEEZY_ACCOUNT_ID:'123',DATABASE_URL:'private'}),{VECTEEZY_API_KEY:'fixture',VECTEEZY_ACCOUNT_ID:'123'});
 for(const value of ['0','-1','1.5',' 123','1e3','9007199254740992',123])assert.throws(()=>providerSettings({VECTEEZY_ACCOUNT_ID:value}),/INVALID_STOCK_SETTINGS/);
 for(const value of [' secret','secret\nvalue',123])assert.throws(()=>providerSettings({VECTEEZY_API_KEY:value}),/INVALID_PROVIDER_SETTINGS/);
 assert.equal(providerRuntimeSettings({VECTEEZY_API_KEY:'fixture',VECTEEZY_ACCOUNT_ID:'123'}).VIDEO_ENABLED,'false');
});
