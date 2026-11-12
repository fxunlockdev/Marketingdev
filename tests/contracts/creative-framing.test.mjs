import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {frameCreative,coverCrop,frameDirection} from '../../dist/creative-framing.js';
import {digest} from '../../dist/object-store.js';
// Source: red field with a blue 60px band down each long side and a green band at top and bottom.
async function banded(){
 const band=(width,height,background,left,top)=>sharp({create:{width,height,channels:3,background}}).png().toBuffer().then(input=>({input,left,top}));
 return sharp({create:{width:1024,height:1536,channels:3,background:'#ff0000'}}).composite([await band(60,1536,'#0000ff',0,0),await band(60,1536,'#0000ff',964,0),await band(904,60,'#00ff00',60,0),await band(904,60,'#00ff00',60,1476)]).png().toBuffer();
}
const pixels=async bytes=>{const {data,info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});return {info,at:(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)]};};
test('story output is composed at true 9:16, filling the frame with no white padding',async()=>{
 const source=await banded();
 const output=await frameCreative(source,{placement:'story',aspect:'vertical',slide_count:null});
 const {info,at}=await pixels(output.bytes);
 assert.equal(info.width,1080);assert.equal(info.height,1920);
 assert.equal(output.sha256,digest(output.bytes));
 // Full height survives (green bands at both ends); the blue side bands are trimmed away; nothing is white.
 assert.deepEqual(at(540,10),[0,255,0]);assert.deepEqual(at(540,1909),[0,255,0]);
 assert.deepEqual(at(2,960),[255,0,0]);assert.deepEqual(at(1077,960),[255,0,0]);assert.deepEqual(at(540,960),[255,0,0]);
 for(const [x,y] of [[0,0],[1079,0],[0,1919],[1079,1919],[540,0],[540,1919]])assert.notDeepEqual(at(x,y),[255,255,255]);
 // Provenance of the provider original and of exactly what was kept.
 assert.deepEqual(output.framing,{mode:'cover',source_sha256:digest(source),source_width:1024,source_height:1536,width:1080,height:1920,crop:{left:80,top:0,width:864,height:1536}});
});
test('a 4:5 portrait target is a pure crop of the 2:3 provider image, with no resampling and no padding',async()=>{
 const source=await banded(),target={width:1024,height:1280};
 assert.deepEqual(coverCrop({width:1024,height:1536},target),{left:0,top:128,width:1024,height:1280});
 const output=await frameCreative(source,{placement:'feed',aspect:'portrait',slide_count:null},'cover',target);
 const {info,at}=await pixels(output.bytes);
 assert.equal(info.width,1024);assert.equal(info.height,1280);
 assert.deepEqual(at(5,640),[0,0,255]);assert.deepEqual(at(512,2),[255,0,0]);assert.deepEqual(at(512,1277),[255,0,0]);
 assert.deepEqual(await sharp(output.bytes).raw().toBuffer(),await sharp(source).extract({left:0,top:128,width:1024,height:1280}).raw().toBuffer());
});
test('contain remains available and still preserves every source pixel',async()=>{
 const source=await sharp({create:{width:1024,height:1536,channels:3,background:'#ff0000'}}).png().toBuffer();
 const output=await frameCreative(source,{placement:'story',aspect:'vertical',slide_count:null},'contain');
 const {at}=await pixels(output.bytes);
 assert.deepEqual(at(540,0),[255,255,255]);assert.deepEqual(at(540,960),[255,0,0]);
 assert.equal(output.framing.mode,'contain');assert.equal(output.framing.crop,undefined);
});
test('matching source keeps identical bytes and legacy callers do not invent framing',async()=>{
 const source=await sharp({create:{width:1024,height:1024,channels:3,background:'#123456'}}).png().toBuffer();
 const output=await frameCreative(source,{placement:'feed',aspect:'square',slide_count:null});
 assert.equal(output.sha256,digest(source));assert.equal(output.framing,null);assert.deepEqual(output.bytes,source);
});
test('the image prompt is told what the crop removes and where the story interface sits',()=>{
 const story=frameDirection({placement:'story',aspect:'vertical',slide_count:null});
 assert.match(story,/1080x1920/);assert.match(story,/about 8% is cut from the left and from the right/);assert.match(story,/central 80% of the width/);
 assert.match(story,/No borders, bars, frames or blank bands/);assert.match(story,/top 14% and bottom 20%/);
 const portrait=frameDirection({placement:'feed',aspect:'portrait',slide_count:null},{width:1024,height:1280});
 assert.match(portrait,/1024x1280/);assert.match(portrait,/about 9% is cut from the top and from the bottom/);assert.ok(!portrait.includes('story'));
 for(const aspect of ['square','landscape'])assert.equal(frameDirection({placement:'feed',aspect,slide_count:null}),undefined);
 // Portrait is 4:5 by default now, so the prompt always states the trimmed top and bottom.
 assert.equal(frameDirection({placement:'feed',aspect:'portrait',slide_count:null}),portrait);
});
