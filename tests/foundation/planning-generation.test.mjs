import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import OpenAI from 'openai';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Connection,Client} from '@temporalio/client';
import {Context} from '@temporalio/activity';
import {createApplication} from '../../dist/app.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {BrandBrain} from '../../dist/brand-brain.js';
import {ContentPlan} from '../../dist/content-plan.js';
import {Planning} from '../../dist/planning.js';
import {PlanningJobs} from '../../dist/planning-jobs.js';
import {AssetJobs} from '../../dist/jobs.js';
import {SkillRuntime} from '../../dist/skill-runtime.js';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {generatedPlan,modelResponse} from '../fixtures/planning.mjs';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl});
let app,base,alice,cookie,org,ws,businesses,brain,plans,planning,transport,calls=0,inputs=[];
const bob=randomUUID(),viewer=randomUUID(),skills=new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE);
const jobs=new AssetJobs(worker,null,null);
function inputFrom(body){const message=body.input.find(m=>m.role==='user'&&m.content.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n'));return JSON.parse(message.content.slice(message.content.indexOf('\n')+1));}
async function standard(url,init){
 calls++;assert.equal(new URL(url).pathname,'/v1/responses');const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,16000);assert.ok(body.tools.every(t=>t.name==='read_file'));
 const input=inputFrom(body);inputs.push(input);assert.equal(input.task,'content_plan');assert.ok(body.input.some(m=>m.content?.includes('marketing-plan')));
 assert.ok(!JSON.stringify(body).includes(config.storage.secretAccessKey));return modelResponse(generatedPlan(input));
}
const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'LOCAL MOCK ONLY',maxRetries:0,fetch:(url,init)=>(transport??standard)(url,init)}));
const handler=new PlanningJobs(jobs,skills,provider);
const scope=(brand,job)=>({organizationId:org.id,brandId:brand.id,jobId:job.id});
const row=async j=>(await admin.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[j.id])).rows[0];
const countPlans=async b=>(await admin.query('SELECT count(*)::int AS n FROM app.content_plans WHERE brand_id=$1',[b.id])).rows[0].n;
const range={start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'};
async function api(path,{method='GET',body,key,auth=true}={}){const r=await fetch(base+path,{method,headers:{origin:config.origin,'content-type':'application/json',...(auth?{cookie}:{}),...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
async function fresh({approved=true,goals=true}={}){
 const b=await ws.createBrand(alice,org.id,{name:`Plan business ${randomUUID()}`},randomUUID());
 if(approved){
  for(const [field,value] of [['brand_name',b.name],['offering','Scheduling tools for clinics'],['audience','Clinic owners']])await brain.manual(alice,org.id,b.id,{field,value},randomUUID());
  let state=await brain.read(alice,org.id,b.id);for(const f of state.findings)await brain.review(alice,org.id,b.id,f.id,{decision:'correct',revision:f.revision});
  state=await brain.read(alice,org.id,b.id);await brain.approve(alice,org.id,b.id,{revision:state.revision});
 }
 if(goals)await businesses.onboarding(alice,b.id,{revision:0,step:3,goal:'awareness',timezone:'UTC',cadence:3,channels:['linkedin','instagram'],must_avoid:'No unsupported medical claims',preferences_edited:true});
 return b;
}
const submit=(b,brief='Explain our approved offering')=>planning.submit(alice,b.id,{starts_on:'2026-11-01',brief},randomUUID());
async function grant(b,budget=10000000){await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'MOCK-plan',now()+interval '1 hour',$3,0.01,0.02,'LOCAL TEST ONLY') ON CONFLICT(organization_id,brand_id,provider) DO UPDATE SET budget_micros=$3,enabled=true",[org.id,b.id,budget]);}
before(async()=>{
 app=await createApplication(config);await app.app.listen(0,'127.0.0.1');base=await app.app.getUrl();
 await admin.query('DELETE FROM auth."rateLimit"');const email=`${randomUUID()}@example.test`,password='a-strong-fixture-password-2026';
 const signup=await api('/api/auth/sign-up/email',{auth:false,method:'POST',body:{name:'Planning owner',email,password}});assert.equal(signup.status,200);alice=signup.body.user.id;
 // Explicit email-verification setup fixture. No external email is sent.
 await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[alice]);
 const login=await api('/api/auth/sign-in/email',{auth:false,method:'POST',body:{email,password}});assert.equal(login.status,200);cookie=login.cookie;
 for(const id of [bob,viewer])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[id,id,`${id}@example.test`]);
 ws=new Workspaces(app.database);businesses=new Businesses(app.database,ws);brain=new BrandBrain(app.database);plans=new ContentPlan(businesses);planning=new Planning(plans);
 org=await ws.create(alice,{name:'AI planning tests'});
 // Explicit test-only entitlement allows isolated businesses for each failure scenario; standard quota stays three.
 await admin.query('INSERT INTO app.account_entitlements(organization_id,max_active_businesses) VALUES($1,100) ON CONFLICT(organization_id) DO UPDATE SET max_active_businesses=100',[org.id]);await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",[org.id,viewer]);
});
after(async()=>{await app?.close();await worker.end();await admin.end();});

test('planning requires approved facts, completed goals, genuine sessions, role access and explicit provider funding',async()=>{
 const unapproved=await fresh({approved:false}),unfinished=await fresh({goals:false}),b=await fresh(),key=randomUUID();
 await assert.rejects(submit(unapproved),/Confirm your brand/);await assert.rejects(submit(unfinished),/Finish your brand goals/);
 await assert.rejects(planning.submit(viewer,b.id,{starts_on:'2026-11-01'},key),/cannot|read-only/);
 const path=`/api/v1/businesses/${b.id}/content-plan/generate`;
 assert.equal((await api(path,{auth:false,method:'POST',key,body:{starts_on:'2026-11-01'}})).status,401);
 assert.equal((await api(path,{method:'POST',key,body:{starts_on:'2026-11-01',brand:{facts:['forged']}}})).status,400);
 const replies=await Promise.all([1,2].map(()=>api(path,{method:'POST',key,body:{starts_on:'2026-11-01'}})));replies.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));assert.equal(replies[0].body.id,replies[1].body.id);
 const j=replies[0].body;assert.equal(await handler.run(scope(b,j)),'rejected');assert.equal((await row(j)).error_code,'PLAN_STAGING_APPROVAL_REQUIRED');assert.equal(calls,0);assert.equal(await countPlans(b),0);
 assert.equal((await api(`/api/v1/businesses/${b.id}/content-plan/jobs`)).body.jobs[0].status,'rejected');
 await assert.rejects(planning.jobs(bob,b.id),/not found/i);
 await assert.rejects(app.database.transaction(alice,org.id,true,db=>db.query('UPDATE app.planning_grants SET enabled=true'),b.id),e=>e.code==='42501');
});
test('real Temporal and isolated original skills persist 30 grounded channel drafts with provenance without altering existing plans',async()=>{
 const b=await fresh();await grant(b);
 const old=await plans.create(alice,b.id,{title:'Existing manual plan',objective:'Keep this',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'linkedin',planned_at:'2026-11-01T08:00:00Z',format:'static',brief:'Existing draft'}]},randomUUID());
 const j=await submit(b),before=calls,connection=await NativeConnection.connect({address:config.jobs.address}),clientConnection=await Connection.connect({address:config.jobs.address});
 const queue='planning-'+randomUUID();
 const w=await Worker.create({connection,namespace:config.jobs.namespace,taskQueue:queue,workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{generatePlan:async s=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await handler.run(s);}finally{clearInterval(timer);}},failPlan:s=>handler.fail(s)}});
 try{const client=new Client({connection:clientConnection,namespace:config.jobs.namespace});assert.equal(await w.runUntil(()=>client.workflow.execute('generatePlanWorkflow',{workflowId:'plan-test-'+j.id,taskQueue:queue,args:[scope(b,j)]})),'succeeded');}finally{await connection.close();await clientConnection.close();}
 assert.equal(calls,before+1);const status=(await planning.jobs(alice,b.id)).jobs[0];assert.ok(status.output_plan_id);
 const result=await planning.detail(alice,b.id,status.output_plan_id);assert.equal(result.origin,'generated');assert.equal(result.strategy.slots.length,30);assert.deepEqual(result.skill_manifest.skills.map(s=>s.name).sort(),['brand-engine','marketing-plan','product-marketing','social']);assert.ok(result.skill_manifest.reserved_cost_micros>0);
 const slots=await plans.list(alice,b.id,{...range,plan_id:result.id});assert.equal(slots.total,30);assert.ok(slots.slots.every(s=>s.state==='content_needed'&&s.creative_version_id===null&&s.approved_by===null));assert.equal(new Set(slots.slots.map(s=>s.strategy_slot_index)).size,30);
 assert.equal((await plans.list(alice,b.id,{...range,plan_id:result.id,channel:'linkedin'})).total,15);
 assert.equal((await planning.detail(alice,b.id,old.id)).objective,'Keep this');assert.equal(await countPlans(b),2);
 assert.equal(await handler.run(scope(b,j)),'finished');assert.equal(calls,before+1);
 assert.equal((await api(`/api/v1/businesses/${b.id}/content-plans/${result.id}`)).body.skill_manifest.source_preferences.goal,'awareness');
 await assert.rejects(planning.detail(bob,b.id,result.id),/not found/i);
 await jobs.transaction(scope(b,j),async(db)=>{
  assert.equal((await db.query('SELECT id FROM app.content_slots')).rowCount,30);
  assert.equal((await db.query('SELECT id FROM app.brand_brain_versions')).rowCount,1);
  assert.equal((await db.query("UPDATE app.content_slots SET state='approved'")).rowCount,0);
 });
});
test('unfounded facts, malformed plans and unsupported skill tools reject without saving a fake plan',async()=>{
 for(const mode of ['facts','duplicates','tool']){
  const b=await fresh();await grant(b);const j=await submit(b);
  transport=async(url,init)=>{calls++;const input=inputFrom(JSON.parse(init.body));if(mode==='tool')return Response.json({id:'mock',object:'response',status:'completed',output:[{type:'function_call',name:'execute',call_id:'bad',arguments:'{"command":"read secrets"}'}]});const p=generatedPlan(input);if(mode==='facts')p.slots[0].fact_ids=['invented'];else p.slots[1]={...p.slots[0]};return modelResponse(p);};
  try{assert.equal(await handler.run(scope(b,j)),'rejected');assert.equal(await countPlans(b),0);assert.ok(['PLAN_OUTPUT_INVALID','SKILL_TOOL_DENIED'].includes((await row(j)).error_code));}finally{transport=undefined;}
 }
});
test('unknown paid outcome is held and cannot be retried or cleared by cancellation to spend again',async()=>{
 const b=await fresh();await grant(b);const j=await submit(b),before=calls;
 transport=async()=>{calls++;throw new TypeError('MOCK lost paid response');};
 try{assert.equal(await handler.run(scope(b,j)),'unknown');assert.equal(await handler.run(scope(b,j)),'finished');assert.equal(calls,before+1);await assert.rejects(submit(b),/uncertain/);await assert.rejects(planning.cancel(alice,b.id,j.id),/reconciliation/);
  await admin.query("UPDATE app.jobs SET status='queued' WHERE id=$1",[j.id]);assert.equal(await handler.run(scope(b,j)),'unknown');assert.equal(calls,before+1);assert.equal(await countPlans(b),0);
  const call=(await admin.query('SELECT status,reserved_micros FROM app.planning_calls WHERE job_id=$1',[j.id])).rows[0];assert.equal(call.status,'unknown');assert.ok(Number(call.reserved_micros)>0);
 }finally{transport=undefined;}
});
test('persisted model output recovers after a database failure without another paid call or partial calendar',async()=>{
 const b=await fresh();await grant(b);const j=await submit(b),before=calls;
 await admin.query("CREATE FUNCTION app.test_plan_promote_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.strategy_slot_index=15 THEN RAISE EXCEPTION 'MOCK database promotion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_plan_promote_failure BEFORE INSERT ON app.content_slots FOR EACH ROW EXECUTE FUNCTION app.test_plan_promote_failure();");
 try{await assert.rejects(handler.run(scope(b,j)),/MOCK database promotion failure/);assert.equal(await countPlans(b),0);assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.content_slots WHERE brand_id=$1',[b.id])).rows[0].n,0);}finally{await admin.query('DROP TRIGGER test_plan_promote_failure ON app.content_slots; DROP FUNCTION app.test_plan_promote_failure()');}
 assert.equal(calls,before+1);assert.ok((await admin.query('SELECT output FROM app.planning_requests WHERE job_id=$1',[j.id])).rows[0].output);
 assert.equal(await handler.run(scope(b,j)),'succeeded');assert.equal(calls,before+1);assert.equal(await countPlans(b),1);
});
test('cancellation and access revocation prevent promotion; changed onboarding never gets overwritten',async()=>{
 const b=await fresh();await grant(b);let j=await submit(b),before=calls;
 await planning.cancel(alice,b.id,j.id);assert.equal(await handler.run(scope(b,j)),'finished');assert.equal((await row(j)).status,'canceled');assert.equal(calls,before);
 j=await submit(b);transport=async(url,init)=>{const result=await standard(url,init);await planning.cancel(alice,b.id,j.id);return result;};
 try{assert.equal(await handler.run(scope(b,j)),'canceled');assert.equal(await countPlans(b),0);}finally{transport=undefined;}
 const other=await fresh();await grant(other);j=await submit(other);
 transport=async(url,init)=>{const result=await standard(url,init);await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[org.id,alice]);return result;};
 try{assert.equal(await handler.run(scope(other,j)),'canceled');assert.equal(await countPlans(other),0);}finally{transport=undefined;await admin.query('UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2',[org.id,alice]);}
 const changed=await fresh();await grant(changed);j=await submit(changed);
 transport=async(url,init)=>{const result=await standard(url,init);const old=await businesses.onboarding(alice,changed.id);await businesses.onboarding(alice,changed.id,{revision:old.revision,step:3,goal:'sales',timezone:'UTC',cadence:2,channels:['linkedin'],must_avoid:'New owner preference',preferences_edited:true});return result;};
 try{assert.equal(await handler.run(scope(changed,j)),'succeeded');const p=await planning.detail(alice,changed.id,(await planning.jobs(alice,changed.id)).jobs[0].output_plan_id);assert.equal(p.skill_manifest.source_preferences.goal,'awareness');assert.equal((await businesses.onboarding(alice,changed.id)).goal,'sales');}finally{transport=undefined;}
});
test('budget is checked before every model step, and provider rejection does not retry automatically',async()=>{
 const low=await fresh();await grant(low,1);let j=await submit(low),before=calls;assert.equal(await handler.run(scope(low,j)),'rejected');assert.equal((await row(j)).error_code,'PLAN_BUDGET_EXHAUSTED');assert.equal(calls,before);
 const b=await fresh();await grant(b);j=await submit(b);before=calls;
 transport=async()=>{calls++;await grant(b,1);return Response.json({id:'mock',object:'response',status:'completed',output:[{type:'function_call',name:'read_file',call_id:'read-plan',arguments:'{"file_path":"/skills/marketing-plan/SKILL.md"}'}]});};
 try{assert.equal(await handler.run(scope(b,j)),'rejected');assert.equal((await row(j)).error_code,'PLAN_BUDGET_EXHAUSTED');assert.equal(calls,before+1);}finally{transport=undefined;}
 const rejected=await fresh();await grant(rejected);j=await submit(rejected);before=calls;transport=async()=>{calls++;return Response.json({error:{message:'MOCK rate limit'}},{status:429});};
 try{assert.equal(await handler.run(scope(rejected,j)),'rejected');assert.equal((await row(j)).error_code,'PLAN_PROVIDER_REJECTED');assert.equal(calls,before+1);}finally{transport=undefined;}
});

