import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {WebsiteRenderer} from '../../dist/website-renderer.js';
import {WebsiteRenderBroker} from '../../dist/website-render-broker.js';
const image=process.env.WEBSITE_RENDER_TEST_IMAGE;
test('actual network-disabled container captures JS text and photo over bounded broker IPC',{skip:!image},async()=>{
 const png=await sharp({create:{width:300,height:200,channels:3,background:'#aabbcc'}}).png().toBuffer();
 const requests=[];let inspected=false;
 const transport={fetch:async url=>{
  if(!inspected){
   const ids=execFileSync('docker',['ps','-q','--filter','label=desvio.purpose=website-render-sandbox'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);assert.equal(ids.length,1);
   const container=JSON.parse(execFileSync('docker',['inspect',ids[0]],{encoding:'utf8'}))[0];
   assert.equal(container.HostConfig.NetworkMode,'none');assert.equal(container.HostConfig.ReadonlyRootfs,true);assert.equal(container.Config.User,'65534:65534');assert.ok(container.HostConfig.CapDrop.includes('ALL'));assert.equal(container.HostConfig.Memory,1073741824);assert.ok(container.Mounts.every(m=>m.Type==='tmpfs'&&m.Destination==='/tmp'));inspected=true;
  }
  requests.push(url.href);let bytes=Buffer.alloc(0),type='text/html',status=200;
  if(url.pathname==='/robots.txt')status=404;
  else if(url.pathname==='/')bytes=Buffer.from('<html><body><main id="brand"></main><script src="/app.js"></script></body></html>');
  else if(url.pathname==='/app.js'){type='text/javascript';bytes=Buffer.from(`document.querySelector('#brand').textContent=${JSON.stringify('Container fixture brand description created by JavaScript, never present in initial HTML. '.repeat(5))};const i=document.createElement('img');i.src='/photo.png';document.body.append(i);`);}
  else if(url.pathname==='/photo.png'){type='image/png';bytes=png;}
  else throw new Error('unknown fixture');
  return {status,bytes,headers:{'content-type':type}};
 }};
 const renderer=new WebsiteRenderer(image,(url,permitted)=>new WebsiteRenderBroker(url,transport,permitted));assert.equal(renderer.configured,true);
 const jobs={transaction:async(_scope,fn)=>fn({}, {kind:'website.extract'}),permitted:async()=>true};
 const output=await renderer.capture(jobs,{},'https://brand.example/');
 assert.equal(inspected,true);assert.match(output.pages[0].chunks[0].text,/created by JavaScript/);assert.equal(output.coverage.photosAvailable,1);assert.ok(requests.includes('https://brand.example/photo.png'));
});
