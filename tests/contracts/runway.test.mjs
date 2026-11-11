import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RunwayClient,RUNWAY_VIDEO_MODEL} from '../../dist/runway-client.js';
const config={mode:'test',secret:'server-secret',referenceOrigins:['https://media.example.com']};
const raw=()=>({kind:'image',model:RUNWAY_VIDEO_MODEL,idempotencyKey:randomUUID(),referenceURL:'https://media.example.com/private.png?signature=private',prompt:'Approved scene',durationSeconds:5,sound:'off',aspectRatio:'9:16'});
const router=()=>({slug:'desvio-video-quality-v1-100',settings:{optimizeFor:'quality',models:{mode:'allow_new_except',ids:[]},maxCreditsPerGeneration:{video:100}}});
const receipt=()=>({dryRun:false,id:randomUUID(),routing:{model:'gen4.5',provider:'runway',configId:router().slug,resolvedSettings:{optimizeFor:'quality',priceCeiling:100},estimatedCost:{credits:60}}});
function client(handler){return new RunwayClient(config,async(url,init)=>{assert.equal(new URL(url).origin,'https://api.dev.runwayml.com');assert.equal(init.headers.Authorization,'Bearer server-secret');assert.equal(init.headers['X-Runway-Version'],'2024-11-06');assert.equal(init.redirect,'error');return handler(new URL(url),init);});}
const intent=c=>c.withBudget(raw(),1000000);
test('Runway routes quality without a hardcoded model, creates capped config and returns routing provenance',async()=>{
 let creates=0,submits=0;const result=receipt();
 const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:[],hasMore:false,nextCursor:null});const b=JSON.parse(i.body);if(u.pathname==='/v1/routers'){creates++;assert.equal(b.settings.optimizeFor,'quality');assert.equal(b.settings.maxCreditsPerGeneration.video,100);assert.deepEqual(b.settings.models,{mode:'allow_new_except',ids:[]});return Response.json({...router(),id:randomUUID()});}submits++;assert.equal(u.pathname,'/v1/generate/video');assert.equal(b.model,undefined);assert.equal(b.input.model,undefined);assert.equal(b.input.aspectRatio,'9:16');assert.equal(b.input.duration,5);assert.equal(b.input.audio,false);assert.equal(b.input.resolution,'1080p');assert.equal(b.input.referenceImages[0].role,'first');return Response.json(result);});
 const v=intent(c),p=c.prepare(v),saved=await c.submit(v,p.sha256);assert.equal(saved.requestId,result.id);assert.equal(saved.routing.model,'gen4.5');assert.equal(saved.routing.estimated_credits,60);assert.equal(creates,1);assert.equal(submits,1);assert.ok(!JSON.stringify(c).includes('server-secret'));
});
test('Runway existing router is reused; conflicting or altered configuration never generates',async()=>{
 for(const altered of [false,true]){let paid=0;const r=router();if(altered)r.settings.optimizeFor='cost';const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:[r],hasMore:false});paid++;return Response.json(receipt());});const v=intent(c),p=c.prepare(v);if(altered)await assert.rejects(c.submit(v,p.sha256),e=>e.code==='RUNWAY_ROUTER_CONFIGURATION_CHANGED'&&e.outcome==='rejected');else await c.submit(v,p.sha256);assert.equal(paid,altered?0:1);}
});
test('Runway concurrent router creation conflict is resolved by reading unique slug',async()=>{
 let reads=0,paid=0;const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:++reads===1?[]:[router()],hasMore:false});if(u.pathname==='/v1/routers')return Response.json({}, {status:409});paid++;return Response.json(receipt());});const v=intent(c);await c.submit(v,c.prepare(v).sha256);assert.equal(paid,1);assert.equal(reads,2);
});
test('Runway freezes cap and exact input; invalid requests never contact provider',async()=>{
 let calls=0;const c=client(()=>{calls++;throw Error();});const v=intent(c);
 for(const delta of [{durationSeconds:1},{durationSeconds:16},{aspectRatio:'2:3'},{model:'gen4.5'},{referenceURL:'https://127.0.0.1/private'},{referenceURL:'https://evil.example/x'},{maxCredits:0},{prompt:''},{unexpected:'field'},{idempotencyKey:'invalid'}])assert.throws(()=>c.prepare({...v,...delta}),/RUNWAY_INPUT_INVALID/);
 assert.throws(()=>c.withBudget(raw(),9999),/BUDGET_TOO_LOW/);assert.equal(c.withBudget(raw(),19999).maxCredits,1);
 await assert.rejects(c.submit(v,'0'.repeat(64)),/REPLAY_MISMATCH/);assert.equal(calls,0);
 assert.notEqual(c.prepare({...v,maxCredits:50}).sha256,c.prepare(v).sha256);
});
test('Runway queued/throttled/progress/success/failure/cancel statuses normalize without leaking raw error text',async()=>{
 const key=randomUUID();for(const [remote,local] of Object.entries({PENDING:'queued',THROTTLED:'queued',RUNNING:'in_progress',SUCCEEDED:'completed',FAILED:'failed',CANCELLED:'canceled'})){
 const c=client(()=>Response.json({id:key,status:remote,progress:.45,output:['https://cdn.example.com/video.mp4?private'],failure:'private echoed prompt'}));const r=await c.status(key);assert.equal(r.state,local);assert.equal(r.progress,.45);assert.equal(r.videoURL!==null,remote==='SUCCEEDED');assert.ok(!JSON.stringify(r).includes('echoed'));}
});
test('Runway rejects mismatched tasks, malformed outputs, private output URLs and oversized JSON',async()=>{
 const key=randomUUID();for(const payload of [{id:randomUUID(),status:'PENDING'},{id:key,status:'mystery'},{id:key,status:'SUCCEEDED',output:[]},{id:key,status:'SUCCEEDED',output:['https://127.0.0.1/a']},{id:key,status:'SUCCEEDED',output:['https://cdn.example/a','https://cdn.example/b']}])await assert.rejects(client(()=>Response.json(payload)).status(key),/RUNWAY_RESPONSE_INVALID/);
 await assert.rejects(client(()=>Response.json({x:'x'.repeat(270000)})).status(key),/RUNWAY_RESPONSE_INVALID/);
});
test('Runway cancel uses DELETE and never interprets acknowledgment as completed output',async()=>{
 const key=randomUUID();const c=client((u,i)=>{assert.equal(i.method,'DELETE');assert.equal(u.pathname,`/v1/tasks/${key}`);return new Response(null,{status:204});});assert.equal((await c.cancel(key)).state,'cancel_requested');
});
test('Runway paid submission rejects known HTTP errors but holds network/5xx/malformed receipt unknown, without retry',async()=>{
 for(const status of [400,401,403,404,429,500,502,'lost','malformed']){let paid=0;const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:[router()],hasMore:false});paid++;if(status==='lost')throw Error('secret');if(status==='malformed')return Response.json({id:randomUUID()});return Response.json({secret:'echo'},{status});});const v=intent(c);await assert.rejects(c.submit(v,c.prepare(v).sha256),e=>e.outcome===([400,401,403,404,429].includes(status)?'rejected':'unknown')&&!e.message.includes('echo'));assert.equal(paid,1);}
});
test('Runway refuses malformed configuration and nonlocal test endpoints',()=>{
 for(const delta of [{secret:''},{secret:'Bearer key'},{mode:'production'},{referenceOrigins:['https://media.example.com/path']},{testBaseURL:'https://evil.example'},{mode:'staging',testBaseURL:'http://127.0.0.1:1234'}])assert.throws(()=>new RunwayClient({...config,...delta}),/RUNWAY_CONFIG_INVALID/);
});