test('planning job scope, immutable approved input and per-business funding cannot be substituted',async()=>{
 const a=await fresh(),b=await fresh();await grant(a);const ja=await submit(a),jb=await submit(b),before=calls;
 await assert.rejects(jobs.transaction(scope(b,ja),async()=>null),/JOB_SCOPE_DENIED/);
 assert.equal(await handler.run(scope(b,jb)),'rejected');assert.equal((await row(jb)).error_code,'PLAN_STAGING_APPROVAL_REQUIRED');assert.equal(calls,before);
 await admin.query("UPDATE app.planning_requests SET input=jsonb_set(input,'{brand,facts,0,value}','\"TAMPERED TEST FIXTURE\"'::jsonb) WHERE job_id=$1",[ja.id]);
 assert.equal(await handler.run(scope(a,ja)),'rejected');assert.equal((await row(ja)).error_code,'PLAN_BRAND_INTEGRITY_FAILED');assert.equal(calls,before);assert.equal(await countPlans(a),0);
 await app.database.transaction(alice,org.id,true,async db=>{
  await assert.rejects(db.query("UPDATE app.planning_requests SET input='{}'::jsonb WHERE job_id=$1",[ja.id]),e=>e.code==='42501');
 },a.id);
});

test('custom-duration plan persists its horizon, rejects rescheduling outside it and keeps tenant isolation',async()=>{
 const b=await fresh();await grant(b);const body={starts_on:'2026-11-01',brief:'TEST four-day launch',duration_days:4,post_count:4},key=randomUUID();
 const j=await planning.submit(alice,b.id,body,key);assert.equal((await planning.submit(alice,b.id,body,key)).id,j.id);
 await assert.rejects(planning.submit(alice,b.id,{...body,duration_days:6},key));
 assert.equal(await handler.run(scope(b,j)),'succeeded');
 const p=(await admin.query('SELECT * FROM app.content_plans WHERE job_id=$1',[j.id])).rows[0];assert.equal(p.duration_days,4);
 const saved=await plans.list(alice,b.id,{...range,plan_id:p.id});assert.equal(saved.slots.length,4);
 const slot=saved.slots[0];await assert.rejects(plans.edit(alice,b.id,slot.id,{revision:slot.revision,planned_at:'2026-11-05T08:00:00Z'}));
 assert.equal((await planning.detail(alice,b.id,p.id)).duration_days,4);await assert.rejects(planning.detail(bob,b.id,p.id));
 for(const duration_days of [0,91,1.5])assert.throws(()=>planning.submit(alice,b.id,{...body,duration_days},randomUUID()));
});

