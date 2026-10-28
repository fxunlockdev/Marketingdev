import test from 'node:test';
import assert from 'node:assert/strict';
import {StockProvider,stockPhoto,stockURL} from '../../dist/stock-provider.js';
const photo={id:42,alt:'A calm home',photographer:'Photo Author',url:'https://www.pexels.com/photo/home-42/',photographer_url:'https://www.pexels.com/@author',src:{medium:'https://images.pexels.com/photos/42/medium.jpeg',large2x:'https://images.pexels.com/photos/42/large.jpeg'}};
test('stock search uses fixed origin and server authorization, validates pagination and caches',async()=>{
 const calls=[];const provider=new StockProvider('private-key',async(url,options)=>{calls.push({url,options});return Response.json({photos:[photo],total_results:21});});
 const r=await provider.search('calm home',1);assert.equal(r.photos[0].id,42);assert.equal(r.has_more,true);assert.equal(calls[0].url,'https://api.pexels.com/v1/search?query=calm%20home&page=1&per_page=18');assert.equal(calls[0].options.headers.Authorization,'private-key');assert.equal(calls[0].options.redirect,'error');assert.ok(!JSON.stringify(r).includes('private-key'));await provider.search('calm home',1);assert.equal(calls.length,1);
 await assert.rejects(provider.search('',1),/1–100/);await assert.rejects(provider.search('home',101),/Invalid stock page/);await assert.rejects(provider.photo('https://evil.test'),/Choose a stock photo/);
});
test('missing config and provider errors are actionable and never expose credentials',async()=>{
 await assert.rejects(new StockProvider().search('home'),/currently unavailable/);
 for(const status of [401,429,500])await assert.rejects(new StockProvider('private-key',async()=>new Response('private-key secret',{status})).search('home'),e=>!e.message.includes('private-key')&&/could not load/.test(e.message));
});
test('stock origins reject credentials, redirects, private and lookalike hosts',()=>{
 for(const url of ['http://images.pexels.com/a','https://images.pexels.com.evil.test/a','https://127.0.0.1/a','https://user@images.pexels.com/a','https://images.pexels.com:444/a'])assert.throws(()=>stockURL(url,'images.pexels.com'));
 assert.throws(()=>stockPhoto({...photo,src:{...photo.src,large2x:'https://evil.test/image'}}));
});
test('photo retrieval checks schema, serves only bounded raster image bytes without provider auth',async()=>{
 const calls=[];const provider=new StockProvider('secret',async(url,options)=>{calls.push({url,options});return url.includes('/v1/')?Response.json(photo):new Response(Buffer.from([255,216,255,1]),{headers:{'content-type':'image/jpeg'}});});
 const p=await provider.photo(42),image=await provider.image(p,true);assert.equal(image.type,'image/jpeg');assert.equal(image.bytes.length,4);assert.equal(calls[1].url,photo.src.medium);assert.equal(calls[1].options.headers,undefined);
 for(const [type,body,headers] of [['image/svg+xml','<svg/>',{}],['image/png','notpng',{}],['image/jpeg','x',{'content-length':'999999999'}]]){const bad=new StockProvider('key',async()=>new Response(body,{headers:{'content-type':type,...headers}}));await assert.rejects(bad.image(stockPhoto(photo)),/could not download/);}
});
test('malformed search photo cannot become a public media URL',async()=>{
 const provider=new StockProvider('key',async()=>Response.json({photos:[{...photo,url:'javascript:alert(1)'}]}));await assert.rejects(provider.search('home'),/invalid result/);
});
