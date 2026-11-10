import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync('apps/web/components/load-private-image.ts','utf8').replace("import {api} from './api';","const api=async (...args)=>globalThis.__imageGrant(...args);"));
const {loadPrivatePreview}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const originalFetch=globalThis.fetch;
test('authenticated preview transfer and original recovery',async t=>{
 try{
  await t.test('small preview uses authenticated no-store request without an original grant',async()=>{
   globalThis.__imageGrant=()=>{throw Error('unnecessary original');};globalThis.fetch=async(url,opts)=>{assert.equal(url,'/preview');assert.equal(opts.credentials,'same-origin');assert.equal(opts.cache,'no-store');return new Response(new Uint8Array([1,2]),{headers:{'content-type':'image/webp'}});};
   assert.equal((await loadPrivatePreview('/preview','/original',new AbortController().signal)).size,2);
  });
  await t.test('duplicate consumers share one request and one unmount does not cancel the other',async()=>{
   let reads=0,release,fetchSignal;
   globalThis.fetch=async(_url,opts)=>{reads++;fetchSignal=opts.signal;await new Promise(r=>release=r);return new Response(new Uint8Array([1,2]),{headers:{'content-type':'image/webp'}});};
   const first=new AbortController(),second=new AbortController();
   const a=loadPrivatePreview('/shared','/original',first.signal),b=loadPrivatePreview('/shared','/original',second.signal);
   const rejected=assert.rejects(a);first.abort();await rejected;assert.equal(fetchSignal.aborted,false);release();
   assert.equal((await b).size,2);assert.equal(reads,1);
   // Completed private bytes must not be reused after a permission change.
   globalThis.fetch=async()=>new Response('',{status:403});await assert.rejects(loadPrivatePreview('/shared','/original',new AbortController().signal));
  });
  await t.test('the last cancellation aborts the transfer and a new consumer retries',async()=>{
   let fetchSignal;
   globalThis.fetch=async(_url,opts)=>{fetchSignal=opts.signal;return new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));};
   const controller=new AbortController(),request=loadPrivatePreview('/cancel','/original',controller.signal),rejected=assert.rejects(request);
   controller.abort();await rejected;assert.equal(fetchSignal.aborted,true);
   globalThis.fetch=async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/webp'}});
   assert.equal((await loadPrivatePreview('/cancel','/original',new AbortController().signal)).size,1);
  });
  await t.test('rolling deployment falls back to verified original download',async()=>{
   let grants=0;globalThis.__imageGrant=async()=>{grants++;return {url:'https://storage.test/image',bytes:2};};globalThis.fetch=async url=>url==='/preview'?new Response('',{status:404}):new Response(new Uint8Array([1,2]),{headers:{'content-type':'image/png'}});
   assert.equal((await loadPrivatePreview('/preview','/original',new AbortController().signal)).size,2);assert.equal(grants,1);
  });
  await t.test('access denial never falls back or returns cached bytes',async()=>{
   globalThis.__imageGrant=()=>{throw Error('unexpected grant');};globalThis.fetch=async()=>new Response('',{status:403});await assert.rejects(loadPrivatePreview('/preview','/original',new AbortController().signal));
  });
  await t.test('rejects oversized and invalid preview responses',async()=>{
   globalThis.fetch=async()=>new Response(new Uint8Array(1024*1024+1),{headers:{'content-type':'image/webp'}});await assert.rejects(loadPrivatePreview('/preview','/original',new AbortController().signal));
   globalThis.fetch=async()=>new Response('html',{headers:{'content-type':'text/html'}});await assert.rejects(loadPrivatePreview('/preview','/original',new AbortController().signal));
  });
 }finally{globalThis.fetch=originalFetch;delete globalThis.__imageGrant;}
});