test('mixed six-day planning persists editable scripts and no video generation until a separate request',async()=>{
 const b=await fresh();await grant(b);const body={starts_on:'2026-11-01',brief:'Two videos and four images',duration_days:6,post_count:6,video_count:2};
 const j=await planning.submit(alice,b.id,body,randomUUID());assert.equal(await handler.run(scope(b,j)),'succeeded');
 const plan=(await planning.jobs(alice,b.id)).jobs[0].output_plan_id;
 const saved=(await plans.list(alice,b.id,{...range,plan_id:plan})).slots;assert.equal(saved.length,6);assert.equal(saved.filter(s=>s.format==='video').length,2);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.video'",[b.id])).rows[0].n,0);
 const slot=saved.find(s=>s.format==='video'),draft={...slot.video_draft,prompt:'TEST edited video direction'};
 const edited=await plans.edit(alice,b.id,slot.id,{revision:slot.revision,video_draft:draft});assert.equal(edited.video_draft.prompt,draft.prompt);assert.equal(edited.state,'content_needed');
 await assert.rejects(plans.edit(bob,b.id,slot.id,{revision:edited.revision,video_draft:draft}));
 await assert.rejects(plans.edit(alice,b.id,slot.id,{revision:edited.revision,video_draft:{...draft,duration_seconds:60}}));
 assert.equal((await plans.history(alice,b.id,slot.id)).events.at(-1).snapshot.video_draft.prompt,draft.prompt);
});

