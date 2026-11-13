import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uploadInParts} from '../../infra/worker-control/multipart.mjs';
const fixture=size=>{const dir=mkdtempSync(join(tmpdir(),'mp-'));const path=join(dir,'a.tar.gz');writeFileSync(path,Buffer.alloc(size,7));return {dir,path};};
const fake=({failPart,failTimes=0}={})=>{const calls=[];let failures=0;return {calls,send:async cmd=>{const name=cmd.constructor.name;calls.push({name,input:cmd.input});
 if(name==='CreateMultipartUploadCommand')return {UploadId:'u1'};
 if(name==='UploadPartCommand'){if(cmd.input.PartNumber===failPart&&failures<failTimes){failures++;throw Error('reset');}return {ETag:'e'+cmd.input.PartNumber};}
 return {};}};};
test('uploads every byte in ordered parts and completes',async()=>{
 const {dir,path}=fixture(25);const c=fake();
 assert.equal(await uploadInParts(c,{Bucket:'b',Key:'k',path,bytes:25,metadata:{}},{partBytes:10,pause:async()=>{}}),3);
 const parts=c.calls.filter(x=>x.name==='UploadPartCommand');assert.deepEqual(parts.map(p=>p.input.ContentLength),[10,10,5]);
 assert.deepEqual(c.calls.at(-1).input.MultipartUpload.Parts.map(p=>p.PartNumber),[1,2,3]);rmSync(dir,{recursive:true});
});
test('a dropped part is retried, and repeated failure aborts the upload',async()=>{
 const {dir,path}=fixture(20);
 const retry=fake({failPart:2,failTimes:2});await uploadInParts(retry,{Bucket:'b',Key:'k',path,bytes:20,metadata:{}},{partBytes:10,pause:async()=>{}});
 assert.equal(retry.calls.at(-1).name,'CompleteMultipartUploadCommand');
 const broken=fake({failPart:1,failTimes:9});
 await assert.rejects(uploadInParts(broken,{Bucket:'b',Key:'k',path,bytes:20,metadata:{}},{partBytes:10,attempts:3,pause:async()=>{}}),/TRANSFER_PART_FAILED/);
 assert.equal(broken.calls.at(-1).name,'AbortMultipartUploadCommand');rmSync(dir,{recursive:true});
});
