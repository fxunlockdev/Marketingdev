import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {zipDownload} from '../../dist/zip-download.js';
import {readZip} from '../fixtures/read-zip.mjs';
async function collect(stream){const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}
test('download archive preserves ordered image bytes and Unicode caption with valid ZIP lengths and checksums',async()=>{
 const files=[['slide-01.png',Buffer.from([0,255,3])],['slide-02.png',Buffer.from([4,9,8])],['caption.txt',Buffer.from('Brand café 🌿')],['manifest.json',Buffer.from('{}')]];
 const bundle=zipDownload(files.map(([name,bytes])=>({name,bytes:bytes.length,read:async()=>bytes}))),bytes=await collect(bundle.stream());assert.equal(bytes.length,bundle.length);
 const entries=await readZip(bytes);assert.deepEqual(entries.map(e=>[e.name,e.bytes]),files);for(const e of entries)assert.equal(e.crc,crc32(e.bytes));
});
test('download bounds paths, sizes and entry counts and stops on damaged or unavailable data',async()=>{
 const entry={name:'slide-01.png',bytes:1,read:async()=>Buffer.from('a')};
 for(const name of ['../x.png','/x.png','bad\n.png','a/b.png','x.exe'])assert.throws(()=>zipDownload([{...entry,name}]));
 for(const bytes of [-1,NaN,1.5,20*1024*1024+1])assert.throws(()=>zipDownload([{...entry,bytes}]));
 assert.throws(()=>zipDownload([]));assert.throws(()=>zipDownload([entry,entry]));assert.throws(()=>zipDownload(Array.from({length:13},(_,i)=>({...entry,name:`slide-${i}.png`}))));
 await assert.rejects(collect(zipDownload([{...entry,bytes:2}]).stream()),/integrity/);
 let laterRead=false;await assert.rejects(collect(zipDownload([{...entry,read:async()=>{throw Error('unavailable');}},{...entry,name:'slide-02.png',read:async()=>{laterRead=true;return Buffer.from('b');}}]).stream()),/unavailable/);assert.equal(laterRead,false);
});
