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
import {Strategies} from '../../dist/strategies.js';
import {SlotCreatives} from '../../dist/slot-creatives.js';
import {Canvas} from '../../dist/canvas.js';
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
async function grant(b,budget=10000000){await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',100000000,0.01,0.02,100000,'LOCAL TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO NOTHING",[org.id,b.id]);await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'MOCK-plan',now()+interval '1 hour',$3,0.01,0.02,'LOCAL TEST ONLY') ON CONFLICT(organization_id,brand_id,provider) DO UPDATE SET budget_micros=$3,enabled=true",[org.id,b.id,budget]);}
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


const strategyInput={kind:'education',name:'Learn with us',starts_on:'2027-01-04',weekly_posts:3,weeks:1,weekly_increase:0,credit_cap:200,planning_credits:20,image_credits:50,schedule_consent:false};
const strategies=()=>new Strategies(planning,new SlotCreatives(plans,new Canvas(businesses,null)));
test('manual strategy creates one durable capped planning occurrence and idempotent grouping',async()=>{
 const b=await fresh();await grant(b);const service=strategies(),key=randomUUID();
 await assert.rejects(service.create(bob,b.id,strategyInput,key));await assert.rejects(service.create(viewer,b.id,strategyInput,key));
 const made=await service.create(alice,b.id,strategyInput,key);assert.deepEqual(await service.create(alice,b.id,strategyInput,key),made);
 await assert.rejects(service.create(alice,b.id,{...strategyInput,name:'Changed'},key),/another strategy/);
 const saved=(await service.list(alice,b.id)).strategies[0];assert.equal(saved.id,made.id);assert.equal(saved.occurrences.length,1);assert.equal(saved.allocated_credits,20);
 const loop=(await admin.query('SELECT * FROM app.planning_loops WHERE id=$1',[saved.loop_id])).rows[0];assert.equal(loop.cycles,1);assert.equal(Number(loop.budget_micros),200000);
 const job={id:saved.occurrences[0].job_id};assert.equal(await handler.run(scope(b,job)),'succeeded');const reloaded=(await service.list(alice,b.id)).strategies[0];assert.ok(reloaded.occurrences[0].plan_id);assert.equal(reloaded.occurrences[0].status,'succeeded');
 await admin.query('UPDATE app.creative_grants SET max_image_request_micros=5000000 WHERE brand_id=$1',[b.id]);assert.ok((await service.list(alice,b.id)).quote.image_credits>2000);await assert.rejects(service.generate(alice,b.id,made.id,reloaded.occurrences[0].plan_id),/more generation capacity/);assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.strategy_image_requests WHERE strategy_id=$1',[made.id])).rows[0].n,0);await admin.query('UPDATE app.creative_grants SET max_image_request_micros=100000 WHERE brand_id=$1',[b.id]);
 const images=await service.generate(alice,b.id,made.id,reloaded.occurrences[0].plan_id);assert.equal(images.jobs.length,3);assert.deepEqual(await service.generate(alice,b.id,made.id,reloaded.occurrences[0].plan_id),images);assert.equal((await service.list(alice,b.id)).strategies[0].allocated_credits,170);
 await admin.query("UPDATE app.jobs SET status='failed',error_code='PROVIDER_RESULT_UNCERTAIN' WHERE id=$1",[images.jobs[0].id]);const failedView=(await service.list(alice,b.id)).strategies[0].occurrences[0];assert.equal(failedView.images_failed,1);assert.equal(failedView.images_requested,3);assert.equal(failedView.images_active,2);for(const status of ['rejected','unknown','canceled']){await admin.query('UPDATE app.jobs SET status=$2 WHERE id=$1',[images.jobs[0].id,status]);assert.equal((await service.list(alice,b.id)).strategies[0].occurrences[0].images_failed,1);}
 const caps=(await admin.query('SELECT max_cost_micros FROM app.creative_requests WHERE job_id=ANY($1::uuid[])',[images.jobs.map(j=>j.id)])).rows;assert.ok(caps.every(c=>Number(c.max_cost_micros)===500000));

 await assert.rejects(service.list(bob,b.id));assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.strategy_occurrences WHERE strategy_id=$1',[made.id])).rows[0].n,1);
});
test('scheduled weekly strategy requires consent, stores growth and stops future jobs',async()=>{
 const b=await fresh();await grant(b);const service=strategies(),input={...strategyInput,weeks:8,weekly_increase:2,weekly_posts:13};
 assert.throws(()=>service.create(alice,b.id,input,randomUUID()),/Confirm scheduled/);
 const made=await service.create(alice,b.id,{...input,schedule_consent:true},randomUUID()),saved=(await service.list(alice,b.id)).strategies[0];assert.equal(saved.occurrences.length,8);
 const requests=(await admin.query('SELECT input,scheduled_at FROM app.planning_requests WHERE loop_id=$1 ORDER BY scheduled_at',[saved.loop_id])).rows;assert.equal(requests[0].input.post_count,13);assert.equal(requests[4].input.post_count,14);
 assert.ok(new Date(requests[1].scheduled_at)>new Date());await service.stop(alice,b.id,made.id);assert.ok((await service.list(alice,b.id)).strategies[0].stopped_at);
 const jobs=(await admin.query('SELECT j.cancel_requested FROM app.jobs j JOIN app.strategy_occurrences o ON o.job_id=j.id WHERE o.strategy_id=$1',[made.id])).rows;assert.ok(jobs.every(j=>j.cancel_requested));
});
test('strategy credit validation fails before any job is created',async()=>{
 const b=await fresh();await grant(b);const service=strategies();assert.throws(()=>service.create(alice,b.id,{...strategyInput,credit_cap:21},randomUUID()),/cover planning/);assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1',[b.id])).rows[0].n,0);
});
