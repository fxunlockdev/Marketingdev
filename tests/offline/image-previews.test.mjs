import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {ImagePreviews} from '../../dist/image-previews.js';
import {Canvas} from '../../dist/canvas.js';
import {CreativeExports} from '../../dist/creative-exports.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=await sharp({create:{width:1536,height:1024,channels:3,background:'#816b9d'}}).png().toBuffer();
test('small previews preserve aspect, verify source and coalesce concurrent work',async()=>{
 let reads=0;const previews=new ImagePreviews(async()=>{reads++;return source;});
 const values=await Promise.all(Array.from({length:10},()=>previews.get('org/brand/image',hash(source))));
 assert.equal(reads,1);const metadata=await sharp(values[0].bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,640);assert.equal(metadata.height,427);assert.equal(hash(values[0].bytes),values[0].sha256);
 await previews.get('org/brand/image',hash(source));assert.equal(reads,1);
 await assert.rejects(previews.get('org/brand/bad','0'.repeat(64)),/integrity/);
});
test('cache is scoped by object key, expires and stays bounded',async()=>{
 let reads=0,now=0;const previews=new ImagePreviews(async()=>{reads++;return source;},1024*1024,()=>now);
 await previews.get('org-a/brand/image',hash(source));await previews.get('org-b/brand/image',hash(source));assert.equal(reads,2);
 now=16*60*1000;await previews.get('org-a/brand/image',hash(source));assert.equal(reads,3);
 const tiny=new ImagePreviews(async()=>{reads++;return source;},1);await tiny.get('image',hash(source));await tiny.get('image',hash(source));assert.equal(reads,5);
});
test('transforms run at most two at once and failures can recover',async()=>{
 let active=0,peak=0,fail=true;const previews=new ImagePreviews(async key=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;if(key==='bad'&&fail)throw Error('temporary');return source;});
 await Promise.all(Array.from({length:8},(_,i)=>previews.get(String(i),hash(source))));assert.equal(peak,2);
 await assert.rejects(previews.get('bad',hash(source)));fail=false;await previews.get('bad',hash(source));
});
test('media and export authorization runs before every cache lookup',async()=>{
 let authorized=false,scopes=0,reads=0;const canvas={scope:async(_u,_b,_w,fn)=>{scopes++;if(!authorized)throw Error('denied');return fn({query:async()=>({rows:[{object_key:'org/brand/image',sha256:hash(source)}]})},{organization_id:'org'});},store:{previews:{get:async()=>{reads++;return {bytes:source,sha256:hash(source)};}}}};
 const id='11111111-1111-4111-8111-111111111111';
 await assert.rejects(Canvas.prototype.mediaPreview.call(canvas,'user',id,id),/denied/);assert.equal(reads,0);
 authorized=true;await Canvas.prototype.mediaPreview.call(canvas,'user',id,id);authorized=false;
 await assert.rejects(Canvas.prototype.mediaPreview.call(canvas,'user',id,id),/denied/);assert.equal(reads,1);
 const exports=new CreativeExports(canvas);await assert.rejects(exports.preview('user',id,id),/denied/);assert.equal(reads,1);assert.equal(scopes,4);
});
