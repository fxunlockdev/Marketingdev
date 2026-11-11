import test from 'node:test';
import assert from 'node:assert/strict';
import {VecteezyClient} from '../../dist/vecteezy-client.js';
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('stock search uses fixed origin, commercial real photos and no redirects',async()=>{
 let calls=0;
 const c=new VecteezyClient('secret',123,async(url,options)=>{
  calls++;const u=new URL(url);assert.equal(u.origin,'https://api.vecteezy.com');assert.equal(u.pathname,'/v2/123/resources');
  assert.equal(u.searchParams.get('ai_generated'),'false');assert.equal(u.searchParams.get('license_type'),'commercial');assert.equal(u.searchParams.get('term'),'cafe & garden');assert.equal(options.redirect,'error');
  return response({resources:[{id:42,content_type:'photo',title:'Garden',ai_generated:false,preview_url:'https://example.com/photo.jpg'}]});
 });
 assert.equal((await c.search('cafe & garden'))[0].id,42);assert.equal(calls,1);
});
test('missing credentials and invalid IDs never contact vendor',async()=>{
 let calls=0;const transport=async()=>{calls++;throw Error();};
 await assert.rejects(new VecteezyClient(undefined,123,transport).search('garden'),{code:'STOCK_NOT_CONFIGURED'});
 await assert.rejects(new VecteezyClient('secret',123,transport).download(-1),{code:'STOCK_RESOURCE_INVALID'});assert.equal(calls,0);
});
test('quota and auth errors stay distinct without leaking vendor payload',async()=>{
 for(const [status,code] of [[401,'STOCK_AUTH_FAILED'],[402,'STOCK_QUOTA_EXCEEDED'],[429,'STOCK_RATE_LIMITED']]){
  await assert.rejects(new VecteezyClient('secret',1,async()=>new Response('secret vendor text',{status})).search('garden'),{code});
 }
});
test('uncertain billable downloads are not retried',async()=>{
 for(const result of [()=>{throw Error('network secret');},()=>new Response('',{status:503}),()=>response({url:'bad'})]){
  let calls=0;const c=new VecteezyClient('secret',1,async()=>{calls++;return result();});
  await assert.rejects(c.download(42),{code:'STOCK_DOWNLOAD_UNKNOWN'});assert.equal(calls,1);
 }
});
test('download preserves attribution obligations',async()=>{
 const c=new VecteezyClient('secret',1,async()=>response({url:'https://example.com/photo.jpg',requires_attribution:true,required_attribution_url:'https://www.vecteezy.com/photo/42'}));
 assert.deepEqual(await c.download(42),{url:'https://example.com/photo.jpg',requiresAttribution:true,attributionURL:'https://www.vecteezy.com/photo/42'});
});
test('search rejects unsafe preview URLs and AI-generated results',async()=>{
 for(const extra of [{preview_url:'http://localhost/x'},{ai_generated:true}]){
  const c=new VecteezyClient('secret',1,async()=>response({resources:[{id:42,content_type:'photo',...extra}]}));
  await assert.rejects(c.search('garden'),{code:'STOCK_RESPONSE_INVALID'});
 }
});
