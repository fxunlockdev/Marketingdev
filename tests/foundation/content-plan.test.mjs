import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApplication} from '../../dist/app.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {BrandBrain,canonicalJSON,hash} from '../../dist/brand-brain.js';
import {Canvas} from '../../dist/canvas.js';
import {ContentPlan,planTime} from '../../dist/content-plan.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL});
let runtime,base,ws,businesses,plans,canvas,alice,bob,editor,viewer,org,brand,sibling,version,project,design,brainId;
const range={start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'};
async function api(path,{user=alice,body,method='GET',key,origin=config.origin}={}){
 const r=await fetch(base+path,{method,headers:{...(user?{cookie:user.cookie}:{}),origin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
const path=(suffix,b=brand)=>`/api/v1/businesses/${b.id}/${suffix}`;
const query=(extra={})=>new URLSearchParams({...range,...extra}).toString();
const slot=(channel='linkedin',vid=version?.id)=>({channel,planned_at:'2026-11-05T08:00:00Z',format:'static',brief:'TEST FIXTURE: explain an approved offering',pillar:'Education',hook:'A useful tip',cta:'Learn more',creative_version_id:vid??null});
const payload=(slots=[slot()])=>({title:'TEST FIXTURE November plan',objective:'Explain the offering',starts_on:'2026-11-01',timezone:'UTC',slots});
const reviewBody=(s,decision,feedback='')=>({revision:s.revision,creative_version_id:s.creative_version_id,creative_sha256:s.creative_sha256,decision,feedback});
async function create(slots=[slot()]){
 const r=await api(path('content-plans'),{method:'POST',key:randomUUID(),body:payload(slots)});assert.equal(r.status,201,JSON.stringify(r.body));
 return (await plans.list(alice.id,brand.id,{...range,plan_id:r.body.id})).slots;
}
async function signup(){
 await admin.query('DELETE FROM auth."rateLimit"');
 const name=randomUUID(),password='a-strong-fixture-password-2026';
 const r=await api('/api/auth/sign-up/email',{user:null,method:'POST',body:{name,email:`${name}@example.test`,password}});assert.equal(r.status,200,JSON.stringify(r.body));
 // Explicit identity fixture: no external email delivery claim. Sign-in/session cookie is genuine.
 await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[r.body.user.id]);
 const login=await api('/api/auth/sign-in/email',{user:null,method:'POST',body:{email:`${name}@example.test`,password}});assert.equal(login.status,200);
 return {id:r.body.user.id,cookie:login.cookie};
}
before(async()=>{
 runtime=await createApplication(config);await runtime.app.listen(0,'127.0.0.1');base=await runtime.app.getUrl();
 ws=new Workspaces(runtime.database);businesses=new Businesses(runtime.database,ws);plans=new ContentPlan(businesses);canvas=new Canvas(businesses,null);
 alice=await signup();bob=await signup();editor=await signup();viewer=await signup();
 org=await ws.create(alice.id,{name:'Planning account'});
 brand=await ws.createBrand(alice.id,org.id,{name:'Planning business'},randomUUID());sibling=await ws.createBrand(alice.id,org.id,{name:'Sibling business'},randomUUID());
 for(const [u,role] of [[editor,'editor'],[viewer,'viewer']])await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org.id,u.id,role]);
 const brain=new BrandBrain(runtime.database);
 for(const [field,value] of [['brand_name','Planning business'],['offering','Planning software'],['audience','Business owners']])await brain.manual(alice.id,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice.id,org.id,brand.id);for(const f of state.findings)await brain.review(alice.id,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});
 state=await brain.read(alice.id,org.id,brand.id);await brain.approve(alice.id,org.id,brand.id,{revision:state.revision});
 brainId=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;
 const thread=await canvas.createThread(alice.id,brand.id,{title:'Test creative'},randomUUID());
 project=randomUUID();const job=randomUUID(),media=randomUUID();
 await admin.query('INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[project,org.id,brand.id,thread.id,'TEST FIXTURE',alice.id]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'creative.generate','succeeded')",[job,org.id,brand.id,alice.id]);
 await admin.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,1,1024,1024)',[media,org.id,brand.id,job,'TEST_FIXTURE_NOT_REAL_MEDIA','0'.repeat(64)]);
 design={schema_version:1,width:1024,height:1024,background_media_id:media,layers:[]};version={id:randomUUID(),sha256:hash(canonicalJSON({design,caption:'TEST FIXTURE',brain_id:brainId}))};
 // Persisted creative fixture, not provider/generated media evidence. Real generation is covered in creative.test.mjs.
 await admin.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[version.id,org.id,brand.id,project,brainId,job,media,JSON.stringify(design),'TEST FIXTURE','{}',version.sha256,alice.id]);
 await admin.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[project,version.id]);
});
after(async()=>{await runtime?.close();await admin.end();});

