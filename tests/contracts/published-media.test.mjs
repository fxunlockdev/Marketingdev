import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishedMedia} from '../../apps/web/lib/published-media.mjs';
const path=['2026','10','23','a'.repeat(32)+'.png'];
const env={NODE_ENV:'production',POSTIZ_MEDIA_PROXY_ORIGIN:'http://postiz.railway.internal:5000'};
const request=(options={})=>new Request('https://desvio.example/uploads/'+path.join('/'),options);
const png=()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png','content-length':'3'}});
test('delivery is disabled by default and rejects traversal, other files and invalid dates without network',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return png();};
 assert.equal((await publishedMedia(request(),path,{},fetcher)).status,404);
 for(const bad of [['..','secret'],['2026','02','30',path[3]],[...path.slice(0,3),'a'.repeat(32)+'.html'],[...path,'other']])assert.equal((await publishedMedia(request(),bad,env,fetcher)).status,404);
 assert.equal((await publishedMedia(request(),path,{...env,POSTIZ_MEDIA_PROXY_ORIGIN:'http://example.org'},fetcher)).status,503);
 assert.equal(calls,0);
});
test('only bounded media path and safe headers reach the configured private service',async()=>{
 const result=await publishedMedia(request({headers:{cookie:'private-session',authorization:'private-token','x-postiz-org':'foreign'}}),path,env,async(url,options)=>{
  assert.equal(url.href,env.POSTIZ_MEDIA_PROXY_ORIGIN+'/uploads/'+path.join('/'));assert.equal(options.redirect,'error');
  assert.deepEqual(options.headers,{accept:'image/png','accept-encoding':'identity'});return png();
 });
 assert.equal(result.status,200);assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[1,2,3]);assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(result.headers.get('set-cookie'),null);
});
test('redirects, wrong type, oversized responses and missing files never become successful media',async()=>{
 for(const response of [new Response(null,{status:302,headers:{location:'https://elsewhere.example'}}),new Response('html',{headers:{'content-type':'text/html','content-length':'4'}}),new Response(null,{headers:{'content-type':'image/png','content-length':String(64*1024*1024+1)}})])assert.equal((await publishedMedia(request(),path,env,async()=>response)).status,502);
 assert.equal((await publishedMedia(request(),path,env,async()=>new Response(null,{status:404}))).status,404);
});
test('video range delivery is bounded and validates actual returned range',async()=>{
 const video=[...path.slice(0,3),'b'.repeat(32)+'.mp4'],req=request({headers:{range:'bytes=1-2'}});
 const result=await publishedMedia(req,video,env,async(_,options)=>{assert.equal(options.headers.range,'bytes=1-2');return new Response(new Uint8Array([2,3]),{status:206,headers:{'content-type':'video/mp4','content-length':'2','content-range':'bytes 1-2/3'}});});
 assert.equal(result.status,206);assert.equal((await result.arrayBuffer()).byteLength,2);
 assert.equal((await publishedMedia(request({headers:{range:'bytes=0-1,2-3'}}),video,env,()=>{throw Error('must not fetch');})).status,416);
 assert.equal((await publishedMedia(req,video,env,async()=>new Response('xx',{status:206,headers:{'content-type':'video/mp4','content-length':'2','content-range':'bytes 0-1/3'}}))).status,502);
});
test('truncated or excess bodies fail during streaming and HEAD never sends a body',async()=>{
 for(const length of ['2','4']){const response=await publishedMedia(request(),path,env,async()=>new Response('abc',{headers:{'content-type':'image/png','content-length':length}}));await assert.rejects(response.arrayBuffer(),/MEDIA_LENGTH_INVALID/);}
 const response=await publishedMedia(request({method:'HEAD'}),path,env,async(_,options)=>{assert.equal(options.method,'HEAD');return new Response(null,{headers:{'content-type':'image/png','content-length':'3'}});});assert.equal(response.status,200);assert.equal(response.body,null);
});
