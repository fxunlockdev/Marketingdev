import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerSettings,providerRuntimeSettings} from './provider-settings.mjs';
test('copies only provider credentials, never infrastructure or enable flags', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',HIGGSFIELD_CREDENTIALS:'fixture:key',DATABASE_URL:'forbidden',WORKER_DATABASE_URL:'forbidden',VIDEO_ENABLED:'true',POSTIZ_PUBLISHING_ENABLED:'true',RAILWAY_TOKEN:'forbidden'}),{OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',HIGGSFIELD_CREDENTIALS:'fixture:key'});
});
test('video activation requires complete explicit settings and never forwards unrelated controls',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),HIGGSFIELD_OUTPUT_ORIGINS:'https://video.example.org'};
 assert.deepEqual(providerRuntimeSettings({...input,POSTIZ_PUBLISHING_ENABLED:'true',APP_DATABASE_URL:'private'}),input);
 assert.deepEqual(providerRuntimeSettings({OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:'fixture:key'}),{OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:'fixture:key',VIDEO_ENABLED:'false'});
 for(const key of ['OPENAI_API_KEY','HIGGSFIELD_CREDENTIALS','VIDEO_ENCRYPTION_KEY','HIGGSFIELD_OUTPUT_ORIGINS']){
  const copy={...input};delete copy[key];assert.throws(()=>providerRuntimeSettings(copy),{message:'INVALID_VIDEO_SETTINGS'});
 }
 assert.equal(providerRuntimeSettings({...input,OPENAI_API_KEY:undefined,GEMINI_API_KEY:'fixture'}).VIDEO_ENABLED,'true');
});
test('video setup rejects malformed keys, implicit flags and unsafe or ambiguous download origins',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),HIGGSFIELD_OUTPUT_ORIGINS:'https://video.example.org'};
 for(const changes of [{VIDEO_ENABLED:'yes'},{VIDEO_ENABLED:true},{HIGGSFIELD_CREDENTIALS:'Key prefix-is-not-part-of-the-value'},{VIDEO_ENCRYPTION_KEY:'short'},...['http://video.example.org','https://127.0.0.1','https://video.example.org/path','https://user:secret@video.example.org','https://*.example.org','https://video.example.org,https://video.example.org','https://video.example.org, https://other.example.org'].map(HIGGSFIELD_OUTPUT_ORIGINS=>({HIGGSFIELD_OUTPUT_ORIGINS}))])assert.throws(()=>providerRuntimeSettings({...input,...changes}),{message:'INVALID_VIDEO_SETTINGS'});
});
test('empty settings leave unpaid deployment usable; malformed secrets fail without disclosure', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:''}),{});
  for (const value of ['secret\nvalue',' secret','secret\0',123,'x'.repeat(8193)]) assert.throws(()=>providerSettings({OPENAI_API_KEY:value}),{message:'INVALID_PROVIDER_SETTINGS'});
});

test('complete copied Higgsfield token is preserved unchanged and never implicitly enables video',()=>{
 const key='MOCK-single-copied-token';
 assert.equal(providerRuntimeSettings({HIGGSFIELD_CREDENTIALS:key}).VIDEO_ENABLED,'false');
 const active=providerRuntimeSettings({VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:key,VIDEO_ENCRYPTION_KEY:'a'.repeat(64),HIGGSFIELD_OUTPUT_ORIGINS:'https://video.example.org'});
 assert.equal(active.HIGGSFIELD_CREDENTIALS,key);
});

test('authenticated provider output is an explicit exclusive operator policy',()=>{
 const input={VIDEO_ENABLED:'true',OPENAI_API_KEY:'fixture',HIGGSFIELD_CREDENTIALS:'fixture:key',VIDEO_ENCRYPTION_KEY:'a'.repeat(64),HIGGSFIELD_OUTPUT_POLICY:'authenticated_provider_result'};
 assert.equal(providerRuntimeSettings(input).HIGGSFIELD_OUTPUT_POLICY,'authenticated_provider_result');
 for(const change of [{HIGGSFIELD_OUTPUT_ORIGINS:'https://example.com'},{HIGGSFIELD_OUTPUT_POLICY:'any_url'},{VIDEO_ENCRYPTION_KEY:''}])assert.throws(()=>providerRuntimeSettings({...input,...change}),{message:'INVALID_VIDEO_SETTINGS'});
});
