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
