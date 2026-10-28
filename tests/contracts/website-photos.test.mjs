import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {WebsitePhotos,websitePhotoCandidates} from '../../dist/website-photos.js';
import {SafeWeb} from '../../dist/safe-web.js';
const response=(status,type,bytes,headers={})=>({status,headers:{'content-type':type,...headers},bytes:Buffer.from(bytes)});
test('photo candidates parse real HTML entities, relative/lazy URLs and ignore scripts, tiny icons and unsafe protocols',()=>{
 const result=websitePhotoCandidates(`<script>"<img src='/fake.jpg'>"</script><meta property='og:image' content='/hero.jpg?a=1&amp;b=2'><img src='/tiny.png' width='20'><img data-src='//cdn.example.org/product.jpg' alt='A &amp; B'><img src='data:image/png,bad'><img src='http://127.0.0.1/secret'><img src='/hero.jpg?a=1&amp;b=2'>`,'https://example.org/about');
 assert.deepEqual(result,[{url:'https://example.org/hero.jpg?a=1&b=2',label:'Website image'},{url:'https://cdn.example.org/product.jpg',label:'A & B'}]);
});
test('photo capture follows public redirects, respects robots, normalizes and deduplicates raster images',async()=>{
 const png=await sharp({create:{width:640,height:480,channels:4,background:'#aabbcc88'}}).png().toBuffer(),calls=[];
 const capture=await new WebsitePhotos({fetch:async(url,max,accept,timeout)=>{
  calls.push(url.href);assert.equal(timeout,5000);
  if(url.pathname==='/robots.txt')return response(200,'text/plain','User-agent: *\nDisallow: /private');
  if(url.pathname==='/')return response(200,'text/html',`<img src='/redirect'><img src='/same.png'><img src='/private.png'><img src='/bad.svg'>`);
  if(url.pathname==='/redirect')return response(302,'text/plain','',{location:'https://cdn.example.org/image.png'});
  if(url.pathname==='/bad.svg')return response(200,'image/svg+xml','<svg/>');
  return response(200,'image/png',png);
 }}).capture('https://example.org/');
 assert.equal(capture.snapshots.length,1);assert.equal(capture.snapshots[0].label,'photo');assert.equal(capture.snapshots[0].observations.source_url,'https://cdn.example.org/image.png');
 assert.equal((await sharp(Buffer.from(capture.snapshots[0].screenshot,'base64')).metadata()).format,'jpeg');
 assert.ok(!calls.some(u=>u.includes('/private.png')));assert.ok(capture.failures.some(f=>f.reason==='WEBSITE_PHOTO_DISALLOWED'));assert.ok(capture.failures.some(f=>f.reason==='WEBSITE_PHOTO_TYPE_UNSUPPORTED'));
});
test('private DNS and blocked sites fail photo enrichment safely, without a public fetch or empty fabricated image',async()=>{
 const privateResult=await new WebsitePhotos(new SafeWeb(async()=>[{address:'127.0.0.1',family:4}])).capture('https://example.org/');
 assert.equal(privateResult.snapshots.length,0);assert.equal(privateResult.failures[0].reason,'WEBSITE_ADDRESS_BLOCKED');
 let calls=0;const blocked=await new WebsitePhotos({fetch:async()=>{calls++;return response(403,'text/plain','Denied');}}).capture('https://example.org/');assert.equal(calls,1);assert.equal(blocked.snapshots.length,0);
});
test('photo enrichment caps candidate requests and rejects invalid image bytes',async()=>{
 let calls=0;const result=await new WebsitePhotos({fetch:async(url)=>{calls++;if(url.pathname==='/robots.txt')return response(404,'text/plain','');if(url.pathname==='/')return response(200,'text/html',Array.from({length:100},(_,i)=>`<img src='/${i}.jpg'>`).join(''));return response(200,'image/jpeg','bad bytes');}}).capture('https://example.org/');
 assert.equal(result.snapshots.length,0);assert.equal(calls,18);assert.ok(result.failures.every(f=>f.reason==='WEBSITE_PHOTO_INVALID'));
});
test('multi-page capture collects distinct brand photos, shares robots and skips repeated images',async()=>{
 const photos=await Promise.all(['#aa0000','#00aa00','#0000aa'].map(background=>sharp({create:{width:640,height:480,channels:3,background}}).png().toBuffer()));
 const calls=[];let permissionChecks=0;
 const provider=new WebsitePhotos({fetch:async url=>{
  calls.push(url.href);
  if(url.pathname==='/robots.txt')return response(404,'text/plain','');
  if(url.pathname.endsWith('.png'))return response(200,'image/png',photos[Number(url.pathname[1])]);
  if(url.pathname==='/broken')return response(503,'text/html','');
  return response(200,'text/html',`<img src='/0.png'><img src='/${url.pathname==='/about'?1:2}.png'>`);
 }});
 const captures=await provider.capturePages(['https://example.org/about','https://example.org/broken','https://example.org/products'],async()=>{permissionChecks++;});
 assert.equal(permissionChecks,3);assert.deepEqual(captures.map(c=>c.snapshots.length),[2,0,1]);
 assert.equal(captures[2].snapshots[0].observations.page_url,'https://example.org/products');
 assert.equal(calls.filter(u=>u.endsWith('/robots.txt')).length,1);
 assert.equal(captures.reduce((n,c)=>n+c.requests,0),calls.length);
 assert.equal(captures[1].failures[0].reason,'WEBSITE_PHOTO_FETCH_FAILED');
});
test('multi-page capture enforces shared request and page limits and honors cancellation',async()=>{
 const calls=[];const provider=new WebsitePhotos({fetch:async url=>{
  calls.push(url.href);if(url.pathname==='/robots.txt')return response(404,'text/plain','');
  if(url.pathname.endsWith('.png'))return response(200,'image/png','invalid');
  return response(200,'text/html',Array.from({length:24},(_,i)=>`<img src='/${i}.png'>`).join(''));
 }});
 const captures=await provider.capturePages(Array.from({length:8},(_,i)=>`https://example.org/page${i}`));
 assert.equal(calls.length,48);assert.ok(captures.length<=4);assert.ok(captures.every(c=>!c.snapshots.length));
 const before=calls.length;await assert.rejects(provider.capturePages(['https://example.org/'],async()=>{throw new Error('ACCESS_REVOKED');}),/ACCESS_REVOKED/);assert.equal(calls.length,before);
});
test('multi-page capture caps the saved collection at twenty photos over four pages',async()=>{
 const images=await Promise.all(Array.from({length:30},(_,i)=>sharp({create:{width:300,height:200,channels:3,background:{r:i*8,g:40,b:90}}}).png().toBuffer()));
 const pages=[];const provider=new WebsitePhotos({fetch:async url=>{
  if(url.pathname==='/robots.txt')return response(404,'text/plain','');
  if(url.pathname.endsWith('.png'))return response(200,'image/png',images[Number(url.pathname.slice(1,-4))]);
  pages.push(url.pathname);const start=Number(url.pathname.slice(2))*6;
  return response(200,'text/html',Array.from({length:6},(_,i)=>`<img src='/${start+i}.png'>`).join(''));
 }});
 const captures=await provider.capturePages(Array.from({length:5},(_,i)=>`https://example.org/p${i}`));
 assert.deepEqual(pages,['/p0','/p1','/p2','/p3']);assert.deepEqual(captures.map(c=>c.snapshots.length),[6,6,6,2]);
 assert.equal(new Set(captures.flatMap(c=>c.snapshots.map(s=>s.sha256))).size,20);
});

test('responsive picture and inline hero backgrounds discover photos without treating arbitrary styles as fetch instructions',()=>{
 const items=websitePhotoCandidates(`<picture><source type="image/webp" srcset="/small.webp 400w, /hero.webp 1600w"><source type="video/mp4" srcset="/movie.mp4 2x"></picture><section aria-label="Our homes" style="background-image: url('/homes.jpg'); color: red"></section><div style="cursor: url('/cursor.png');background: url(http://127.0.0.1/private)"></div><div style="background-image: url(data:image/png;base64,bad)"></div>`, 'https://example.org/about');
 assert.deepEqual(items,[{url:'https://example.org/hero.webp',label:'Website image'},{url:'https://example.org/homes.jpg',label:'Our homes'}]);
});