test('content planning rejects non-GPT providers before recording jobs or spending',async()=>{
 const b=await fresh(),before=calls;
 for(const provider of ['gemini','claude'])assert.throws(()=>planning.submit(alice,b.id,{starts_on:'2026-11-01',provider},randomUUID()),/GPT only/);
 assert.equal((await planning.jobs(alice,b.id)).jobs.length,0);assert.equal(calls,before);
});

const loopBody={starts_on:'2090-01-01',duration_days:7,post_count:4,video_count:2,repeat_cycles:3,loop_budget_micros:1000000,confirm_recurring_spend:true};
test('recurring planning persists bounded idempotent cycles, defers future work and refreshes approved context once per cycle',async()=>{
 const b=await fresh();await grant(b);const key=randomUUID(),j=await planning.submit(alice,b.id,loopBody,key),before=calls;
 assert.equal((await planning.submit(alice,b.id,loopBody,key)).id,j.id);
 const all=(await admin.query('SELECT job_id AS id,scheduled_at,input FROM app.planning_requests WHERE loop_id=$1 ORDER BY scheduled_at',[j.loop_id])).rows;
 assert.equal(all.length,3);assert.deepEqual(all.map(r=>r.input.preferences.starts_on),['2090-01-01','2090-01-08','2090-01-15']);
 assert.equal(await handler.run(scope(b,all[1])),'finished');assert.equal(calls,before);assert.equal((await row(all[1])).status,'queued');
 const future=(await admin.query('SELECT available_at FROM app.job_dispatch WHERE job_id=$1',[all[1].id])).rows[0];assert.equal(new Date(future.available_at).toISOString(),'2090-01-08T00:00:00.000Z');
 assert.equal(await handler.run(scope(b,j)),'succeeded');
 let state=await brain.read(alice,org.id,b.id);await brain.manual(alice,org.id,b.id,{field:'offering',value:'Updated approved clinic scheduling offering'},randomUUID());
 state=await brain.read(alice,org.id,b.id);for(const f of state.findings)await brain.review(alice,org.id,b.id,f.id,{decision:f.field==='offering'&&f.value==='Scheduling tools for clinics'?'wrong':'correct',revision:f.revision});
 state=await brain.read(alice,org.id,b.id);await brain.approve(alice,org.id,b.id,{revision:state.revision});
 await admin.query("UPDATE app.planning_requests SET scheduled_at=now()-interval '1 second' WHERE job_id=$1",[all[1].id]);
 assert.equal(await handler.run(scope(b,all[1])),'succeeded');assert.ok(inputs.at(-1).brand.facts.some(f=>f.value==='Updated approved clinic scheduling offering'));
 const snapshot=(await admin.query('SELECT execution_input,execution_brain_id,brain_id FROM app.planning_requests WHERE job_id=$1',[all[1].id])).rows[0];assert.notEqual(snapshot.execution_brain_id,snapshot.brain_id);
 await assert.rejects(jobs.transaction(scope(b,all[1]),db=>db.query("UPDATE app.planning_requests SET execution_input='{}' WHERE job_id=$1",[all[1].id])),/immutable/);
 assert.equal((await planning.loops(alice,b.id)).loops[0].completed,2);
 await planning.stopLoop(alice,b.id,j.loop_id);assert.equal(await handler.run(scope(b,all[2])),'finished');assert.equal((await row(all[2])).status,'canceled');assert.equal(calls,before+2);
 await assert.rejects(planning.stopLoop(bob,b.id,j.loop_id));await assert.rejects(planning.stopLoop(viewer,b.id,j.loop_id));
});

