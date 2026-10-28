import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {capture} from '../../apps/website-renderer/runtime.mjs';
import {WebsiteRenderBroker} from '../../dist/website-render-broker.js';
import {normalizeRenderedCapture} from '../../dist/website-renderer.js';

test('real Chromium renders JS-inserted brand text/photo using only intercepted fixture resources',async()=>{
 const png=await sharp({create:{width:300,height:200,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const html='<!doctype html><html><body><main id="brand"></main><script src="/app.js"></script></body></html>';
 const script=`document.querySelector('#brand').textContent=${JSON.stringify('This is real fixture brand evidence inserted only by JavaScript. '.repeat(8))};const image=document.createElement('img');image.src='/brand.png';image.alt='Real fixture photograph';document.body.append(image);fetch('https://blocked.example/private');fetch('/write',{method:'POST'});history.replaceState({},'', '/not-fetched');`;
 const requests=[];
 const broker=new WebsiteRenderBroker('https://brand.example/',{fetch:async url=>{
  requests.push(url.href);let bytes=Buffer.alloc(0),mime='text/html',status=200;
  if(url.pathname==='/robots.txt')status=404;
  else if(url.pathname==='/')bytes=Buffer.from(html);
  else if(url.pathname==='/app.js'){bytes=Buffer.from(script);mime='text/javascript';}
  else if(url.pathname==='/brand.png'){bytes=png;mime='image/png';}
  else throw new Error('unrecognized fixture request');
  return {status,bytes,headers:{'content-type':mime}};
 }});
 const browser=await chromium.launch({headless:true});
 try{
  const raw=await capture(browser,'https://brand.example/',r=>broker.request(r).catch(()=>({id:r.id,error:'denied'})));
  assert.equal(raw.pages.length,1);assert.equal(raw.pages[0].url,'https://brand.example/');assert.match(raw.pages[0].text,/inserted only by JavaScript/);assert.equal(raw.pages[0].images[0].url,'https://brand.example/brand.png');
  assert.ok(!requests.some(u=>u.includes('blocked.example')||u.endsWith('/write')));
  const normalized=await normalizeRenderedCapture(raw,'https://brand.example/',broker);
  assert.equal(normalized.coverage.photosAvailable,1);assert.equal(normalized.captures.values().next().value.capture.snapshots[1].label,'photo');assert.equal(normalized.pages[0].coverage,'rendered_provider');
  await assert.rejects(normalizeRenderedCapture({...raw,pages:[{...raw.pages[0],url:'https://brand.example/not-fetched'}]},'https://brand.example/',broker),{code:'WEBSITE_RENDER_PROVENANCE_INVALID'});
 }finally{await browser.close();}
});

test('committed useful DOM survives stalled deferred scripts and fonts without weakening provenance',async()=>{
 const evidence='Actual committed fixture evidence about the brand, its products and services. '.repeat(8);
 const png=await sharp({create:{width:300,height:200,channels:3,background:'#778899'}}).png().toBuffer();
 let release;const blocked=new Promise(resolve=>{release=resolve;}),requests=[];
 const broker=new WebsiteRenderBroker('https://brand.example/',{fetch:async url=>{
  requests.push(url.href);
  if(url.pathname==='/robots.txt')return {status:404,bytes:Buffer.alloc(0),headers:{'content-type':'text/plain'}};
  if(url.pathname==='/')return {status:200,bytes:Buffer.from(`<!doctype html><html><head><style>@font-face{font-family:Slow;src:url('/slow.woff2')}main{font-family:Slow,serif}</style><script defer src="/slow.js"></script></head><body><main>${evidence}</main><img src="/photo.png" width="300" height="200" alt="Fixture photo"></body></html>`),headers:{'content-type':'text/html'}};
  if(url.pathname==='/photo.png')return {status:200,bytes:png,headers:{'content-type':'image/png'}};
  if(['/slow.js','/slow.woff2'].includes(url.pathname)){await blocked;return {status:200,bytes:Buffer.from(''),headers:{'content-type':url.pathname.endsWith('.js')?'text/javascript':'font/woff2'}};}
  throw new Error('Unexpected fixture network request');
 }});
 const browser=await chromium.launch({headless:true});
 try{
  const began=Date.now(),raw=await capture(browser,'https://brand.example/',r=>broker.request(r).catch(()=>({id:r.id,error:'denied'})));
  assert.equal(raw.pages.length,1);assert.equal(raw.pages[0].url,'https://brand.example/');assert.equal(raw.pages[0].text.trim(),evidence.trim());assert.ok(Date.now()-began<22000);assert.ok(raw.failures.some(f=>f.code==='DOM_LOAD_TIMEOUT'));assert.ok(raw.failures.every(f=>Object.keys(f).sort().join(',')==='code,page'));
  const normalized=await normalizeRenderedCapture(raw,'https://brand.example/',broker);assert.equal(normalized.pages.length,1);assert.equal(normalized.coverage.photosAvailable,1);assert.ok(requests.some(url=>url.endsWith('/slow.js')));
 }finally{release();await browser.close();}
});

test('failed follow-up navigation cannot inherit the previous committed document',async()=>{
 const evidence='Independently fetched root evidence about this business. '.repeat(8);
 const broker=new WebsiteRenderBroker('https://brand.example/',{fetch:async url=>{
  if(url.pathname==='/robots.txt')return {status:404,bytes:Buffer.alloc(0),headers:{'content-type':'text/plain'}};
  if(url.pathname==='/')return {status:200,bytes:Buffer.from(`<html><body><main>${evidence}</main><a href="/about">About</a></body></html>`),headers:{'content-type':'text/html'}};
  throw new Error('Fixture follow-up cannot be fetched');
 }});
 const browser=await chromium.launch({headless:true});
 try{const raw=await capture(browser,'https://brand.example/',r=>broker.request(r).catch(()=>({id:r.id,error:'denied'})));assert.equal(raw.pages.length,1);assert.equal(raw.pages[0].url,'https://brand.example/');assert.match(raw.pages[0].text,/Independently fetched root/);await normalizeRenderedCapture(raw,'https://brand.example/',broker);}
 finally{await browser.close();}
});

test('a new committed document cannot be attributed to the previous navigation response',async()=>{
 const browser=await chromium.launch({headless:true});
 const text='Usable fixture evidence from a distinct document. '.repeat(8);
 const broker=new WebsiteRenderBroker('https://brand.example/',{fetch:async url=>{
  if(url.pathname==='/robots.txt')return {status:404,bytes:Buffer.alloc(0),headers:{'content-type':'text/plain'}};
  const body=url.pathname==='/'?`<html><body><main>${text}</main><script>setTimeout(()=>location.replace('/different'),100)</script></body></html>`:`<html><body><main>Different page ${text}</main></body></html>`;
  return {status:200,bytes:Buffer.from(body),headers:{'content-type':'text/html'}};
 }});
 try{const raw=await capture(browser,'https://brand.example/',r=>broker.request(r).catch(()=>({id:r.id,error:'denied'})));assert.equal(raw.pages.length,0);assert.ok(raw.failures.some(f=>f.code==='DOCUMENT_CHANGED'));}
 finally{await browser.close();}
});

test('screenshot deadline retains proven DOM and fetched photos without claiming a screenshot',async()=>{
 const browser=await chromium.launch({headless:true});
 const png=await sharp({create:{width:300,height:200,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const broker=new WebsiteRenderBroker('https://brand.example/',{fetch:async url=>{
  if(url.pathname==='/robots.txt')return {status:404,bytes:Buffer.alloc(0),headers:{'content-type':'text/plain'}};
  if(url.pathname==='/photo.png')return {status:200,bytes:png,headers:{'content-type':'image/png'}};
  return {status:200,bytes:Buffer.from(`<html><body><main>${'Actual brand evidence retained when screenshot capture stalls. '.repeat(8)}</main><img src='/photo.png' width='300' height='200'></body></html>`),headers:{'content-type':'text/html'}};
 }});
 // Real Chromium and broker; only screenshot completion is fault-injected.
 const wrapped={newContext:async options=>{
  const context=await browser.newContext(options),newSession=context.newCDPSession.bind(context);
  context.newCDPSession=async page=>{
   const session=await newSession(page),send=session.send.bind(session);
   session.send=(method,...args)=>method==='Page.captureScreenshot'?new Promise(()=>{}):send(method,...args);
   return session;
  };return context;
 }};
 try{
  const raw=await capture(wrapped,'https://brand.example/',r=>broker.request(r).catch(()=>({id:r.id,error:'denied'})));
  assert.equal(raw.pages.length,1);assert.equal(raw.pages[0].screenshot,undefined);
  assert.ok(raw.failures.some(f=>f.code==='SCREENSHOT_TIMEOUT'));
  const normalized=await normalizeRenderedCapture(raw,'https://brand.example/',broker);
  assert.equal(normalized.pages.length,1);assert.equal(normalized.coverage.screenshotsAvailable,false);assert.equal(normalized.coverage.photosAvailable,1);
  const snapshots=normalized.captures.get('https://brand.example/').capture.snapshots;
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].label,'photo');assert.equal(snapshots[0].observations.source_url,'https://brand.example/photo.png');
  await assert.rejects(normalizeRenderedCapture({...raw,pages:[{...raw.pages[0],url:'https://brand.example/not-fetched'}]},'https://brand.example/',broker),{code:'WEBSITE_RENDER_PROVENANCE_INVALID'});
 }finally{await browser.close();}
});
