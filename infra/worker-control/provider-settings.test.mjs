import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerSettings} from './provider-settings.mjs';
test('copies only provider credentials, never infrastructure or enable flags', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',HIGGSFIELD_CREDENTIALS:'fixture:key',DATABASE_URL:'forbidden',WORKER_DATABASE_URL:'forbidden',VIDEO_ENABLED:'true',POSTIZ_PUBLISHING_ENABLED:'true',RAILWAY_TOKEN:'forbidden'}),{OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture2',HIGGSFIELD_CREDENTIALS:'fixture:key'});
});
test('empty settings leave unpaid deployment usable; malformed secrets fail without disclosure', () => {
  assert.deepEqual(providerSettings({OPENAI_API_KEY:''}),{});
  for (const value of ['secret\nvalue',' secret','secret\0',123,'x'.repeat(8193)]) assert.throws(()=>providerSettings({OPENAI_API_KEY:value}),{message:'INVALID_PROVIDER_SETTINGS'});
});