test('three-second compatible profile preserves duration and legacy replay while router chooses the model',async()=>{
 let paid=0;const slug='desvio-video-short-quality-v1-100';
 const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:[],hasMore:false});const b=JSON.parse(i.body);if(u.pathname==='/v1/routers'){assert.deepEqual(b.settings.models,{mode:'allow_new_except',ids:['wan3']});return Response.json({...b,id:randomUUID()});}paid++;assert.equal(b.input.duration,3);assert.equal(b.input.resolution,'720p');assert.equal(b.input.promptText,'Self-contained approved direction');assert.equal(b.input.model,undefined);return Response.json({...receipt(),routing:{...receipt().routing,configId:slug}});});
 const v={...intent(c),durationSeconds:3,prompt:'Self-contained approved direction',routingProfile:'short-clip-v1'};await c.submit(v,c.prepare(v).sha256);assert.equal(paid,1);
 assert.throws(()=>c.prepare({...v,prompt:'x'.repeat(1001)}),/INPUT_INVALID/);
 assert.throws(()=>c.prepare({...v,durationSeconds:5}),/INPUT_INVALID/);
 const legacy=c.prepare({...v,routingProfile:undefined});assert.equal(JSON.parse(legacy.body).input.resolution,'1080p');assert.equal(legacy.configId,router().slug);
});

test('Runway retains only safe routing rejection categories, never echoed input or private URLs',async()=>{
 const c=client((u,i)=>i.method==='GET'?Response.json({data:[router()],hasMore:false}):Response.json({code:'no_eligible_model',error:'private prompt and signed reference URL',pipeline:[{secret:'provider detail'}]},{status:400}));
 const v=intent(c);await assert.rejects(c.submit(v,c.prepare(v).sha256),e=>e.code==='RUNWAY_NO_ELIGIBLE_MODEL'&&e.outcome==='rejected'&&!JSON.stringify(e).includes('private'));
 const huge=client((u,i)=>i.method==='GET'?Response.json({data:[router()],hasMore:false}):Response.json({code:'no_eligible_model',error:'x'.repeat(17000)},{status:400}));const h=intent(huge);await assert.rejects(huge.submit(h,huge.prepare(h).sha256),e=>e.code==='RUNWAY_REQUEST_REJECTED'&&e.outcome==='rejected');
});


test('Runway observed insufficient-credit rejection is explicit and never retried',async()=>{
 let submits=0;
 const c=client((u,i)=>{if(i.method==='GET')return Response.json({data:[router()],hasMore:false});submits++;return Response.json({error:'You do not have enough credits to run this task.'},{status:400});});
 const v=intent(c);await assert.rejects(c.submit(v,c.prepare(v).sha256),e=>e.code==='RUNWAY_INSUFFICIENT_CREDITS'&&e.outcome==='rejected');assert.equal(submits,1);
 const other=client((u,i)=>i.method==='GET'?Response.json({data:[router()],hasMore:false}):Response.json({error:'Private prompt mentions credits and secret reference URL'},{status:400}));const o=intent(other);await assert.rejects(other.submit(o,other.prepare(o).sha256),e=>e.code==='RUNWAY_REQUEST_REJECTED'&&!e.message.includes('Private'));
});
