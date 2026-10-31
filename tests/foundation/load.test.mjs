import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {Pool} from 'pg';
import {createApplication} from '../../dist/app.js';
import {startMailbox,messageLink} from './smtp.mjs';

// This suite is launched only by the disposable-database harness. It cannot
// accept a hosted API target or load-test real customer accounts.
test('bounded concurrent tenant traffic preserves isolation and idempotency', {timeout:180000}, async()=>{
 const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
 assert.equal(config.mode,'test');
 const admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
 const smtp=await startMailbox();config.smtp.port=smtp.port;
 let runtime;
 const samples=[],failures=[];
 const report={scope:'local authenticated API, not hosted capacity or provider throughput',accounts:8,concurrency:24,requests:480,passed:false};
 try {
  runtime=await createApplication(config);await runtime.app.listen(0,'127.0.0.1');
  const base=await runtime.app.getUrl();
  async function request(path,{cookie,body,key,method='GET'}={}){
   const response=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{origin:config.origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined});
   return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
  }
  const users=[];
  for(let i=0;i<report.accounts;i++){
   const email=`load-${i}@example.test`,password='isolated-load-test-password-2026';
   const signup=await request('/api/auth/sign-up/email',{method:'POST',body:{name:`Load ${i}`,email,password}});assert.equal(signup.status,200);
   for(let n=0;n<30;n++)if(!await runtime.mailWorker.runOnce())break;
   const link=messageLink(smtp.messages.findLast(m=>m.to.value[0].address===email&&m.subject==='Verify your Desvio email'));
   const verified=await fetch(base+link.pathname+link.search,{redirect:'manual'});assert.ok([200,302].includes(verified.status));await verified.body?.cancel();
   const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email,password}});assert.equal(login.status,200);assert.ok(login.cookie);
   const org=await request('/api/v1/workspaces',{method:'POST',cookie:login.cookie,body:{name:`Load ${i}`}});assert.equal(org.status,201);
   users.push({cookie:login.cookie,org:org.body.id,key:randomUUID(),brandIds:new Set()});
   // Setup only: independent users share loopback. Do not reset limits during load.
   await admin.query('DELETE FROM auth."rateLimit"');
  }
  let next=0;
  const start=performance.now();
  await Promise.all(Array.from({length:report.concurrency},async()=>{
   while(next<report.requests){
    const index=next++,u=users[index%users.length],foreign=users[(index+1)%users.length];
    const kind=Math.floor(index/users.length)%3,begin=performance.now();
    try {
     if(kind===0){
      const r=await request('/api/v1/workspaces',{cookie:u.cookie});assert.equal(r.status,200);assert.deepEqual(r.body.workspaces.map(w=>w.id),[u.org]);
     }else if(kind===1){
      const r=await request(`/api/v1/workspaces/${foreign.org}/brands`,{cookie:u.cookie});assert.equal(r.status,404);
     }else{
      const r=await request(`/api/v1/workspaces/${u.org}/brands`,{cookie:u.cookie,method:'POST',key:u.key,body:{name:'One concurrent brand'}});assert.equal(r.status,201);u.brandIds.add(r.body.id);
     }
    }catch(error){failures.push({index,kind,error:error.name});}
    samples.push(performance.now()-begin);
   }
  }));
  report.duration_ms=Math.round(performance.now()-start);
  samples.sort((a,b)=>a-b);
  report.latency_ms={p50:Math.round(samples[Math.ceil(samples.length*.5)-1]),p95:Math.round(samples[Math.ceil(samples.length*.95)-1]),p99:Math.round(samples[Math.ceil(samples.length*.99)-1])};
  report.requests_per_second=Number((report.requests/(report.duration_ms/1000)).toFixed(2));
  report.failed_requests=failures.length;
  assert.equal(failures.length,0,JSON.stringify(failures.slice(0,5)));
  for(const u of users){
   assert.equal(u.brandIds.size,1);
   const {rows:[row]}=await admin.query('SELECT count(*)::int AS count FROM app.brands WHERE organization_id=$1',[u.org]);assert.equal(row.count,1);
  }
  // A bounded regression threshold, not a production service promise.
  assert.ok(report.latency_ms.p95<5000,`Local p95 ${report.latency_ms.p95}ms exceeds 5s`);
  report.passed=true;
 } finally {
  await writeFile('work/load-measurements.json',JSON.stringify(report,null,2)+'\n');
  await runtime?.close();await admin.end();await smtp.close();
 }
});
