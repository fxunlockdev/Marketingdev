import test from 'node:test';
import assert from 'node:assert/strict';
import {WebsiteRenderBroker} from '../../dist/website-render-broker.js';
import {renderMessage} from '../../dist/website-renderer.js';
import {SafeWeb,IntakeError} from '../../dist/safe-web.js';
const response=(status,body='',mime='text/html',extra={})=>({status,bytes:Buffer.from(body),headers:{'content-type':mime,...extra}});
const request=(url='https://brand.example/',resourceType='document')=>({id:1,url,resourceType,method:'GET'});
test('render broker denies private DNS, POST, foreign document/API and media types',async()=>{
 const privateWeb=new SafeWeb(async()=>[{address:'127.0.0.1',family:4}]);
 await assert.rejects(new WebsiteRenderBroker('https://brand.example',privateWeb).request(request()),{code:'WEBSITE_ADDRESS_BLOCKED'});
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async()=>{throw new Error('must not fetch');}});
 for(const value of [{...request(),method:'POST'},request('https://other.example/'),request('https://other.example/api','fetch'),request('https://brand.example/a','media'),request('https://brand.example/a','constructor'),request('https://brand.example/a','__proto__')])await assert.rejects(broker.request(value));
});
test('robots denial, unsafe redirects, MIME rejection never release content',async()=>{
 const blocked=new WebsiteRenderBroker('https://brand.example',{fetch:async()=>response(200,'User-agent: *\nDisallow: /','text/plain')});
 await assert.rejects(blocked.request(request()),{code:'WEBSITE_TEXT_DISALLOWED'});
 for(const bad of [response(302,'','text/html',{location:'http://127.0.0.1/'}),response(200,'pdf','application/pdf')]){
  const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async u=>u.pathname==='/robots.txt'?response(404):bad});await assert.rejects(broker.request(request()));
 }
});
test('safe resources discard upstream cookies/auth/CSP and enforce finite requests',async()=>{
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async u=>u.pathname==='/robots.txt'?response(404):response(200,'hello','text/html',{'set-cookie':'secret','authorization':'secret'})});
 const result=await broker.request(request());assert.equal(Buffer.from(result.body,'base64').toString(),'hello');assert.deepEqual(Object.keys(result.headers).sort(),['access-control-allow-origin','content-type']);
 broker.requests=80;await assert.rejects(broker.request(request()),{code:'WEBSITE_RENDER_LIMIT'});
});
test('revoked tenant permission stops broker and public mixed DNS answers rejected',async()=>{
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async()=>response(200)},async()=>false);await assert.rejects(broker.request(request()),{code:'ACCESS_REVOKED_OR_CANCELED'});
 const mixed=new SafeWeb(async()=>[{address:'93.184.216.34',family:4},{address:'::1',family:6}]);await assert.rejects(new WebsiteRenderBroker('https://brand.example',mixed).request(request()),{code:'WEBSITE_ADDRESS_BLOCKED'});
});

test('child IPC rejects JSON primitives and arrays without dereferencing them',()=>{for(const text of ['null','true','42','\"text\"','[]','{}'])assert.throws(()=>renderMessage(text),{code:'WEBSITE_RENDER_OUTPUT_INVALID'});assert.equal(renderMessage('{\"type\":\"result\"}').type,'result');});

test('fixed child launch failure retains its failure code',()=>{assert.throws(()=>renderMessage('{"type":"error","error":"WEBSITE_RENDER_FAILED"}'),{code:'WEBSITE_RENDER_FAILED'});});

test('concurrent same-origin resources share a robots read and retain path denials',async()=>{
 let robots=0,release;const ready=new Promise(resolve=>{release=resolve;});
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async u=>{
  if(u.pathname==='/robots.txt'){robots++;await ready;return response(200,'User-agent: *\nDisallow: /private','text/plain');}
  return response(200,'photo','image/png');
 }});
 const pending=Array.from({length:12},(_,i)=>broker.request({...request(`https://brand.example/photo${i}.png`,'image'),id:i+1}));
 const denied=assert.rejects(broker.request(request('https://brand.example/private.png','image')),{code:'WEBSITE_TEXT_DISALLOWED'});
 release();await Promise.all([...pending,denied]);assert.equal(robots,1);assert.equal(broker.requests,13);assert.equal(broker.images.size,12);
});
test('failed concurrent robots read is not cached as permission and can recover',async()=>{
 let robots=0;const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async u=>{
  if(u.pathname==='/robots.txt'){robots++;return response(robots===1?503:404);}
  return response(200,'page');
 }});
 await Promise.all([assert.rejects(broker.request(request()),{code:'WEBSITE_TEXT_ROBOTS_UNAVAILABLE'}),assert.rejects(broker.request(request()),{code:'WEBSITE_TEXT_ROBOTS_UNAVAILABLE'})]);
 assert.equal(robots,1);await broker.request(request());assert.equal(robots,2);
});

test('browser image bursts queue within the byte ceiling rather than dropping photos',async()=>{
 let concurrent=0,peak=0;
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async u=>{
  if(u.pathname==='/robots.txt')return response(404);
  concurrent++;peak=Math.max(peak,concurrent);await new Promise(resolve=>setTimeout(resolve,5));concurrent--;
  return response(200,'photo','image/png');
 }});
 await Promise.all(Array.from({length:20},(_,i)=>broker.request({...request(`https://brand.example/p${i}.png`,'image'),id:i+1})));
 assert.equal(broker.images.size,20);assert.equal(peak,4);assert.equal(broker.requests,21);
});

for(const boundary of ['revoked','expired'])test(`queued render resources recheck ${boundary} boundary before fetching`,async()=>{
 let allowed=true,started=0,release,notify;
 const held=new Promise(resolve=>{release=resolve;}),fourStarted=new Promise(resolve=>{notify=resolve;});
 const broker=new WebsiteRenderBroker('https://brand.example',{fetch:async()=>{
  if(++started===4)notify();
  await held;return response(200,'photo','image/png');
 }},async()=>allowed);
 broker.rules.set('https://brand.example',null);
 const results=Promise.allSettled(Array.from({length:12},(_,i)=>broker.request({...request(`https://brand.example/image${i}.png`,'image'),id:i+1})));
 await fourStarted;
 if(boundary==='revoked')allowed=false;else broker.started=Date.now()-45001;
 release();
 const values=await results;
 assert.equal(started,4,'queued requests must not reach the network after boundary changes');
 assert.equal(values.filter(v=>v.status==='fulfilled').length,4);
 for(const value of values.filter(v=>v.status==='rejected'))assert.equal(value.reason.code,boundary==='revoked'?'ACCESS_REVOKED_OR_CANCELED':'WEBSITE_RENDER_LIMIT');
});