test('recurring planning requires spending consent and enforces its own aggregate ceiling before model calls',async()=>{
 const b=await fresh();await grant(b);const before=calls;
 assert.throws(()=>planning.submit(alice,b.id,{...loopBody,confirm_recurring_spend:false},randomUUID()),/Confirm/);
 assert.throws(()=>planning.submit(alice,b.id,{...loopBody,repeat_cycles:13},randomUUID()));
 const j=await planning.submit(alice,b.id,{...loopBody,loop_budget_micros:1},randomUUID());assert.equal(await handler.run(scope(b,j)),'rejected');assert.equal((await row(j)).error_code,'PLAN_LOOP_BUDGET_EXHAUSTED');assert.equal(calls,before);
 await planning.stopLoop(alice,b.id,j.loop_id);
 const next=await planning.submit(alice,b.id,loopBody,randomUUID());assert.equal(await handler.run(scope(b,next)),'succeeded');
 const reserved=Number((await admin.query('SELECT sum(reserved_micros)::text AS n FROM app.planning_calls WHERE loop_id=$1',[next.loop_id])).rows[0].n);
 await admin.query('UPDATE app.planning_loops SET budget_micros=$2 WHERE id=$1',[next.loop_id,reserved]);
 const second=(await admin.query("UPDATE app.planning_requests SET scheduled_at=now()-interval '1 second' WHERE loop_id=$1 AND job_id<>$2 RETURNING job_id AS id",[next.loop_id,next.id])).rows[0];
 assert.equal(await handler.run(scope(b,second)),'rejected');assert.equal((await row(second)).error_code,'PLAN_LOOP_BUDGET_EXHAUSTED');assert.equal(calls,before+1);
});

