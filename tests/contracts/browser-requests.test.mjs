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
