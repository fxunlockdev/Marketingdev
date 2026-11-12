import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {ContentPlan} from '../../dist/content-plan.js';
import {CampaignBlogs} from '../../dist/campaign-blogs.js';
import {BlogJobs} from '../../dist/blog-jobs.js';
import {BLOG_SKILLS,BLOG_VERSION} from '../../dist/blog-contracts.js';
import {AssetJobs} from '../../dist/jobs.js';
import {UncertainRequests} from '../../dist/uncertain-requests.js';
import {canonicalJSON,hash} from '../../dist/brand-brain.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),pool=new Pool({connectionString:config.appDatabaseUrl}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl}),database=new TenantDatabase(pool),workspaces=new Workspaces(database),businesses=new Businesses(database,workspaces),plans=new ContentPlan(businesses);
const alice=randomUUID(),bob=randomUUID(),editor=randomUUID(),reviewer=randomUUID();let org,brand,plan,blog,calls=0;
const service=new CampaignBlogs(plans),uncertain=new UncertainRequests(businesses);
// The harness and the provider are local mocks: the article is written by the worker job, never by the API.
const provider={configured:true,plannerRequest:message=>({sha256:hash(canonicalJSON(message)),maxInputTokens:10,maxOutputTokens:10}),plan:async req=>{calls++;assert.match(req.messages[1].content,/Approved product/);return {content:JSON.stringify({title:'A practical guide',body:'# A practical guide\n\nUseful grounded advice.',warnings:[]}),tool_calls:[]};}};
const skills=Object.entries(BLOG_SKILLS).map(([name,pin])=>({name,...pin}));
const runtime={configured:true,run:async(input,model,validate)=>{const answer=await model({type:'model',step:1,tools:[],messages:[{role:'system',content:'Blog writer'},{role:'user',content:JSON.stringify(input)}]});
 return validate({type:'result',version:BLOG_VERSION,article:JSON.parse(answer.content),skills,reads:skills.map(s=>`/skills/${s.name}/SKILL.md`),model_calls:1,helpers_executed:false});}};
const blogJobs=new BlogJobs(new AssetJobs(worker,{},{}),runtime,provider);
const scope=job=>({organizationId:org.id,brandId:brand.id,jobId:job});
const call=async id=>(await admin.query('SELECT * FROM app.campaign_blog_calls WHERE id=$1',[id])).rows[0];
const job=async id=>(await admin.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[id])).rows[0];
before(async()=>{for(const user of [alice,bob,editor,reviewer])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[user,'Blog fixture',`${user}@example.test`]);org=await workspaces.create(alice,{name:'Blog fixture'});brand=await workspaces.createBrand(alice,org.id,{name:'Blog brand'},randomUUID());await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'editor')",[org.id,editor]);await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'editor','selected')",[org.id,reviewer]);await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'reviewer')",[org.id,brand.id,reviewer]);plan=await plans.create(alice,brand.id,{title:'Blog campaign',objective:'Educate',starts_on:'2026-10-28',timezone:'UTC',slots:[{format:'static',channel:'instagram',planned_at:'2026-10-28T12:00:00Z',brief:'Image placeholder',pillar:'',hook:'',cta:''}]},randomUUID());const snapshot={facts:[{id:'fact',field:'offering',value:'Approved product'}]};await admin.query('INSERT INTO app.brand_brain_versions(id,organization_id,brand_id,review_revision,snapshot,sha256,approved_by) VALUES($1,$2,$3,1,$4,$5,$6)',[randomUUID(),org.id,brand.id,JSON.stringify(snapshot),hash(canonicalJSON(snapshot)),alice]);await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'MOCK-blog',now()+interval '1 hour',10000,1,1,'LOCAL TEST ONLY')",[org.id,brand.id]);});
after(async()=>{await Promise.all([admin.end(),pool.end(),worker.end()]);});

test('the API enqueues an article job; the worker writes it once through the harness',async()=>{
 const key=randomUUID(),body={brief:'Teach readers',context:'Use warm language',planned_at:'2026-10-29T12:00:00Z'};
 blog=await service.create(alice,brand.id,plan.id,body,key);assert.deepEqual(await service.create(alice,brand.id,plan.id,body,key),blog);
 assert.match((await service.detail(alice,brand.id,blog.id)).blog.brief,/warm language/);await assert.rejects(service.detail(bob,brand.id,blog.id));
 const generateKey=randomUUID(),queued=await service.generate(alice,brand.id,blog.id,{revision:1,context:'A useful guide'},generateKey);
 assert.equal(queued.status,'submitted');assert.ok(queued.job_id);assert.equal(calls,0,'the API never calls a model');
 assert.deepEqual(await service.generate(alice,brand.id,blog.id,{revision:1,context:'A useful guide'},generateKey),queued);
 assert.deepEqual((await admin.query('SELECT kind FROM app.job_dispatch WHERE job_id=$1',[queued.job_id])).rows,[{kind:'blog.generate'}]);
 const request=(await admin.query('SELECT input FROM app.campaign_blog_requests WHERE job_id=$1',[queued.job_id])).rows[0].input;
 assert.deepEqual([request.task,request.context,request.brand.facts],['blog','A useful guide',[{id:'fact',field:'offering',value:'Approved product'}]]);
 let detail=await service.detail(alice,brand.id,blog.id);assert.deepEqual(detail.calls.map(c=>[c.status,c.job_id]),[['submitted',queued.job_id]]);assert.equal(detail.generation_available,true);
 await assert.rejects(service.generate(alice,brand.id,blog.id,{revision:1},randomUUID()),/running or awaiting/);
 assert.equal(await blogJobs.run(scope(queued.job_id)),'succeeded');assert.equal(calls,1);
 assert.equal(await blogJobs.run(scope(queued.job_id)),'finished');assert.equal(calls,1,'a replay never pays twice');
 detail=await service.detail(alice,brand.id,blog.id);assert.equal(detail.versions.length,1);assert.equal(detail.blog.title,'A practical guide');assert.equal(detail.calls[0].status,'succeeded');
 const ledger=await call(queued.id);assert.ok(Number(ledger.reserved_micros)>0);assert.equal(ledger.version_id,detail.versions[0].id);
 assert.equal((await admin.query('SELECT count(*)::int n FROM app.campaign_blog_step_calls WHERE job_id=$1',[queued.job_id])).rows[0].n,1);
 await assert.rejects(service.save(editor,brand.id,blog.id,{revision:2,title:'Changed',body:'Changed content',state:'approved'}));
 await service.save(alice,brand.id,blog.id,{revision:2,title:'Edited guide',body:'Edited grounded guide',state:'approved'});assert.equal((await service.detail(alice,brand.id,blog.id)).versions.length,2);
 await assert.rejects(database.transaction(alice,org.id,true,db=>db.query('UPDATE app.campaign_blog_versions SET body=$2 WHERE blog_id=$1',[blog.id,'tampered']),brand.id));
 await assert.rejects(database.transaction(alice,org.id,true,db=>db.query('UPDATE app.campaign_blog_calls SET reserved_micros=1 WHERE blog_id=$1',[blog.id]),brand.id));
 await assert.rejects(database.transaction(alice,org.id,true,db=>db.query("UPDATE app.campaign_blog_calls SET status='rejected' WHERE blog_id=$1",[blog.id]),brand.id));
});