test('an ambiguous earlier loop call blocks all later paid occurrences',async()=>{
 const b=await fresh();await grant(b);const j=await planning.submit(alice,b.id,loopBody,randomUUID()),before=calls;
 transport=async()=>{calls++;throw new TypeError('MOCK lost response');};try{assert.equal(await handler.run(scope(b,j)),'unknown');}finally{transport=undefined;}
 const second=(await admin.query("UPDATE app.planning_requests SET scheduled_at=now()-interval '1 second' WHERE loop_id=$1 AND job_id<>$2 RETURNING job_id AS id",[j.loop_id,j.id])).rows[0];
 assert.equal(await handler.run(scope(b,second)),'rejected');assert.equal((await row(second)).error_code,'PLAN_LOOP_NEEDS_ATTENTION');assert.equal(calls,before+1);
});

test('dispatcher waits for the persisted loop due time and submits the occurrence only once',async()=>{
 const {JobDispatcher}=await import('../../dist/jobs.js');const b=await fresh();await grant(b);const j=await planning.submit(alice,b.id,loopBody,randomUUID());
 const later=(await admin.query('SELECT job_id FROM app.planning_requests WHERE loop_id=$1 AND job_id<>$2 ORDER BY scheduled_at LIMIT 1',[j.loop_id,j.id])).rows[0].job_id;
 await admin.query('UPDATE app.job_dispatch SET dispatched_at=now()');await admin.query('UPDATE app.job_dispatch SET dispatched_at=NULL WHERE job_id=$1',[later]);
 const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl});let sent=0;
 try{const dispatcher=new JobDispatcher(dispatchPool,{workflow:{start:async(name,args)=>{sent++;assert.equal(name,'generatePlanWorkflow');assert.equal(args.args[0].jobId,later);}}},'local-loop-fixture');
  assert.equal(await dispatcher.runOnce(),false);assert.equal(sent,0);
  await admin.query("UPDATE app.job_dispatch SET available_at=now()-interval '1 second' WHERE job_id=$1",[later]);
  assert.equal(await dispatcher.runOnce(),true);assert.equal(sent,1);assert.equal(await dispatcher.runOnce(),false);assert.equal(sent,1);
 }finally{await dispatchPool.end();}
});


