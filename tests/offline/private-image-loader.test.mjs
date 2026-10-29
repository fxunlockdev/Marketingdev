import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync('apps/web/components/load-private-image.ts','utf8').replace("import {api} from './api';","const api=async (...args)=>globalThis.__imageGrant(...args);"));
const {loadPrivateImage}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const bytes=new Uint8Array([1,2,3]);
const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const originalFetch=globalThis.fetch;
test('private image recovery and integrity',async t=>{
 try{
  await t.test('refreshes the grant after a failed signed download',async()=>{
   let grants=0,downloads=0;globalThis.__imageGrant=async()=>({url:'https://example.test/'+(++grants),bytes:3,sha256:hash});
   globalThis.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');assert.ok(options.signal);if(++downloads===1)return new Response('',{status:403});return new Response(bytes,{headers:{'content-type':'image/png'}});};
   assert.equal((await loadPrivateImage('/scoped/business/media',new AbortController().signal)).size,3);assert.equal(grants,2);assert.equal(downloads,2);
  });
  await t.test('never returns corrupt bytes',async()=>{
   globalThis.__imageGrant=async()=>({url:'https://example.test/image',bytes:3,sha256:'0'.repeat(64)});globalThis.fetch=async()=>new Response(bytes,{headers:{'content-type':'image/png'}});
   await assert.rejects(loadPrivateImage('/scoped/business/media',new AbortController().signal),/could not load/);
  });
  await t.test('bounds repeated download failures to two attempts',async()=>{
   let attempts=0;globalThis.__imageGrant=async()=>({url:'https://example.test/image'});globalThis.fetch=async()=>{attempts++;throw new DOMException('Timed out','TimeoutError');};
   await assert.rejects(loadPrivateImage('/scoped/business/media',new AbortController().signal));assert.equal(attempts,2);
  });
  await t.test('unmount cancellation does not retry',async()=>{
   let grants=0;globalThis.__imageGrant=async()=>{grants++;return {url:'https://example.test/image'};};const c=new AbortController();c.abort();await assert.rejects(loadPrivateImage('/scoped/business/media',c.signal));assert.equal(grants,0);
  });
 }finally{globalThis.fetch=originalFetch;delete globalThis.__imageGrant;}
});
