import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveSettings,customerClient,imageBytes} from '../../scripts/live/run-creative.mjs';
const id='11111111-1111-4111-8111-111111111111';
const settings={APP_MODE:'staging',LIVE_SMOKE_ENABLED:'true',LIVE_SMOKE_ACK:'I_AUTHORIZE_CAPPED_STAGING_TESTS',LIVE_TEST_SCOPE:'creative',LIVE_TEST_ORIGIN:'https://desvio-dev-web-dev.up.railway.app',LIVE_TEST_ORG_IDS:id,LIVE_TEST_BRAND_IDS:id,PROVIDER_BUDGET_USD:'2.123456',LIVE_TEST_MEDIA_ORIGINS:'https://private-media.example.test',LIVE_TEST_CREDENTIALS_FILE:'/private/credentials.json',LIVE_TEST_JOURNAL:'/private/run.json'};
test('live creative acceptance requires explicit dedicated dev scope, exact IDs and finite bounded microdollar authorization',()=>{
 assert.equal(liveSettings(settings).budgetMicros,2123456);
 for(const [key,values] of Object.entries({APP_MODE:['production','test'],LIVE_SMOKE_ENABLED:['false',''],LIVE_SMOKE_ACK:['yes',''],LIVE_TEST_SCOPE:['full',''],LIVE_TEST_ORIGIN:['https://desvio.example.com','https://desvio-dev-web-dev.up.railway.app/','http://127.0.0.1'],LIVE_TEST_ORG_IDS:['*',id+','+id,''],LIVE_TEST_BRAND_IDS:['all','bad'],PROVIDER_BUDGET_USD:['NaN','Infinity','0','-1','1e2','0.000001','1.0000001','1000.000001'],LIVE_TEST_MEDIA_ORIGINS:['','*','http://private-media.example.test','https://user:secret@private-media.example.test'],LIVE_TEST_CREDENTIALS_FILE:[''],LIVE_TEST_JOURNAL:['']}))for(const value of values)assert.throws(()=>liveSettings({...settings,[key]:value}),/^Error: LIVE_/);
});
test('customer transport carries its session only to the fixed application origin and never follows redirects',async()=>{
 const seen=[];const client=customerClient(settings.LIVE_TEST_ORIGIN,new AbortController().signal,async(url,init)=>{seen.push({url,init});return Response.json({user:{id}},{headers:{'set-cookie':'session=TEST_COOKIE; HttpOnly'}});});
 await client.request('/api/auth/sign-in/email',{email:'fixture@example.test',password:'TEST ONLY'});
 await client.request('/api/v1/businesses/'+id);
 assert.equal(seen[1].init.headers.cookie,'session=TEST_COOKIE');assert.equal(seen[1].init.redirect,'error');
 await assert.rejects(client.request('https://foreign.example/api/'),/PATH_DENIED/);assert.equal(seen.length,2);
 await client.close();assert.equal(seen.at(-1).url,settings.LIVE_TEST_ORIGIN+'/api/auth/sign-out');
});
test('private media transport rejects non-allowlisted signed URLs before network access and sends no application cookie',async()=>{
 let calls=0;const transport=async(url,init)=>{calls++;assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return new Response('not a PNG',{headers:{'content-type':'text/plain'}});};
 const signal=new AbortController().signal;
 for(const url of ['http://127.0.0.1/private','https://foreign.example/asset','https://u:p@private-media.example.test/a'])await assert.rejects(imageBytes(url,['https://private-media.example.test'],signal,transport),/ORIGIN_DENIED/);
 assert.equal(calls,0);await assert.rejects(imageBytes('https://private-media.example.test/asset?signature=TEST',['https://private-media.example.test'],signal,transport),/MEDIA_INVALID/);assert.equal(calls,1);
});