test('Canvas planning saves the request, genuine result and calendar link in one isolated conversation',async()=>{
 const {Canvas}=await import('../../dist/canvas.js'),canvas=new Canvas(businesses,null),b=await fresh();await grant(b);
 const body={starts_on:'2090-02-01',duration_days:7,post_count:7,brief:'Plan a launch week for this business',canvas_thread_id:null},key=randomUUID();
 const j=await planning.submit(alice,b.id,body,key);assert.ok(j.thread_id);assert.equal((await planning.submit(alice,b.id,body,key)).thread_id,j.thread_id);
 let c=await canvas.thread(alice,b.id,j.thread_id);assert.equal(c.messages.length,1);assert.equal(c.messages[0].role,'user');assert.ok(c.messages[0].content.includes(body.brief));assert.equal(c.planning_runs[0].status,'queued');assert.equal(c.projects.length,0);
 assert.equal(await handler.run(scope(b,j)),'succeeded');c=await canvas.thread(alice,b.id,j.thread_id);assert.equal(c.messages.length,2);assert.equal(c.messages[1].role,'assistant');assert.ok(c.messages[1].content.includes('Prepared 7 draft posts'));assert.ok(c.planning_runs[0].output_plan_id);
 assert.equal(await handler.run(scope(b,j)),'finished');assert.equal((await canvas.thread(alice,b.id,j.thread_id)).messages.length,2);
 const follow=await planning.submit(alice,b.id,{...body,canvas_thread_id:j.thread_id,brief:'Now focus this week on our audience'},randomUUID());assert.equal(follow.thread_id,j.thread_id);assert.equal(await handler.run(scope(b,follow)),'succeeded');assert.equal((await canvas.thread(alice,b.id,j.thread_id)).messages.length,4);
 const other=await fresh();await assert.rejects(planning.submit(alice,other.id,{...body,canvas_thread_id:j.thread_id},randomUUID()),/Conversation not found/);await assert.rejects(canvas.thread(bob,b.id,j.thread_id));
 const alien=await canvas.createThread(alice,b.id,{title:'Different conversation'},randomUUID());
 await assert.rejects(jobs.transaction(scope(b,j),db=>db.query("INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'assistant','forged')",[randomUUID(),org.id,b.id,alien.id,j.id])),e=>e.code==='42501');
});