test('an uncertain article call is durable, never resubmitted, and can be released with stop-waiting',async()=>{
 const b=await service.create(alice,brand.id,plan.id,{brief:'Another guide',planned_at:'2026-10-29T12:00:00Z'},randomUUID());
 const original=provider.plan;provider.plan=async()=>{calls++;throw new Error('network interrupted');};
 try{
  const start=calls,queued=await service.generate(alice,brand.id,b.id,{revision:1},randomUUID());
  assert.equal(await blogJobs.run(scope(queued.job_id)),'unknown');assert.equal(calls,start+1);
  assert.equal((await service.detail(alice,brand.id,b.id)).calls[0].status,'unknown');
  await assert.rejects(service.generate(alice,brand.id,b.id,{revision:1},randomUUID()),/awaiting confirmation/);
  assert.equal(await blogJobs.run(scope(queued.job_id)),'finished');assert.equal(calls,start+1);
  const reserved=Number((await call(queued.id)).reserved_micros);assert.ok(reserved>0);
  await assert.rejects(uncertain.stopWaiting(alice,brand.id,queued.job_id,{}),/Acknowledge/);
  assert.deepEqual(await uncertain.stopWaiting(alice,brand.id,queued.job_id,{acknowledge_possible_charge:true}),{id:queued.job_id,status:'canceled',automatically_retried:false});
  assert.deepEqual(await job(queued.job_id),{status:'canceled',error_code:'RESULT_ABANDONED'});
  const released=await call(queued.id);assert.equal(released.status,'abandoned');assert.equal(Number(released.reserved_micros),reserved,'the reservation stays counted');
  provider.plan=original;
  const again=await service.generate(alice,brand.id,b.id,{revision:1},randomUUID());
  assert.equal(await blogJobs.run(scope(again.job_id)),'succeeded');
 }finally{provider.plan=original;}
});

test('reviewer approval cannot rewrite an article or its saved version pointer',async()=>{
 const detail=await service.detail(alice,brand.id,blog.id),current=detail.versions.find(v=>v.id===detail.blog.latest_version_id);
 await assert.rejects(service.save(reviewer,brand.id,blog.id,{revision:detail.blog.revision,title:current.title,body:'Unauthorized rewrite',state:'approved'}),/cannot change/);
 await service.save(reviewer,brand.id,blog.id,{revision:detail.blog.revision,title:current.title,body:current.body,state:'approved'});
 await assert.rejects(database.transaction(reviewer,org.id,true,db=>db.query("UPDATE app.campaign_blogs SET title='Tampered',state='approved',revision=revision+1 WHERE id=$1",[blog.id]),brand.id,true));
 assert.equal((await service.detail(alice,brand.id,blog.id)).versions.length,detail.versions.length);
});

test('article steps share the planning credit with plans and earlier articles',async()=>{
 const b=await service.create(alice,brand.id,plan.id,{brief:'Tight budget',planned_at:'2026-10-29T12:00:00Z'},randomUUID());
 const queued=await service.generate(alice,brand.id,b.id,{revision:1},randomUUID());
 const used=Number((await admin.query('SELECT COALESCE(sum(reserved_micros),0) n FROM app.campaign_blog_calls WHERE brand_id=$1',[brand.id])).rows[0].n);
 await admin.query('UPDATE app.planning_grants SET budget_micros=$2 WHERE brand_id=$1',[brand.id,used+1]);
 const start=calls;assert.equal(await blogJobs.run(scope(queued.job_id)),'rejected');assert.equal(calls,start);
 assert.deepEqual(await job(queued.job_id),{status:'rejected',error_code:'BLOG_BUDGET_EXHAUSTED'});assert.equal((await call(queued.id)).status,'rejected');
 await admin.query('UPDATE app.planning_grants SET budget_micros=1 WHERE brand_id=$1',[brand.id]);
 await assert.rejects(service.generate(alice,brand.id,b.id,{revision:1},randomUUID()),/credit limit reached/);assert.equal(calls,start);
});
