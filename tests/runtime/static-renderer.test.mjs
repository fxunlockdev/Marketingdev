import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {StaticRenderer} from '../../dist/static-renderer.js';
const image=process.env.STATIC_RENDER_IMAGE;
assert.match(image,/^sha256:[a-f0-9]{64}$/);

test('isolated static renderer handles photographic-size PNG bytes without data-URL heap exhaustion',async()=>{
 // Synthetic high-entropy pixels reproduce the multi-megabyte input size of GPT photos;
 // no customer asset or provider call is used in this regression.
 const pixels=Buffer.alloc(1024*1024*3);let state=731;
 for(let i=0;i<pixels.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;pixels[i]=state>>>24;}
 const png=await sharp(pixels,{raw:{width:1024,height:1024,channels:3}}).png().toBuffer();assert.ok(png.length>2*1024*1024);
 const design={schema_version:1,background_media_id:randomUUID(),width:1024,height:1024,layers:[{id:'headline',type:'text',text:'A real image, ready to review',fontFamily:'Georgia',fontSize:48,fill:'#ffffff',align:'left',width:565,x:380,y:105}]};
 const renderer=new StaticRenderer(image);
 for(const format of ['png','instagram-jpeg']){
  const result=await renderer.render(design,png,format),decoded=await sharp(result.bytes).metadata();
  assert.equal(decoded.format,format==='png'?'png':'jpeg');assert.equal(result.width,format==='png'?1024:1080);assert.equal(result.height,format==='png'?1024:1080);assert.equal(result.manifest.image,image);
  assert.equal(result.manifest.fabric,'7.4.0');assert.equal(result.manifest.canvas,'3.2.0');
 }
});

test('text backing is rendered behind editable text and included in overflow validation',async()=>{
 const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#ffffff'}}).png().toBuffer();
 const layer={id:'headline',type:'text',text:'Clear message',fontFamily:'Arial',fontSize:48,fill:'#ffffff',align:'left',width:600,x:100,y:100,fontWeight:700,backing:{fill:'#111111',opacity:.88,padding:16}};
 const design={schema_version:1,background_media_id:randomUUID(),width:1024,height:1024,layers:[layer]},renderer=new StaticRenderer(image);
 const result=await renderer.render(design,png),{data,info}=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});
 const pixel=(x,y)=>data[(y*info.width+x)*info.channels];
 assert.ok(pixel(90,90)<55,'padding pixel must have dark backing');assert.equal(pixel(80,80),255,'outside backing preserves photograph');
 let lightTextPixels=0;for(let y=100;y<150;y++)for(let x=100;x<450;x++)if(pixel(x,y)>230)lightTextPixels++;
 assert.ok(lightTextPixels>100,'white glyphs remain above backing');
 const legacy={...design,layers:[{...layer}]};delete legacy.layers[0].backing;delete legacy.layers[0].fontWeight;
 const old=await renderer.render(legacy,png),oldPixel=await sharp(old.bytes).extract({left:90,top:90,width:1,height:1}).raw().toBuffer();assert.equal(oldPixel[0],255,'legacy design receives no implicit backing');
 await assert.rejects(()=>renderer.render({...design,layers:[{...layer,y:970}]},png),/EXPORT_TEXT_OVERFLOW/);
});

test('bundled brand fonts render distinct families and requested weights in saved exports',async()=>{
 const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#ffffff'}}).png().toBuffer();
 const renderer=new StaticRenderer(image),fingerprints=new Set();
 for(const family of ['DM Sans','DM Serif Display','Playfair Display','Montserrat','Lora','Oswald']){
  const layer={id:'headline',type:'text',text:'Brand Typography Aa 123',fontFamily:family,fontSize:64,fontWeight:400,fill:'#111111',align:'left',width:900,x:50,y:100};
  const design={schema_version:1,background_media_id:randomUUID(),width:1024,height:1024,layers:[layer]};
  const regular=await renderer.render(design,png);fingerprints.add(regular.sha256);
  assert.match(regular.manifest.fonts[family].sha256,/^[a-f0-9]{64}$/);
  if(family!=='DM Serif Display'){
   const bold=await renderer.render({...design,layers:[{...layer,fontWeight:700}]},png);
   assert.notEqual(regular.sha256,bold.sha256,`${family} weight must alter actual exported pixels`);
  }
 }
 assert.equal(fingerprints.size,6,'font families must produce genuinely different artwork');
});

test('curved text produces distinct up/down PNGs and JPEGs with font, backing and overflow protection',async()=>{
 const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const layer={id:'headline',type:'text',text:'A home for every chapter',fontFamily:'Lora',fontSize:64,fontWeight:600,fill:'#ffffff',align:'center',width:800,x:100,y:100,backing:{fill:'#111111',opacity:.88,padding:12}};
 const design={schema_version:1,background_media_id:randomUUID(),width:1024,height:1024,layers:[layer]},renderer=new StaticRenderer(image),hashes=new Set();
 for(const curvature of [-100,0,100]){
  const curved={...design,layers:[{...layer,curvature}]};
  const result=await renderer.render(curved,png);hashes.add(result.sha256);
  assert.match(result.manifest.curved_text_sha256,/^[a-f0-9]{64}$/);
  const pixel=await sharp(result.bytes).extract({left:90,top:90,width:1,height:1}).raw().toBuffer();assert.ok(pixel[0]<60);
  const jpeg=await renderer.render(curved,png,'instagram-jpeg');assert.equal((await sharp(jpeg.bytes).metadata()).format,'jpeg');
 }
 assert.equal(hashes.size,3,'straight and both bends must change actual pixels');
 await assert.rejects(()=>renderer.render({...design,layers:[{...layer,curvature:100,y:970}]},png),/EXPORT_TEXT_OVERFLOW/);
 await assert.rejects(()=>renderer.render({...design,layers:[{...layer,text:'X\n'.repeat(500),curvature:100}]},png),/EXPORT_TEXT_OVERFLOW/);
 const multiline=await renderer.render({...design,layers:[{...layer,text:'First line\nSecond line',curvature:50}]},png);assert.ok(multiline.bytes.length>1000);
});