test('natural follow-up planning snapshots current edited context and saves resolved counts without overwriting the source',async()=>{
 const b=await fresh();await grant(b);const original=await planning.submit(alice,b.id,{starts_on:'2090-03-01',duration_days:6,post_count:6,video_count:2,canvas_thread_id:null},randomUUID());assert.equal(await handler.run(scope(b,original)),'succeeded');
 const source=(await planning.jobs(alice,b.id)).jobs[0].output_plan_id;
 const slot=(await admin.query('SELECT id,revision,video_draft FROM app.content_slots WHERE plan_id=$1 AND video_draft IS NOT NULL ORDER BY planned_at LIMIT 1',[source])).rows[0];
 await plans.edit(alice,b.id,slot.id,{revision:slot.revision,video_draft:{...slot.video_draft,script:'Owner revised script about the approved offering'}});
 const before=(await admin.query('SELECT revision,video_draft FROM app.content_slots WHERE id=$1',[slot.id])).rows[0];
 const body={starts_on:'2090-04-01',brief:'Make this a weekly plan with two videos, retaining my revised script direction',planning_mode:'natural',reference_plan_id:source,canvas_thread_id:original.thread_id};
 assert.throws(()=>planning.submit(alice,b.id,{...body,repeat_cycles:2,confirm_recurring_spend:true,loop_budget_micros:1000000},randomUUID()),/fixed/);
 const other=await fresh();await assert.rejects(planning.submit(alice,other.id,body,randomUUID()),/Reference plan not found/);
 const j=await planning.submit(alice,b.id,body,randomUUID());
 transport=async(url,init)=>{calls++;const wire=JSON.parse(init.body),context=inputFrom(wire);assert.equal(context.planning_mode,'natural');assert.equal(context.reference_plan.id,source);assert.ok(context.reference_plan.slots.some(s=>s.video_draft?.script===before.video_draft.script));assert.ok(wire.input.some(m=>m.role==='system'&&m.content.includes('settings object')));const settings={duration_days:7,post_count:7,video_count:2};return modelResponse({...generatedPlan({...context,...settings}),settings});};
 try{assert.equal(await handler.run(scope(b,j)),'succeeded');}finally{transport=undefined;}
 const saved=(await planning.jobs(alice,b.id)).jobs.find(r=>r.id===j.id);assert.equal(saved.duration_days,7);assert.equal(saved.post_count,7);
 const plan=await planning.detail(alice,b.id,saved.output_plan_id);assert.equal(plan.duration_days,7);assert.equal(plan.skill_manifest.source_plan.id,source);assert.equal(plan.strategy.slots.length,7);assert.equal(plan.strategy.slots.filter(s=>s.format==='video').length,2);
 assert.deepEqual((await admin.query('SELECT revision,video_draft FROM app.content_slots WHERE id=$1',[slot.id])).rows[0],before);
 assert.equal(await countPlans(b),2);assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.video_requests WHERE brand_id=$1',[b.id])).rows[0].n,0);
});

test('owner business stage and growth targets persist safely and reach mixed static/video planning',async()=>{
 const b=await fresh();await grant(b);
 const original=await businesses.onboarding(alice,b.id);
 const patch={revision:original.revision,step:3,goal:'leads',timezone:'UTC',cadence:3,channels:['linkedin','instagram'],must_avoid:'No guaranteed returns',preferences_edited:true,business_stage:'launching',growth_expectation:'20 qualified enquiries per month within 90 days'};
 const saved=await businesses.onboarding(alice,b.id,patch);
 assert.equal(saved.business_stage,'launching');assert.equal(saved.growth_expectation,patch.growth_expectation);
 await assert.rejects(businesses.onboarding(bob,b.id,{...patch,revision:saved.revision}),/not found/i);
 await assert.rejects(businesses.onboarding(alice,b.id,{...patch,revision:saved.revision,business_stage:'invented'}),/business stage/i);
 await assert.rejects(businesses.onboarding(alice,b.id,{...patch,revision:saved.revision,growth_expectation:'x'.repeat(601)}),/600/);
 const {business_stage,growth_expectation,...legacy}=patch;
 const preserved=await businesses.onboarding(alice,b.id,{...legacy,revision:saved.revision});
 assert.equal(preserved.growth_expectation,growth_expectation);assert.equal(preserved.business_stage,business_stage);
 const j=await planning.submit(alice,b.id,{starts_on:'2026-11-01',brief:'Plan a month of static and video content',video_count:4},randomUUID());
 let received;
 transport=async(url,init)=>{received=inputFrom(JSON.parse(init.body));return standard(url,init);};
 try{assert.equal(await handler.run(scope(b,j)),'succeeded');}finally{transport=undefined;}
 assert.equal(received.preferences.business_stage,business_stage);assert.equal(received.preferences.growth_expectation,growth_expectation);
 const result=await planning.detail(alice,b.id,(await planning.jobs(alice,b.id)).jobs[0].output_plan_id);
 assert.equal(result.skill_manifest.source_preferences.business_stage,business_stage);
 assert.equal(result.strategy.slots.filter(s=>s.format==='video').length,4);
 assert.equal(result.strategy.slots.filter(s=>s.format==='static').length,26);
});
