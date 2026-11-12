import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {startMockRunway} from '../../scripts/local-stack/mock-runway.mjs';
import {RunwayClient,RUNWAY_VIDEO_MODEL} from '../../dist/runway-client.js';
const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
test('local mock Runway records the exact request and returns a real MP4 made from the approved frame',{skip:!ffmpeg&&'ffmpeg not installed'},async()=>{
 const frame=await sharp({create:{width:1024,height:1536,channels:3,background:'#1f4e5f'}}).png().toBuffer();
 const storage=createServer((req,res)=>{res.writeHead(200,{'content-type':'image/png','content-length':frame.length});res.end(frame);});
 const storagePort=await listen(storage),dir=mkdtempSync(join(tmpdir(),'mock-runway-test-')),logFile=join(dir,'requests.jsonl');
 const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
 const mock=await startMockRunway(port,()=>{},{logFile});
 const previous={mode:process.env.APP_MODE,url:process.env.DESVIO_MOCK_RUNWAY_URL};
 process.env.APP_MODE='development';process.env.DESVIO_MOCK_RUNWAY_URL=mock.origin;
 try{
  const client=new RunwayClient({mode:'development',secret:'local-mock-runway-key',referenceOrigins:[`http://127.0.0.1:${storagePort}`]});
  const intent=client.withBudget({kind:'image',model:RUNWAY_VIDEO_MODEL,idempotencyKey:randomUUID(),referenceURL:`http://127.0.0.1:${storagePort}/ref.png?sig=1`,prompt:'Approved shot prompt',durationSeconds:3,sound:'off',aspectRatio:'9:16'},1000000);
  const receipt=await client.submit(intent,client.prepare(intent).sha256);
  let status;for(let i=0;i<120;i++){status=await client.status(receipt.requestId);if(status.state==='completed'||status.state==='failed')break;await new Promise(r=>setTimeout(r,250));}
  assert.equal(status.state,'completed');assert.match(status.videoURL,new RegExp(`^${mock.origin}/outputs/`));
  const clip=Buffer.from(await(await fetch(status.videoURL)).arrayBuffer());assert.equal(clip.subarray(4,8).toString(),'ftyp');
  const lines=readFileSync(logFile,'utf8').trim().split('\n').map(l=>JSON.parse(l)),generate=lines.find(l=>l.kind==='generate');
  assert.deepEqual(generate.body.input,{referenceImages:[{uri:intent.referenceURL,role:'first'}],promptText:'Approved shot prompt',duration:3,aspectRatio:'9:16',resolution:'1080p',audio:false});
  assert.deepEqual({sha256:generate.reference.sha256,width:generate.reference.width,height:generate.reference.height},{sha256:createHash('sha256').update(frame).digest('hex'),width:1024,height:1536});
  assert.equal((await fetch(`${mock.origin}/v1/routers`)).status,401);
 }finally{
  if(previous.mode===undefined)delete process.env.APP_MODE;else process.env.APP_MODE=previous.mode;
  if(previous.url===undefined)delete process.env.DESVIO_MOCK_RUNWAY_URL;else process.env.DESVIO_MOCK_RUNWAY_URL=previous.url;
  await mock.close();storage.close();rmSync(dir,{recursive:true,force:true});
 }
});
