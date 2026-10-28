import test from 'node:test';import assert from 'node:assert/strict';
import {MaxunClient}from'../../dist/maxun-client.js';
const organizationId='00000000-0000-4000-8000-000000000001',brandId='00000000-0000-4000-8000-000000000002',jobId='00000000-0000-4000-8000-000000000003',robotId='00000000-0000-4000-8000-000000000004',runId='00000000-0000-4000-8000-000000000005';
test('Maxun verified route contracts use metadata IDs, scoped names and no paid summary (MOCK transport)',async()=>{
 const calls=[];
 const client=new MaxunClient('fixture-only',async(url,options)=>{
  calls.push(url.pathname);assert.equal(options.headers.authorization,'Bearer fixture-only');assert.equal(url.origin,'https://app.maxun.dev');assert.equal(options.redirect,'error');
  if(url.pathname==='/api/v1/robots/crawl'){
   const body=JSON.parse(options.body);assert.equal(body.name,`desvio-${organizationId}-${brandId}-${jobId}`);assert.ok(!body.crawlConfig.outputFormats.includes('summary'));assert.equal(body.crawlConfig.limit,5);assert.equal(body.crawlConfig.respectRobots,true);
   return Response.json({success:true,data:{id:robotId,name:body.name,type:'crawl',url:body.url}});
  }
  if(url.pathname.endsWith('/runs')){assert.deepEqual(JSON.parse(options.body),{});return Response.json({success:true,id:runId,status:'running'},{status:202});}
  return Response.json({success:true,data:{id:runId,robotId,status:'success',data:{crawlData:[]},screenshots:[]}});
 });
 const robot=await client.createCrawl({organizationId,brandId,jobId},'https://example.com');assert.equal(robot.id,robotId);
 const run=await client.execute(robot.id);assert.equal((await client.status(run)).status,'success');assert.equal(calls.length,3);
});
test('uncertain submission is surfaced once; no automatic duplicate',async()=>{
 let calls=0;const client=new MaxunClient('fixture',async()=>{calls++;throw Error('private provider detail');});
 await assert.rejects(client.execute(robotId),e=>e.message==='MAXUN_SUBMISSION_UNKNOWN');assert.equal(calls,1);
});
test('foreign run provenance and unsafe input rejected',async()=>{
 const client=new MaxunClient('fixture',async()=>Response.json({success:true,data:{id:runId,robotId:jobId,status:'success'}}));
 await assert.rejects(client.status({robotId,runId}),/MAXUN_RESPONSE_INVALID/);
 await assert.rejects(client.createCrawl({organizationId,brandId,jobId},'http://127.0.0.1'),/UNSAFE_WEBSITE_URL/);
 await assert.rejects(client.execute('../other'),/MAXUN_RESPONSE_INVALID/);
});

test('reconciliation uses only scoped read endpoints and requires unique exact matches',async()=>{
 const scope={organizationId,brandId,jobId},name=`desvio-${organizationId}-${brandId}-${jobId}`,since='2026-10-24T00:00:00.000Z',calls=[];
 let robots=[{id:robotId,name,type:'crawl',url:'https://example.com/'}],runs=[{id:runId,robotId,source:'api',startedAt:since}];
 const client=new MaxunClient('fixture',async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);calls.push(url);
  if(url.pathname==='/api/v1/robots'){assert.equal(url.searchParams.get('q'),name);assert.equal(url.searchParams.get('limit'),'100');return Response.json({success:true,data:robots});}
  assert.equal(url.pathname,`/api/v1/robots/${robotId}/runs`);assert.equal(url.searchParams.get('since'),since);assert.equal(url.searchParams.get('source'),'api');assert.equal(url.searchParams.get('limit'),'2');
  return Response.json({success:true,data:runs});
 });
 assert.equal((await client.recoverRobot(scope,'https://example.com')).id,robotId);
 assert.equal((await client.recoverRun(robotId,since)).runId,runId);
 robots.push({...robots[0],id:runId});await assert.rejects(client.recoverRobot(scope,'https://example.com'),/MAXUN_SUBMISSION_UNKNOWN/);
 robots=[{id:robotId,name,type:'crawl',url:'https://foreign.example/'}];await assert.rejects(client.recoverRobot(scope,'https://example.com'),/MAXUN_SUBMISSION_UNKNOWN/);
 for(const patch of [{robotId:jobId},{source:'dashboard'},{startedAt:'2026-10-23T00:00:00Z'},{startedAt:'invalid'}]){
  runs=[{id:runId,robotId,source:'api',startedAt:since,...patch}];await assert.rejects(client.recoverRun(robotId,since),/MAXUN_SUBMISSION_UNKNOWN/);
 }
 runs=[{id:runId,robotId,source:'api',startedAt:since},{id:jobId,robotId,source:'api',startedAt:since}];await assert.rejects(client.recoverRun(robotId,since),/MAXUN_SUBMISSION_UNKNOWN/);
 runs=[];assert.equal(await client.recoverRun(robotId,since),null);
 robots=[];assert.equal(await client.recoverRobot(scope,'https://example.com'),null);
});
test('successful but malformed submit response remains uncertain, never safe to resubmit',async()=>{
 for(const data of [{success:false},{success:true,id:'invalid'}]){
  const client=new MaxunClient('fixture',async()=>Response.json(data));await assert.rejects(client.execute(robotId),/MAXUN_SUBMISSION_UNKNOWN/);
 }
});

test('403 distinguishes exhausted credits from invalid keys with read-only account lookup',async()=>{
 for(const [account,expected] of [[{status:200,body:{success:true,data:{credits:0}}},'MAXUN_CREDITS_EXHAUSTED'],[{status:200,body:{success:true,data:{credits:20}}},'MAXUN_ACCESS_DENIED'],[{status:401,body:{}},'MAXUN_AUTH_FAILED'],[{status:403,body:{}},'MAXUN_ACCESS_DENIED'],[{status:200,body:{success:true,data:{credits:'0'}}},'MAXUN_ACCESS_DENIED']]){
  const calls=[];const client=new MaxunClient('fixture',async(url,options)=>{calls.push({path:url.pathname,method:options.method});return url.pathname==='/api/v1/me'?Response.json(account.body,{status:account.status}):Response.json({error:'private provider text'},{status:403});});
  await assert.rejects(client.execute(robotId),e=>e.code===expected);
  assert.deepEqual(calls,[{path:`/api/v1/robots/${robotId}/runs`,method:'POST'},{path:'/api/v1/me',method:'GET'}]);
 }
});
test('401 never retries or probes a rejected credential',async()=>{
 let calls=0;const client=new MaxunClient('fixture',async()=>{calls++;return Response.json({},{status:401});});
 await assert.rejects(client.execute(robotId),/MAXUN_AUTH_FAILED/);assert.equal(calls,1);
});
