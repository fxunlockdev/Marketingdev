import test from 'node:test';
import assert from 'node:assert/strict';
import {PostformeClient,PostformeError,postformeOrigin,postformeURL,POSTFORME_ORIGIN} from '../../dist/postforme-client.js';

test('Post for Me origin is fixed unless a loopback override is set in development or test',()=>{
 assert.equal(postformeOrigin({}),POSTFORME_ORIGIN);
 assert.equal(postformeOrigin({APP_MODE:'production'}),POSTFORME_ORIGIN);
 assert.equal(postformeOrigin({APP_MODE:'development',POSTFORME_BASE_URL:'http://127.0.0.1:54011'}),'http://127.0.0.1:54011');
 assert.equal(postformeOrigin({APP_MODE:'test',POSTFORME_BASE_URL:'http://localhost:9/'}),'http://localhost:9');
});
test('Post for Me base URL override is refused in staging and production',()=>{
 for(const APP_MODE of ['staging','production',undefined,''])assert.throws(()=>postformeOrigin({APP_MODE,POSTFORME_BASE_URL:'http://127.0.0.1:54011'}),/development or test/);
});
test('Post for Me base URL override must be a bare loopback origin',()=>{
 for(const value of ['https://evil.example','http://10.0.0.5:80','http://user:pw@127.0.0.1:1','http://127.0.0.1:1/v1','file:///etc/passwd','not a url'])assert.throws(()=>postformeOrigin({APP_MODE:'development',POSTFORME_BASE_URL:value}),/POSTFORME_BASE_URL/);
});
test('provider links are accepted from the mock origin only when that origin is in use',()=>{
 assert.equal(postformeURL('http://127.0.0.1:54011/oauth?x=1','http://127.0.0.1:54011'),'http://127.0.0.1:54011/oauth?x=1');
 assert.equal(postformeURL('http://127.0.0.1:54011/oauth'),null);
 assert.equal(postformeURL('http://127.0.0.1:9999/oauth','http://127.0.0.1:54011'),null);
 assert.equal(postformeURL('https://app.postforme.dev/connect'),'https://app.postforme.dev/connect');
});
test('a client on the mock origin calls it and uploads only to it',async()=>{
 const seen=[];const origin='http://127.0.0.1:54011';
 const client=new PostformeClient('key',async(url,options)=>{seen.push([String(url),options.method]);
  if(String(url).endsWith('/v1/media/create-upload-url'))return Response.json({upload_url:`${origin}/upload/a`,media_url:`${origin}/media/a`});
  return new Response(null,{status:200});},origin);
 assert.equal(await client.upload(Buffer.from('png'),'image/png'),`${origin}/media/a`);
 assert.deepEqual(seen,[[`${origin}/v1/media/create-upload-url`,'POST'],[`${origin}/upload/a`,'PUT']]);
 const elsewhere=new PostformeClient('key',async url=>String(url).endsWith('create-upload-url')?Response.json({upload_url:'http://127.0.0.1:1/upload',media_url:`${origin}/media/a`}):new Response(null),origin);
 await assert.rejects(elsewhere.upload(Buffer.from('png'),'image/png'),e=>e instanceof PostformeError&&e.code==='POSTFORME_INVALID_UPLOAD');
});
test('the production client never accepts a plain-http upload target',async()=>{
 const client=new PostformeClient('key',async()=>Response.json({upload_url:'http://127.0.0.1:54011/upload',media_url:'http://127.0.0.1:54011/m'}));
 await assert.rejects(client.upload(Buffer.from('png'),'image/png'),e=>e.code==='POSTFORME_INVALID_UPLOAD');
});
