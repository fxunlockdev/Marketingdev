// Tests the real trusted worker image and its child-container boundary; no model calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {prepareWorkerImage} from './worker-image.mjs';
const image=prepareWorkerImage();
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const socket=['--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock'];
const gid=docker('run','--rm','--platform','linux/amd64','--network','none',...socket,image,'node','-e','console.log(require("fs").statSync("/var/run/docker.sock").gid)');
assert.match(gid,/^\d+$/);
const childName='desvio-worker-boundary-'+randomUUID();
try{
 const probe=JSON.parse(docker('run','--rm','--platform','linux/amd64','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--group-add',gid,'--memory','768m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=64m',...socket,'-e','DESVIO_PARENT_SENTINEL=not-a-real-secret',image,'node','--input-type=module','-e',`
 import {execFileSync} from 'node:child_process';
 import {readFileSync} from 'node:fs';
 import sharp from 'sharp';
 import {Worker} from '@temporalio/worker';
 const child=JSON.parse(execFileSync('docker',['run','--rm','--name',${JSON.stringify(childName)},'--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m','--cpus','1','--user','65534:65534','--entrypoint','node',${JSON.stringify(image)},'-e','const fs=require("fs"); console.log(JSON.stringify({uid:process.getuid(),net:fs.readdirSync("/sys/class/net"),socket:fs.existsSync("/var/run/docker.sock"),sentinel:process.env.DESVIO_PARENT_SENTINEL??null,caps:fs.readFileSync("/proc/self/status","utf8").split("CapEff:")[1].trim().slice(0,16)}))'],{encoding:'utf8',env:{PATH:process.env.PATH}}));
 const png=await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();
 console.log(JSON.stringify({uid:process.getuid(),arch:process.arch,client:execFileSync('docker',['--version'],{encoding:'utf8'}).trim(),worker:typeof Worker,pngBytes:png.length,child}));
 `));
 assert.equal(probe.uid,1000);assert.equal(probe.arch,'x64');assert.match(probe.client,/29\.1\.2/);assert.equal(probe.worker,'function');assert.ok(probe.pngBytes>0);
 assert.deepEqual(probe.child,{uid:65534,net:['lo'],socket:false,sentinel:null,caps:'0000000000000000'});
 console.log(JSON.stringify({image,probe,live_calls:false,scope:'Trusted worker packaging and actual credential-free child boundary only; no connected Temporal/database/cloud lifecycle claim'}));
}finally{try{docker('rm','-f',childName);}catch{}}