test('30 real persisted slots across two channels; concurrent request replay creates one plan and no publishing job',async()=>{
 const slots=Array.from({length:30},(_,i)=>({...slot(i%2?'instagram':'linkedin'),planned_at:`2026-11-${String(i+1).padStart(2,'0')}T08:00:00Z`})),body=payload(slots),key=randomUUID();
 const results=await Promise.all(Array.from({length:3},()=>api(path('content-plans'),{method:'POST',key,body})));
 results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r.body)));assert.equal(new Set(results.map(r=>r.body.id)).size,1);
 const plan=results[0].body.id;
 const r=await api(path(`content-plan?${query({plan_id:plan})}`));assert.equal(r.status,200);assert.equal(r.body.total,30);assert.equal(r.body.slots.length,30);assert.ok(r.body.slots.every(s=>s.state==='draft_ready'));
 const li=await api(path(`content-plan?${query({plan_id:plan,channel:'linkedin'})}`));assert.equal(li.body.total,15);assert.ok(li.body.slots.every(s=>s.channel==='linkedin'));
 assert.equal((await api(path('content-plans'),{method:'POST',key,body:{...body,title:'Changed'}})).status,409);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind<>'creative.generate'",[brand.id])).rows[0].n,0);
});
test('genuine HTTP sessions, business RLS and viewer/worker restrictions protect plans and review history',async()=>{
 const [s]=await create();
 assert.equal((await api(path(`content-plan?${query()}`),{user:null})).status,401);
 assert.equal((await api(path(`content-plan?${query()}`),{user:bob})).status,404);
 assert.equal((await api(path(`content-slots/${s.id}/history`,sibling))).status,404);
 assert.equal((await api(path('content-plans'),{user:viewer,method:'POST',key:randomUUID(),body:payload()})).status,403);
 assert.equal((await api(path(`reviews/${s.id}`),{user:viewer,method:'POST',body:reviewBody(s,'pending_review')})).status,403);
 assert.equal((await api(path('content-plans',sibling),{method:'POST',key:randomUUID(),body:payload()})).status,404);
 await runtime.database.transaction(alice.id,org.id,false,async db=>{assert.equal((await db.query('SELECT id FROM app.content_slots WHERE id=$1',[s.id])).rowCount,0);},sibling.id);
 const worker=new Pool({connectionString:config.jobs.workerDatabaseUrl});try{await assert.rejects(worker.query('SELECT * FROM app.content_slots'),e=>e.code==='42501');}finally{await worker.end();}
 await runtime.database.transaction(alice.id,org.id,true,async db=>{await assert.rejects(db.query('DELETE FROM app.content_slot_events WHERE slot_id=$1',[s.id]),e=>e.code==='42501');},brand.id);
});
test('LinkedIn and Instagram approvals are independent, retained after reload, and exact-version history is append-only',async()=>{
 const slots=await create([slot('linkedin'),slot('instagram')]),li=slots.find(s=>s.channel==='linkedin'),ig=slots.find(s=>s.channel==='instagram');
 const pending=(await api(path(`reviews/${li.id}`),{user:editor,method:'POST',body:reviewBody(li,'pending_review')})).body;
 assert.equal(pending.state,'pending_review');
 assert.equal((await api(path(`reviews/${li.id}`),{user:editor,method:'POST',body:reviewBody(pending,'approved')})).status,403);
 const approved=await api(path(`reviews/${li.id}`),{method:'POST',body:reviewBody(pending,'approved')});assert.equal(approved.status,201);assert.equal(approved.body.state,'approved');
 const inbox=await api(path(`review-inbox?${query({plan_id:li.plan_id,channel:'linkedin'})}`));assert.equal(inbox.body.total,1);assert.equal(inbox.body.slots[0].approved_by,alice.id);
 const reload=await plans.list(alice.id,brand.id,{...range,plan_id:ig.plan_id});assert.equal(reload.slots.find(s=>s.id===ig.id).state,'draft_ready');
 const h=await api(path(`content-slots/${li.id}/history`));assert.deepEqual(h.body.events.map(e=>e.action),['created','pending_review','approved']);assert.equal(h.body.events[2].creative_sha256,version.sha256);
 // Channel approval never promotes a global Canvas version or creates a remote post.
 assert.equal((await admin.query('SELECT status FROM app.creative_versions WHERE id=$1',[version.id])).rows[0].status,'draft');
});
test('stale approval and unconfirmed edits are denied; confirmed edits reset approval and preserve prior evidence',async()=>{
 let [s]=await create();s=await plans.review(alice.id,brand.id,s.id,reviewBody(s,'pending_review'));s=await plans.review(alice.id,brand.id,s.id,reviewBody(s,'approved'));
 const edit={revision:s.revision,planned_at:'2026-11-06T08:00:00Z'};
 assert.equal((await api(path(`content-slots/${s.id}`),{method:'PATCH',body:edit})).status,409);
 const changed=await api(path(`content-slots/${s.id}`),{method:'PATCH',body:{...edit,reset_approval:true}});assert.equal(changed.status,200);assert.equal(changed.body.state,'draft_ready');assert.equal(changed.body.approved_by,null);
 assert.equal((await api(path(`reviews/${s.id}`),{method:'POST',body:reviewBody(s,'approved')})).status,409);
 const history=await plans.history(alice.id,brand.id,s.id);assert.equal(history.events[2].action,'approved');assert.equal(history.events[3].snapshot.planned_at,'2026-11-06T08:00:00.000Z');
});
test('bulk approval requires confirmation and is atomic when any selected revision is stale',async()=>{
 let slots=await create([slot(),slot('instagram')]);slots=await Promise.all(slots.map(s=>plans.review(alice.id,brand.id,s.id,reviewBody(s,'pending_review'))));
 const items=slots.map(s=>({id:s.id,...reviewBody(s,'approved')})).map(({decision,feedback,...s})=>s);
 assert.equal((await api(path('reviews/bulk-approve'),{method:'POST',body:{confirmed:false,items}})).status,400);
 assert.equal((await api(path('reviews/bulk-approve'),{method:'POST',body:{confirmed:true,items:[items[0],{...items[1],revision:1}]}})).status,409);
 assert.ok((await plans.list(alice.id,brand.id,{...range,plan_id:slots[0].plan_id})).slots.every(s=>s.state==='pending_review'));
 const ok=await api(path('reviews/bulk-approve'),{method:'POST',body:{confirmed:true,items}});assert.equal(ok.status,201,JSON.stringify(ok.body));assert.ok(ok.body.slots.every(s=>s.state==='approved'));
});
test('competing reviews accept exactly one decision; feedback and cancellation survive reload',async()=>{
 let [s]=await create();s=await plans.review(alice.id,brand.id,s.id,reviewBody(s,'pending_review'));
 assert.equal((await api(path(`reviews/${s.id}`),{method:'POST',body:reviewBody(s,'changes_requested')})).status,400);
 const responses=await Promise.all(['changes_requested','rejected'].map(d=>api(path(`reviews/${s.id}`),{method:'POST',body:reviewBody(s,d,'TEST FIXTURE: Make the message more specific')})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const winner=responses.find(r=>r.status===201).body;
 const h=await plans.history(alice.id,brand.id,s.id);assert.equal(h.events.length,3);assert.equal(h.events[2].feedback,'TEST FIXTURE: Make the message more specific');
 const cancelled=await plans.review(alice.id,brand.id,s.id,reviewBody(winner,'cancelled'));assert.equal(cancelled.state,'cancelled');
 assert.equal((await api(path(`content-slots/${s.id}`),{method:'PATCH',body:{revision:cancelled.revision,brief:'Restore'}})).status,409);
});
test('calendar validates local date boundaries, leap dates and DST instants without inventing schedules',async()=>{
 assert.equal(planTime('2026-10-31T16:00:00Z','2026-11-01','Asia/Kuala_Lumpur'),'2026-10-31T16:00:00.000Z');
 assert.throws(()=>planTime('2026-10-31T15:59:59Z','2026-11-01','Asia/Kuala_Lumpur'));
 assert.throws(()=>planTime('2026-11-30T16:00:00Z','2026-11-01','Asia/Kuala_Lumpur'));
 for(const t of ['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'])assert.equal(planTime(t,'2026-11-01','America/New_York'),t.replace('Z','.000Z'));
 for(const body of [{...payload(),starts_on:'2026-02-30'},{...payload(),timezone:'Mars/Olympus'},payload([{...slot(),planned_at:'2026-11-31T08:00:00Z'}]),payload([{...slot(),channel:'unknown'}])])assert.equal((await api(path('content-plans'),{method:'POST',key:randomUUID(),body})).status,400);
 assert.equal((await api(path(`content-plan?${query({end:'2027-11-01T00:00:00Z'})}`))).status,400);
});
test('a newer saved creative cannot inherit approval or be approved through an older linked slot',async()=>{
 let [s]=await create();s=await plans.review(alice.id,brand.id,s.id,reviewBody(s,'pending_review'));
 const next=await canvas.save(alice.id,brand.id,project,{parent_id:version.id,design,caption:'TEST FIXTURE updated caption'});
 const failed=await api(path(`reviews/${s.id}`),{method:'POST',body:reviewBody(s,'approved')});assert.equal(failed.status,409);
 assert.equal((await plans.list(alice.id,brand.id,{...range,plan_id:s.plan_id})).slots[0].has_newer_version,true);
 const updated=await plans.edit(alice.id,brand.id,s.id,{revision:s.revision,creative_version_id:next.id});assert.equal(updated.state,'draft_ready');assert.notEqual(updated.creative_sha256,s.creative_sha256);
 const history=await plans.history(alice.id,brand.id,s.id);assert.equal(history.events[1].creative_version_id,version.id);assert.equal(history.events[2].creative_version_id,next.id);
 version={id:next.id,sha256:updated.creative_sha256};
});
test('failed history append rolls back the edit and concurrent saves never lose the winning update',async()=>{
 let [s]=await create();
 await admin.query("CREATE FUNCTION app.fail_plan_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fixture'; END $$; CREATE TRIGGER test_plan_history BEFORE INSERT ON app.content_slot_events FOR EACH ROW EXECUTE FUNCTION app.fail_plan_history();");
 try{assert.equal((await api(path(`content-slots/${s.id}`),{method:'PATCH',body:{revision:s.revision,brief:'Must roll back'}})).status,503);}finally{await admin.query('DROP TRIGGER test_plan_history ON app.content_slot_events; DROP FUNCTION app.fail_plan_history()');}
 let saved=(await plans.list(alice.id,brand.id,{...range,plan_id:s.plan_id})).slots[0];assert.equal(saved.brief,s.brief);assert.equal(saved.revision,1);
 const results=await Promise.all(['A','B'].map(brief=>api(path(`content-slots/${s.id}`),{method:'PATCH',body:{revision:1,brief}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);saved=(await plans.list(alice.id,brand.id,{...range,plan_id:s.plan_id})).slots[0];assert.equal(saved.brief,results.find(r=>r.status===200).body.brief);assert.equal((await plans.history(alice.id,brand.id,s.id)).events.length,2);
});

// PostgreSQL UUIDs are case-insensitive. Advisory lock keys must identify the same
// business for either URL spelling, or concurrent changes could bypass serialization.
test('uppercase business URLs share the exact Canvas and content review locks',async()=>{
 const [s]=await create();
 const lock=await admin.connect();
 try {
  for(const operation of ['content','canvas']) {
   await lock.query('BEGIN');
   await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.id}`]);
   let settled=false;
   const pending=operation==='content'
    ?api(`/api/v1/businesses/${brand.id.toUpperCase()}/content-slots/${s.id}`,{method:'PATCH',body:{revision:s.revision,brief:'Case-normalized update'}})
    :api(`/api/v1/businesses/${brand.id.toUpperCase()}/creative-projects/${project}/versions`,{method:'POST',body:{parent_id:version.id,design,caption:'TEST FIXTURE uppercase URL edit'}});
   pending.then(()=>{settled=true;},()=>{settled=true;});
   let waiting=false;
   try {
    for(let i=0;i<100&&!settled;i++) {
     waiting=(await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='desvio_app' AND wait_event='advisory'")).rows[0].n>0;
     if(waiting)break;
     await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(waiting,true,'Request must wait on the canonical business lock');
    assert.equal(settled,false);
   } finally {await lock.query('COMMIT');}
   const result=await pending;assert.equal(result.status,operation==='content'?200:201,JSON.stringify(result.body));
  }
 } finally {await lock.query('ROLLBACK');lock.release();}
});
