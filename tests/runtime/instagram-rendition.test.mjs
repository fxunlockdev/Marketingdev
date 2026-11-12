import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {prepareRenderImage} from '../../scripts/render-test-image.mjs';
import {StaticRenderer} from '../../dist/static-renderer.js';
import {digest} from '../../dist/object-store.js';
const renderer=new StaticRenderer(prepareRenderImage());
// [design width, design height, expected Instagram height]: square and landscape stay square; portrait is 4:5; stories are 9:16.
const expected={'1024x1024':1080,'1536x1024':1080,'1024x1536':1350,'1024x1280':1350,'1080x1920':1920};
for(const [width,height] of [[1024,1024],[1536,1024],[1024,1536],[1024,1280],[1080,1920]])test(`isolated Instagram rendition keeps ${width}x${height} artwork in its own shape`,async()=>{
 const source=await sharp({create:{width,height,channels:3,background:'#e02020'}}).png().toBuffer();
 const design={schema_version:1,width,height,background_media_id:randomUUID(),layers:[]};
 const png=await renderer.render(design,source),jpeg=await renderer.render(design,source,'instagram-jpeg');
 assert.equal((await sharp(png.bytes).metadata()).format,'png');assert.equal(png.width,width);assert.equal(png.height,height);
 const m=await sharp(jpeg.bytes).metadata(),targetHeight=expected[`${width}x${height}`];assert.equal(m.format,'jpeg');assert.equal(m.width,1080);assert.equal(m.height,targetHeight);
 assert.equal(digest(jpeg.bytes),jpeg.sha256);assert.equal(jpeg.manifest.rendition.source_sha256,png.sha256);
 assert.equal(jpeg.manifest.rendition.fit,'contain');assert.ok(jpeg.manifest.warnings[0].includes('without cropping'));
 const {data,info}=await sharp(jpeg.bytes).raw().toBuffer({resolveWithObject:true});
 const pixel=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
 const center=pixel(540,Math.floor(targetHeight/2));assert.ok(center[0]>200&&center[1]<50&&center[2]<50);
 // Exact 4:5 and 9:16 designs fill the frame with no padding; other shapes are padded, never cropped.
 const exact=Math.abs(height/width-targetHeight/1080)<0.01;
 if(exact)assert.ok(pixel(1,1)[0]>200&&pixel(1,1)[1]<50,'no white bar on an exact-shape design');else assert.ok(pixel(1,1).every(v=>v>=250));
 const repeat=await renderer.render(design,source,'instagram-jpeg');assert.equal(repeat.sha256,jpeg.sha256);
 await assert.rejects(renderer.render(design,source,'unrecognized'),/FORMAT_INVALID/);
});
