// Packaging-only acceptance. No credentials, cloud deployment or paid providers.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const api='desvio-api:dev-amd64',web='desvio-web:dev-amd64';
const images=[api,web].map(tag=>{const i=JSON.parse(docker('image','inspect',tag))[0];assert.equal(i.Architecture,'amd64');assert.equal(i.Os,'linux');assert.equal(i.Config.User,'node');return {tag,id:i.Id,architecture:i.Architecture};});
const limits=['--platform','linux/amd64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1'];
const probe=JSON.parse(docker('run','--rm',...limits,'--network','none',api,'node','--input-type=module','-e','import sharp from "sharp"; import {Worker} from "@temporalio/worker"; import {createApplication} from "./dist/app.js"; const png=await sharp({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer(); console.log(JSON.stringify({arch:process.arch,uid:process.getuid(),png:png.length,worker:typeof Worker,api:typeof createApplication}));'));
assert.equal(probe.arch,'x64');assert.equal(probe.uid,1000);assert.ok(probe.png>0);assert.equal(probe.worker,'function');assert.equal(probe.api,'function');
const name='desvio-web-image-'+randomUUID();let started=false,browser;
try{
 docker('run','--rm','-d','--name',name,...limits,'--tmpfs','/tmp:rw,noexec,nosuid,size=64m','-p','127.0.0.1::3000',
  '-e','APP_MODE=test','-e','APP_ORIGIN=http://localhost:3000','-e','API_ORIGIN=http://api.railway.internal:3100','-e','S3_BROWSER_ORIGIN=http://localhost:9000',web);started=true;
 const port=docker('port',name,'3000/tcp').split(':').at(-1),origin='http://127.0.0.1:'+port;
 let health;for(let i=0;i<100;i++){try{health=await fetch(origin+'/health');if(health.ok)break;}catch{}await delay(300);}
 assert.ok(health?.ok,docker('logs',name));assert.deepEqual(await health.json(),{status:'ok',scope:'web-process-only'});
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/sign-in');await page.getByLabel('Email address').waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),1);assert.deepEqual(errors,[]);
 const html=await page.content();assert.ok(!html.includes('AUTH_DATABASE_URL'));assert.ok(!html.includes('S3_SECRET_ACCESS_KEY'));
 console.log(JSON.stringify({images,api_native_probe:probe,web_health:'web-process-only',web_signin_rendered:true,read_only_nonroot:true,live_calls:false,scope:'Linux amd64 packaging/native dependencies/standalone browser smoke only; no connected API, cloud or provider acceptance'}));
}finally{await browser?.close();if(started)docker('rm','-f',name);}
