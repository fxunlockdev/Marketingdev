import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {frameCreative} from '../../dist/creative-framing.js';
import {digest} from '../../dist/object-store.js';
test('story output has real vertical pixels and preserves full source without stretching',async()=>{
 const source=await sharp({create:{width:1024,height:1536,channels:3,background:'#ff0000'}}).png().toBuffer();
 const output=await frameCreative(source,{placement:'story',aspect:'vertical',slide_count:null});
 const {data,info}=await sharp(output.bytes).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1080);assert.equal(info.height,1920);
 assert.equal(output.sha256,digest(output.bytes));assert.equal(output.framing.source_sha256,digest(source));
 const pixel=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
 assert.deepEqual(pixel(540,0),[255,255,255]);assert.deepEqual(pixel(540,960),[255,0,0]);assert.deepEqual(pixel(540,1919),[255,255,255]);
});
test('matching source keeps identical bytes and legacy callers do not invent framing',async()=>{
 const source=await sharp({create:{width:1024,height:1024,channels:3,background:'#123456'}}).png().toBuffer();
 const output=await frameCreative(source,{placement:'feed',aspect:'square',slide_count:null});
 assert.equal(output.sha256,digest(source));assert.equal(output.framing,null);assert.deepEqual(output.bytes,source);
});
