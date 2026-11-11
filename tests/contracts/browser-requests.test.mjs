import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('../../apps/web/components/api.ts',import.meta.url),'utf8'));
const {api}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('concurrent reads coalesce, completed results are not cached, writes never coalesce and invalidate pending reads',async()=>{
 const original=globalThis.fetch;let calls=[];
 globalThis.fetch=(path,options)=>new Promise(resolve=>calls.push({path,options,resolve}));
 const respond=(i,value)=>calls[i].resolve(new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}}));
 try{
  const a=api('/api/v1/businesses'),b=api('/api/v1/businesses');assert.equal(calls.length,1);respond(0,{businesses:[]});await Promise.all([a,b]);
  const fresh=api('/api/v1/businesses');assert.equal(calls.length,2);
  const writeA=api('/api/v1/businesses',{name:'A'}),writeB=api('/api/v1/businesses',{name:'B'});assert.equal(calls.length,4);
  const afterWrite=api('/api/v1/businesses');assert.equal(calls.length,5);
  respond(1,{old:true});respond(2,{});respond(3,{});respond(4,{fresh:true});await Promise.all([fresh,writeA,writeB]);assert.deepEqual(await afterWrite,{fresh:true});
  const foreign=api('/api/v1/businesses/other'),same=api('/api/v1/businesses');assert.equal(calls.length,7);respond(5,{});respond(6,{});await Promise.all([foreign,same]);
  assert.ok(calls.every(c=>c.options.cache==='no-store'));
 }finally{globalThis.fetch=original;}
});

test('transient GET failures retry once, coalesce callers, and retain the original deadline',async()=>{
 const original=globalThis.fetch;
 try{
  for(const failure of ['network',502,503,504]){
   const calls=[];
   globalThis.fetch=async(path,options)=>{
    calls.push(options);
    if(calls.length===1){if(failure==='network')throw Error('offline');return new Response('gateway unavailable',{status:failure});}
    return Response.json({loaded:true});
   };
   const a=api('/api/v1/read-recovery'),b=api('/api/v1/read-recovery');
   assert.equal(a,b);assert.deepEqual(await a,{loaded:true});assert.equal(calls.length,2);
   assert.equal(calls[0].signal,calls[1].signal);
  }
 }finally{globalThis.fetch=original;}
});

test('read retries are bounded; permission and rate-limit responses are not replayed',async()=>{
 const original=globalThis.fetch;
 try{
  for(const status of [401,403,404,409,429,500,502,503,504]){
   let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'Unavailable'},{status});};
   await assert.rejects(api('/api/v1/failed-read'),e=>e.status===status);
   assert.equal(calls,[502,503,504].includes(status)?2:1);
  }
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('offline');};
  await assert.rejects(api('/api/v1/offline'),e=>e.status===0&&e.message.includes('load your work'));
  assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

test('mutations never retry even with an idempotency key or a transient response',async()=>{
 const original=globalThis.fetch;
 try{
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const failure of ['network',502,503,504]){
   let calls=0;globalThis.fetch=async()=>{calls++;if(failure==='network')throw Error('unknown outcome');return Response.json({}, {status:failure});};
   await assert.rejects(api('/api/v1/mutation',{value:1},method,'stable-key'));
   assert.equal(calls,1);
  }
 }finally{globalThis.fetch=original;}
});

test('an expired read deadline cannot start another request',async()=>{
 const original=globalThis.fetch,timeout=AbortSignal.timeout;
 const controller=new AbortController();
 try{
  AbortSignal.timeout=()=>controller.signal;
  let calls=0;globalThis.fetch=async()=>{calls++;controller.abort();throw Error('deadline');};
  await assert.rejects(api('/api/v1/expired'),e=>e.status===0);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;AbortSignal.timeout=timeout;}
});
