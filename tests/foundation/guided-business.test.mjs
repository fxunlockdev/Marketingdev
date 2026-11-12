import {GuidedVideos} from '../../dist/guided-videos.js';
import {VideoCanvas} from '../../dist/video-canvas.js';
import {VideoReferenceBindings} from '../../dist/video-references.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {AssetJobs} from '../../dist/jobs.js';
import {IntakeJobs} from '../../dist/intake-jobs.js';
import {BrandAnalyzer} from '../../dist/brand-analysis.js';
import OpenAI from 'openai';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),app=new Pool({connectionString:config.appDatabaseUrl});
const database=new TenantDatabase(app),workspaces=new Workspaces(database),businesses=new Businesses(database,workspaces),alice=randomUUID(),bob=randomUUID();
import {GuidedBusiness} from '../../dist/guided-business.js';
import {Intake} from '../../dist/intake.js';
const guided=new GuidedBusiness(businesses,new Intake(businesses));
const worker=new Pool({connectionString:config.jobs.workerDatabaseUrl});
let organization;
before(async()=>{for(const id of [alice,bob])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)',[id,`${id}@example.test`]);organization=await workspaces.create(alice,{name:'Questionnaire account'});});
after(async()=>{await Promise.all([admin.end(),app.end(),worker.end()]);});


const brief={offering:'A family cafe',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Warm daylight',must_follow:'No invented prices'};
test('guided answers persist, reject stale writes and isolate users',async()=>{
 const target=await workspaces.createBrand(alice,organization.id,{name:'Guided cafe'},randomUUID());
 assert.equal((await guided.read(alice,target.id)).revision,0);
 const saved=await guided.save(alice,target.id,{revision:0,brief,step:4});
 assert.equal(saved.revision,1);assert.equal((await guided.read(alice,target.id)).step,4);assert.deepEqual((await guided.read(alice,target.id)).brief,brief);
 await assert.rejects(guided.save(alice,target.id,{revision:0,brief}),/changed/);
 await assert.rejects(guided.save(alice,target.id,{revision:1,brief,step:5}),/valid questionnaire/);
 await assert.rejects(guided.read(bob,target.id),/not found|access|Forbidden/i);
 const key=randomUUID();
 const first=await guided.research(alice,target.id,{revision:1},key);
 assert.deepEqual(await guided.research(alice,target.id,{revision:1},key),first);
 assert.deepEqual(await guided.save(alice,target.id,{revision:1,brief,step:4}),saved,'An unchanged save must permit recovery after a lost submission response');
 assert.equal((await guided.read(alice,target.id)).research_job_id,first.id);
 await assert.rejects(guided.research(alice,target.id,{revision:1},randomUUID()),/already exists/);
 await assert.rejects(guided.save(alice,target.id,{revision:1,brief:{...brief,market:'Pune'}}),/still being checked/);
 const persisted=(await admin.query('SELECT research_context FROM app.intake_requests WHERE job_id=$1',[first.id])).rows[0];
 assert.deepEqual(persisted.research_context,brief);
 const facts=(await admin.query('SELECT count(*)::int AS n FROM app.brand_findings WHERE brand_id=$1',[target.id])).rows[0];
 assert.equal(facts.n,0,'Research never silently approves or inserts business claims');
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[first.id]);
 const second=await guided.research(alice,target.id,{revision:1},randomUUID());
 assert.notEqual(second.id,first.id);
 const sources=(await admin.query("SELECT count(*)::int AS n FROM app.brand_sources WHERE brand_id=$1 AND parser_version='business-research-v1'",[target.id])).rows[0];
 assert.equal(sources.n,1,'Retry reuses brief evidence');
});

test('website failure can explicitly continue from saved answers without bypassing active or uncertain capture',async()=>{
 const organization=await workspaces.create(alice,{name:'Website recovery fixture'});
 const target=await workspaces.createBrand(alice,organization.id,{name:'Unavailable site',website:'https://example.com'},randomUUID());
 await guided.save(alice,target.id,{revision:0,brief});
 await assert.rejects(guided.research(alice,target.id,{revision:1,use_saved_answers:true},randomUUID()),/Submit your brief/);
 const capture=await guided.research(alice,target.id,{revision:1},randomUUID());
 assert.equal((await guided.read(alice,target.id)).can_use_saved_answers,false);
 await assert.rejects(guided.research(alice,target.id,{revision:1,use_saved_answers:true},randomUUID()),/confirmed website capture failure/);
 await admin.query("UPDATE app.jobs SET status='unknown' WHERE id=$1",[capture.id]);
 await assert.rejects(guided.research(alice,target.id,{revision:1,use_saved_answers:true},randomUUID()),/confirmed website capture failure/);
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[capture.id]);
 assert.equal((await guided.read(alice,target.id)).can_use_saved_answers,false,'Wait until the dependent analysis has stopped');
 await assert.rejects(guided.research(alice,target.id,{revision:1,use_saved_answers:true},randomUUID()),/confirmed website capture failure/);
 const child=(await admin.query('SELECT analysis_job_id FROM app.intake_dependencies WHERE capture_job_id=$1',[capture.id])).rows[0].analysis_job_id;
 await new IntakeJobs(new AssetJobs(worker,null,null),new BrandAnalyzer()).run({organizationId:organization.id,brandId:target.id,jobId:child});
 assert.equal((await admin.query('SELECT status FROM app.jobs WHERE id=$1',[child])).rows[0].status,'canceled');
 assert.equal((await guided.read(alice,target.id)).can_use_saved_answers,true);
 const key=randomUUID(),analysis=await guided.research(alice,target.id,{revision:1,use_saved_answers:true},key);
 assert.deepEqual(await guided.research(alice,target.id,{revision:1,use_saved_answers:true},key),analysis);
 const request=(await admin.query('SELECT j.kind,r.website_url,r.research_context FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.id=$1',[analysis.id])).rows[0];
 assert.equal(request.kind,'brand.analyze');assert.equal(request.website_url,null);assert.deepEqual(request.research_context,brief);
 assert.equal((await guided.read(alice,target.id)).can_use_saved_answers,false);
 assert.equal((await businesses.resolve(alice,target.id)).has_approved_brand,false);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.intake_requests WHERE brand_id=$1',[target.id])).rows[0].n,3);
});

test('revised research excludes archived questionnaire answers while preserving their history (MOCK OpenAI)',async()=>{
 const target=await workspaces.createBrand(alice,organization.id,{name:'Revised cafe'},randomUUID());
 const oldBrief={...brief,audience:'Previous audience',market:'Previous market'};
 await guided.save(alice,target.id,{revision:0,brief:oldBrief});
 const oldJob=await guided.research(alice,target.id,{revision:1},randomUUID());
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[oldJob.id]);
 await guided.save(alice,target.id,{revision:1,brief});
 const job=await guided.research(alice,target.id,{revision:2},randomUUID());
 const otherSource=randomUUID();
 await admin.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,'manual',$4,'manual-note-v1','{}')",[otherSource,organization.id,target.id,'a'.repeat(64)]);
 await admin.query("INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,'note','Independent cafe evidence')",[randomUUID(),organization.id,target.id,otherSource]);
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',1000000,1,1,'LOCAL TEST ONLY',true)",[organization.id,target.id]);
 let received;
 const analyzer=new BrandAnalyzer(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(_,init)=>{
  received=JSON.parse(JSON.parse(init.body).input);
  const direction={summary:'A family cafe',rationale:'Proposed warm creative direction',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Welcoming',imagery:'Real food',pillars:['Local stories','Everyday rituals'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Three scenes: arrival, a coffee close-up, and a shared table.'}],essential_questions:[],evidence_ids:[received.chunks[0].id]};
  return Response.json({object:'response',id:'resp_mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[],recommendation:null,missing:[],business_direction:direction}),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
 }}));
 await new IntakeJobs(new AssetJobs(worker,null,null),analyzer).run({organizationId:organization.id,brandId:target.id,jobId:job.id});
 assert.equal((await guided.read(alice,target.id)).status,'succeeded');
 assert.deepEqual(received.guided_brief,brief);
 assert.equal(received.chunks.length,2);
 assert.ok(received.chunks.some(c=>c.text==='Independent cafe evidence'));
 assert.equal(JSON.parse(received.chunks.find(c=>c.source_id!==otherSource).text).audience,brief.audience);
 assert.doesNotMatch(JSON.stringify(received),/Previous audience|Previous market/);
 const history=await admin.query("SELECT c.text FROM app.brand_chunks c JOIN app.brand_sources s ON s.id=c.source_id WHERE s.brand_id=$1 AND s.parser_version='business-research-v1'",[target.id]);
 assert.equal(history.rowCount,2);
 assert.ok(history.rows.some(r=>JSON.parse(r.text).audience===oldBrief.audience));
});

test('dedicated research completes through the real durable worker and saves a proposed direction (MOCK OpenAI)',async()=>{
 const target=await workspaces.createBrand(alice,organization.id,{name:'Agent cafe'},randomUUID());
 await guided.save(alice,target.id,{revision:0,brief});
 const job=await guided.research(alice,target.id,{revision:1},randomUUID());
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',1000000,1,1,'LOCAL TEST ONLY',true)",[organization.id,target.id]);
 let calls=0;
 const analyzer=new BrandAnalyzer(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(_,init)=>{
  calls++;const body=JSON.parse(init.body),context=JSON.parse(body.input);assert.deepEqual(context.guided_brief,brief);
  const direction={summary:'A family cafe in Mumbai',rationale:'Proposed friendly creative direction',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Welcoming',imagery:'Real food in natural light',pillars:['Local stories','Everyday rituals'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Three scenes: arrival, a coffee close-up, and a shared table.'}],essential_questions:[],evidence_ids:[context.chunks[0].id]};
  return Response.json({object:'response',id:'resp_mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[],recommendation:null,missing:[],business_direction:direction}),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
 }}));
 const runner=new IntakeJobs(new AssetJobs(worker,null,null),analyzer);
 const scope={organizationId:organization.id,brandId:target.id,jobId:job.id};
 await runner.run(scope);await runner.run(scope);
 const saved=await guided.read(alice,target.id);
 const moved=await guided.save(alice,target.id,{revision:1,brief,step:3});assert.equal(moved.revision,2);
 const resumed=await guided.read(alice,target.id);assert.equal(resumed.step,3);assert.equal(resumed.research_job_id,job.id);
 assert.equal(saved.status,'succeeded');assert.equal(saved.result.business_direction.heading_font,'Lora');assert.equal(calls,1);
 assert.equal((await businesses.resolve(alice,target.id)).has_approved_brand,false);
 // A fresh customer can complete missing research facts through the same manual
 // endpoints used inline, then explicitly approve before preview generation.
 const freshBrain=new BrandBrain(database);
 const corrections=[['brand_name','Agent cafe'],['offering',brief.offering],['audience',brief.audience]];
 for(const [field,value] of corrections){const key=randomUUID();const added=await freshBrain.manual(alice,organization.id,target.id,{field,value},key);assert.deepEqual(await freshBrain.manual(alice,organization.id,target.id,{field,value},key),added);}
 assert.equal((await businesses.resolve(alice,target.id)).has_approved_brand,false);
 let review=await freshBrain.read(alice,organization.id,target.id);
 assert.equal(review.findings.length,3);assert.ok(review.findings.every(f=>f.status==='unreviewed'));
 for(const fact of review.findings)await freshBrain.review(alice,organization.id,target.id,fact.id,{revision:fact.revision,decision:'correct'});
 review=await freshBrain.read(alice,organization.id,target.id);await freshBrain.approve(alice,organization.id,target.id,{revision:review.revision});
 await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',10000000,0.01,0.02,100000,'LOCAL TEST ONLY',true)",[organization.id,target.id]);
 const previews=await boards.create(alice,target.id,{revision:2},randomUUID());
 assert.ok(previews.id);assert.equal((await boards.read(alice,target.id)).boards[0].status,'running');

});

import {BrandBrain} from '../../dist/brand-brain.js';
import {Canvas} from '../../dist/canvas.js';
import {CarouselGeneration} from '../../dist/carousel-generation.js';
import {GuidedMoodboards,moodboardStatus} from '../../dist/guided-moodboards.js';
const canvas=new Canvas(businesses,null),boards=new GuidedMoodboards(canvas,new CarouselGeneration(canvas,`sha256:${'0'.repeat(64)}`));
async function readyBusiness(existingOrg){
 const org=existingOrg??await workspaces.create(alice,{name:'Mood board fixture'});
 const brand=await workspaces.createBrand(alice,org.id,{name:'Cafe fixture'},randomUUID());
 const brain=new BrandBrain(database);
 for(const [field,value] of [['brand_name','Cafe fixture'],['offering','Fresh coffee'],['audience','Local families']])await brain.manual(alice,org.id,brand.id,{field,value},randomUUID());
 let state=await brain.read(alice,org.id,brand.id);
 for(const f of state.findings)await brain.review(alice,org.id,brand.id,f.id,{decision:'correct',revision:f.revision});
 state=await brain.read(alice,org.id,brand.id);await brain.approve(alice,org.id,brand.id,{revision:state.revision});
 const prefill=await guided.read(alice,brand.id);
 assert.equal(prefill.revision,0);assert.equal(prefill.brief.offering,'Fresh coffee');assert.equal(prefill.brief.audience,'Local families');
 await brain.manual(alice,org.id,brand.id,{field:'offering',value:'Unapproved new offering'},randomUUID());
 assert.equal((await guided.read(alice,brand.id)).brief.offering,'Fresh coffee','Unapproved findings cannot replace approved defaults');
 await guided.save(alice,brand.id,{revision:0,brief});
 const research=await guided.research(alice,brand.id,{revision:1},randomUUID());
 // Research output fixture only. Preview requests below go through real services and constraints.
 const direction={summary:'Family cafe',rationale:'Friendly',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#eeeeee'},{role:'accent',hex:'#cc6633'}],heading_font:'Lora',body_font:'DM Sans',voice:'Welcoming',imagery:'Fresh coffee',pillars:['Community','Coffee'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Three scenes: arrival, a coffee close-up, and a shared table.'}],essential_questions:[],evidence_ids:['fixture-evidence']};
 await admin.query("UPDATE app.jobs SET status='succeeded' WHERE id=$1",[research.id]);
 await admin.query('UPDATE app.intake_requests SET result=$2 WHERE job_id=$1',[research.id,{business_direction:direction}]);
 await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',10000000,0.01,0.02,100000,'LOCAL TEST ONLY',true)",[org.id,brand.id]);
 return {org,brand};
}
test('real mood board submission is atomic, idempotent and exempt from monthly content allowance',async()=>{
 const {org,brand}=await readyBusiness(),key=randomUUID();
 const first=await boards.create(alice,brand.id,{revision:1},key);
 assert.deepEqual(await boards.create(alice,brand.id,{revision:1},key),first);
 const state=await boards.read(alice,brand.id);
 const specs=(await admin.query('SELECT creative_spec FROM app.creative_requests WHERE brand_id=$1',[brand.id])).rows;assert.equal(specs.length,4);for(const r of specs){assert.equal(r.creative_spec.artwork.typography.headline.family,'Lora');assert.equal(r.creative_spec.artwork.typography.body.family,'DM Sans');}
 const imageRequest=(await admin.query('SELECT prompt FROM app.creative_requests WHERE job_id=$1',[state.boards[0].image_job_id])).rows[0];
 const carouselRequest=(await admin.query("SELECT input->>'prompt' AS prompt FROM app.carousel_requests WHERE job_id=$1",[state.boards[0].carousel_job_id])).rows[0];
 assert.match(imageRequest.prompt,/A place to meet/);assert.doesNotMatch(imageRequest.prompt,/An everyday ritual/);
 assert.match(carouselRequest.prompt,/An everyday ritual/);assert.doesNotMatch(carouselRequest.prompt,/A place to meet/);
 assert.equal(state.boards.length,1);assert.equal(state.boards[0].status,'running');
 assert.equal(state.allowance.items.static.used,0);assert.equal(state.allowance.items.carousel.used,0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.carousel_children WHERE parent_job_id=$1',[state.boards[0].carousel_job_id])).rows[0].n,3);
 await assert.rejects(boards.create(alice,brand.id,{revision:1},randomUUID()));
 await assert.rejects(boards.approve(alice,brand.id,first.id),/finish/);
 await assert.rejects(boards.read(bob,brand.id),/not found|access|Forbidden/i);
 await assert.rejects(guided.save(alice,brand.id,{revision:1,brief:{...brief,market:'London'}}),/mood board/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.content_allowance_reservations WHERE organization_id=$1',[org.id])).rows[0].n,0);
});
test('static allowance commits atomically and failed generations release the reservation',async()=>{
 const {org,brand}=await readyBusiness();
 await admin.query('INSERT INTO app.content_allowance_plans(organization_id,static_limit) VALUES($1,1)',[org.id]);
 const thread=await canvas.createThread(alice,brand.id,{title:'Allowance test'},randomUUID());
 const body={prompt:'A coffee cup',format:'static',channel:'instagram',size:'1024x1024'};
 const first=await canvas.submit(alice,brand.id,thread.id,body,randomUUID());
 await admin.query("UPDATE app.jobs SET status='succeeded' WHERE id=$1",[first.id]);
 await assert.rejects(canvas.submit(alice,brand.id,thread.id,body,randomUUID()),/monthly/i);
 assert.equal((await boards.read(alice,brand.id)).allowance.items.static.remaining,0);
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[first.id]);
 assert.equal((await boards.read(alice,brand.id)).allowance.items.static.remaining,1);
 await canvas.submit(alice,brand.id,thread.id,body,randomUUID());
 assert.equal((await boards.read(alice,brand.id)).allowance.items.static.used,1);
});
test('a failed sibling never makes an active or uncertain mood board safe to retry',()=>{
 assert.equal(moodboardStatus('failed','running',false),'running');
 assert.equal(moodboardStatus('succeeded','unknown',false),'unknown');
 assert.equal(moodboardStatus('succeeded','succeeded',false),'ready');
});

import {ContentPlan} from '../../dist/content-plan.js';
import {Planning} from '../../dist/planning.js';
import {SlotCreatives} from '../../dist/slot-creatives.js';
import {GuidedCampaigns} from '../../dist/guided-campaigns.js';
const plans=new ContentPlan(businesses),planning=new Planning(plans),campaigns=new GuidedCampaigns(planning,new SlotCreatives(plans,canvas,new CarouselGeneration(canvas,`sha256:${'0'.repeat(64)}`)),['instagram']);
async function completeBoardFixture(brand,org,board){
 const m=(await boards.read(alice,brand.id)).boards.find(b=>b.id===board.id);
 const request=(await admin.query('SELECT * FROM app.creative_requests WHERE job_id=$1',[m.image_job_id])).rows[0];
 const brain=(await admin.query('SELECT id FROM app.brand_brain_versions WHERE brand_id=$1',[brand.id])).rows[0].id;
 const media=randomUUID(),version=randomUUID(),carousel=randomUUID();
 await admin.query('INSERT INTO app.creative_media(id,organization_id,brand_id,job_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,1,1024,1024)',[media,org.id,brand.id,m.image_job_id,`FIXTURE-${media}`,'0'.repeat(64)]);
 await admin.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,brain_id,job_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[version,org.id,brand.id,request.project_id,brain,m.image_job_id,media,{schema_version:1,width:1024,height:1024,background_media_id:media,layers:[]},'FIXTURE ONLY',{},'0'.repeat(64),alice]);
 const c=(await admin.query('SELECT project_id FROM app.carousel_requests WHERE job_id=$1',[m.carousel_job_id])).rows[0];
 await admin.query("INSERT INTO app.carousel_versions(id,organization_id,brand_id,project_id,title,caption,channel,sha256,created_by,request_key,request_hash) VALUES($1,$2,$3,$4,'Fixture','Fixture','instagram',$5,$6,$7,$5)",[carousel,org.id,brand.id,c.project_id,'0'.repeat(64),alice,randomUUID()]);
 await admin.query('UPDATE app.creative_requests SET output_version_id=$2 WHERE job_id=$1',[m.image_job_id,version]);
 await admin.query('UPDATE app.carousel_requests SET output_version_id=$2 WHERE job_id=$1',[m.carousel_job_id,carousel]);
 await admin.query("UPDATE app.jobs SET status='succeeded' WHERE brand_id=$1",[brand.id]);
 return {version,carousel};
}
test('approval locks exact preview versions, then monthly planning retains all 30 posts across three formats',async()=>{
 const {org,brand}=await readyBusiness();
 const board=await boards.create(alice,brand.id,{revision:1},randomUUID());
 const outputs=await completeBoardFixture(brand,org,board);
 // Navigating the questions must not invalidate a generated direction.
 await guided.save(alice,brand.id,{revision:1,brief,step:3});
 await boards.approve(alice,brand.id,board.id);
 const saved=(await boards.read(alice,brand.id)).boards[0];
 assert.equal(saved.image_version_id,outputs.version);assert.equal(saved.carousel_version_id,outputs.carousel);
 assert.equal((await admin.query('SELECT status FROM app.carousel_versions WHERE id=$1',[outputs.carousel])).rows[0].status,'draft');
 await assert.rejects(boards.create(alice,brand.id,{revision:2,feedback:'Warmer'},randomUUID()),/locked/);
 const body={moodboard_id:board.id,starts_on:'2026-12-01',duration:'month',channels:['instagram'],static_count:20,carousel_count:5,video_count:5,timezone:'UTC'},key=randomUUID();
 const result=await campaigns.create(alice,brand.id,body,key);
 assert.deepEqual(await campaigns.create(alice,brand.id,body,key),result);
 const row=(await admin.query('SELECT r.input FROM app.guided_campaigns g JOIN app.planning_requests r ON r.job_id=g.planning_job_id WHERE g.id=$1',[result.id])).rows[0];
 assert.equal(row.input.post_count,30);assert.equal(row.input.content_mix.find(x=>x.format==='carousel').count,5);
 assert.match(row.input.campaign.theme,/Fresh coffee/);
 assert.equal(row.input.content_mix.find(x=>x.format==='video').count,5);
 assert.deepEqual(row.input.content_mix.find(x=>x.format==='video').creative_spec,{placement:'reel',aspect:'vertical',slide_count:null});
 for(const item of row.input.content_mix.filter(x=>x.format!=='video'))assert.equal(item.creative_spec.artwork.typography.headline.family,'Lora');
 await assert.rejects(campaigns.read(bob,brand.id),/not found|access|Forbidden/i);
});

test('approved monthly campaign queues 20 images and 5 carousels once and hands selected videos to generation while preserving the correct allowances',async()=>{
 const {org,brand}=await readyBusiness();
 const board=await boards.create(alice,brand.id,{revision:1},randomUUID());
 await completeBoardFixture(brand,org,board);await boards.approve(alice,brand.id,board.id);
 const campaign=await campaigns.create(alice,brand.id,{moodboard_id:board.id,starts_on:'2026-12-01',duration:'month',channels:['instagram'],static_count:20,carousel_count:5,video_count:5,timezone:'UTC'},randomUUID());
 const slots=Array.from({length:30},(_,i)=>({channel:'instagram',planned_at:`2026-12-${String(i+1).padStart(2,'0')}T09:00:00Z`,format:i<20?'static':i<25?'carousel':'video',brief:'Fresh coffee and community',creative_spec:{placement:'feed',aspect:'square',slide_count:i>=20&&i<25?3:null}}));
 const plan=await plans.create(alice,brand.id,{title:'Monthly fixture',objective:'Community',starts_on:'2026-12-01',timezone:'UTC',slots},randomUUID());
 const {planning_job_id}= (await admin.query('SELECT planning_job_id FROM app.guided_campaigns WHERE id=$1',[campaign.id])).rows[0];
 await admin.query('UPDATE app.planning_requests SET output_plan_id=$2 WHERE job_id=$1',[planning_job_id,plan.id]);
 await admin.query("UPDATE app.jobs SET status='succeeded' WHERE id=$1",[planning_job_id]);
 await campaigns.advance(alice,brand.id,campaign.id);
 assert.equal((await boards.read(alice,brand.id)).allowance.items.static.used,0);
 const reviewed=(await campaigns.read(alice,brand.id)).campaigns[0].slots.map(({id,revision})=>({id,revision}));
 await assert.rejects(campaigns.approvePlan(bob,brand.id,campaign.id,{slots:reviewed}),/not found|access|Forbidden/i);
 await assert.rejects(campaigns.approvePlan(alice,brand.id,campaign.id,{slots:reviewed.slice(1)}),/plan changed/);
 await campaigns.approvePlan(alice,brand.id,campaign.id,{slots:reviewed});
 await admin.query('UPDATE app.guided_campaigns SET generation_request=$2 WHERE id=$1',[campaign.id,JSON.stringify({slots:reviewed,automatic:true,credit_cap:100})]);
 await admin.query('UPDATE app.content_slots SET revision=revision+1 WHERE id=$1',[reviewed[0].id]);
 await campaigns.advance(alice,brand.id,campaign.id);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].plan_approved_at,null);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_request,null,'Discard an unsubmitted stale request so reapproval can recover');
 assert.equal((await boards.read(alice,brand.id)).allowance.items.static.used,0);
 reviewed[0].revision++;
 const videoSlot=(await admin.query("SELECT id FROM app.content_slots WHERE plan_id=$1 AND format='video' ORDER BY id LIMIT 1",[plan.id])).rows[0].id;
 await admin.query('UPDATE app.content_slots SET video_draft=$2 WHERE id=$1',[videoSlot,JSON.stringify({storyline:'A welcoming morning at the cafe',script:'Find your morning ritual here.',prompt:'Slow camera push toward the coffee counter in warm natural light.',duration_seconds:5})]);
 const asset=randomUUID(),uploadJob=randomUUID(),visual=randomUUID(),reference=randomUUID(),sha='a'.repeat(64),key=`TEST/${brand.id}/${visual}`;
 await admin.query("INSERT INTO app.assets(id,organization_id,brand_id,created_by,filename,content_type,expected_bytes,sha256,quarantine_key,canonical_key,state) VALUES($1,$2,$3,$4,'TEST.jpg','image/jpeg',100,$5,$6,$7,'ready')",[asset,org.id,brand.id,alice,sha,key+'-quarantine',key]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind,status) VALUES($1,$2,$3,$4,$5,'asset.validate','succeeded')",[uploadJob,org.id,brand.id,asset,alice]);
 await admin.query('INSERT INTO app.uploaded_visuals(id,organization_id,brand_id,asset_id,job_id,object_key,sha256,source_sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$7,100,600,400)',[visual,org.id,brand.id,asset,uploadJob,key,sha]);
 await admin.query("INSERT INTO app.brand_references(id,organization_id,brand_id,uploaded_visual_id,label,approved_by) VALUES($1,$2,$3,$4,'Calendar video source',$5)",[reference,org.id,brand.id,visual,alice]);
 const videoReferences=[{id:videoSlot,reference:{brand_reference_id:reference,source_sha256:sha,confirmed:true}}];
 await assert.rejects(campaigns.approvePlan(alice,brand.id,campaign.id,{slots:reviewed,video_references:[{...videoReferences[0],reference:{...videoReferences[0].reference,confirmed:false}}]}),/starting image/);
 await campaigns.approvePlan(alice,brand.id,campaign.id,{slots:reviewed,video_references:videoReferences});

 await campaigns.advance(alice,brand.id,campaign.id);
 // Simulate a lost completion update after the batch committed. Replaying must not charge twice.
 await admin.query('UPDATE app.guided_campaigns SET generation_started_at=NULL WHERE id=$1',[campaign.id]);
 await campaigns.advance(alice,brand.id,campaign.id);
 const counts=(await boards.read(alice,brand.id)).allowance;
 assert.equal(counts.items.static.used,20);assert.equal(counts.items.carousel.used,5);assert.equal(counts.items.video.used,0);
 const jobs=(await admin.query('SELECT job_ids FROM app.campaign_image_batches WHERE plan_id=$1',[plan.id])).rows;
 assert.equal(jobs.length,1);assert.equal(jobs[0].job_ids.length,25);
 const held=(await admin.query("SELECT i.state FROM app.campaign_batch_items i JOIN app.campaign_image_batches b ON b.request_key=i.request_key AND b.brand_id=i.brand_id WHERE b.plan_id=$1 AND i.format='video'",[plan.id])).rows;
 assert.equal(held.length,5);assert.ok(held.every(row=>row.state==='awaiting_approval'));
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_started_at!=null,true);
 // A recovered attempt should show live progress, not an earlier failure banner.
 const imageBindings=(await admin.query('SELECT * FROM app.content_slot_generations WHERE job_id=ANY($1::uuid[]) ORDER BY job_id',[jobs[0].job_ids])).rows;
 assert.equal(imageBindings.length,20,'All static jobs have a calendar binding');
 const binding=imageBindings[0],imageJob=binding.job_id;
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[imageJob]);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,true);
 const originalBinding=imageBindings[1],replacement=originalBinding.job_id;
 await admin.query("UPDATE app.jobs SET created_at=now()+interval '1 second' WHERE id=$1",[replacement]);
 await admin.query('UPDATE app.content_slot_generations SET slot_id=$2,source_revision=$3 WHERE job_id=$1',[replacement,binding.slot_id,binding.source_revision]);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,false);
 await admin.query("UPDATE app.jobs SET status='unknown' WHERE id=$1",[imageJob]);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,true,'Uncertain charges must remain visible even with another attempt');
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[imageJob]);
 await admin.query('UPDATE app.content_slot_generations SET slot_id=$2,source_revision=$3 WHERE job_id=$1',[replacement,originalBinding.slot_id,originalBinding.source_revision]);

 assert.ok((await app.query('SELECT * FROM app.pending_monthly_videos()')).rows.some(r=>r.id===campaign.id),'The durable scanner finds approved video work');
 const handoff=new GuidedVideos(new VideoCanvas(canvas,new VideoReferenceBindings(canvas,`sha256:${'0'.repeat(64)}`),true));
 await admin.query('UPDATE app.brand_references SET revoked_at=now() WHERE id=$1',[reference]);
 await handoff.advance(alice,brand.id,campaign.id);
 assert.match((await campaigns.read(alice,brand.id)).campaigns[0].video_error,/approved/);
 assert.equal((await admin.query('SELECT 1 FROM app.video_requests WHERE slot_id=$1',[videoSlot])).rowCount,0,'Revoked reference never queues a video');
 await admin.query('UPDATE app.brand_references SET revoked_at=NULL WHERE id=$1',[reference]);
 await campaigns.retry(alice,brand.id,campaign.id);
 await handoff.advance(alice,brand.id,campaign.id);
 await handoff.advance(alice,brand.id,campaign.id);
 const videoJobs=(await admin.query('SELECT r.*,j.status FROM app.video_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.slot_id=$1',[videoSlot])).rows;
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].video_error,null);
 assert.equal(videoJobs.length,1,'The selected calendar video is durably queued exactly once');
 assert.match(videoJobs[0].prompt,/Fresh coffee and community/);
 assert.match(videoJobs[0].prompt,/A welcoming morning at the cafe/);
 assert.match(videoJobs[0].prompt,/Find your morning ritual here/);
 assert.match(videoJobs[0].prompt,/Slow camera push toward the coffee counter/);
 assert.ok(!(await app.query('SELECT * FROM app.pending_monthly_videos()')).rows.some(r=>r.id===campaign.id),'Queued videos leave the submission scanner');
 assert.equal(videoJobs[0].status,'queued');assert.equal(videoJobs[0].generation_authorized_by,alice);
 // Video failures must surface on the same monthly dashboard as image failures.
 await admin.query("UPDATE app.jobs SET status='queued' WHERE id=$1",[imageJob]);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,false);
 for(const status of ['rejected','failed','unknown','canceled']){
  await admin.query('UPDATE app.jobs SET status=$2 WHERE id=$1',[videoJobs[0].job_id,status]);
  assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,true,`Monthly video ${status} needs attention`);
 }
 await admin.query("UPDATE app.jobs SET status='queued' WHERE id=$1",[videoJobs[0].job_id]);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].generation_attention,false);

 assert.equal((await admin.query('SELECT source_sha256 FROM app.video_references WHERE job_id=$1',[videoJobs[0].job_id])).rows[0].source_sha256,sha);

});

test('one successful feedback revision is allowed, technical failures do not consume it',async()=>{
 const {org,brand}=await readyBusiness();
 const first=await boards.create(alice,brand.id,{revision:1},randomUUID());
 await completeBoardFixture(brand,org,first);
 const style={palette:[{role:'primary',hex:'#112233'},{role:'secondary',hex:'#eeeeee'},{role:'accent',hex:'#cc6633'}],heading_font:'Playfair Display',body_font:'DM Sans'};
 await assert.rejects(boards.create(alice,brand.id,{revision:1,feedback:'More natural daylight',style:{...style,heading_font:'Unknown font'}},randomUUID()),/valid colours/);
 const failed=await boards.create(alice,brand.id,{revision:1,feedback:'More natural daylight',style},randomUUID());
 await admin.query("UPDATE app.jobs SET status='failed' WHERE brand_id=$1 AND status IN ('queued','running','retrying')",[brand.id]);
 const revised=await boards.create(alice,brand.id,{revision:1,feedback:'More natural daylight'},randomUUID());
 const revisedBoard=(await boards.read(alice,brand.id)).boards.find(b=>b.id===revised.id);
 assert.deepEqual(revisedBoard.direction.palette,style.palette);assert.equal(revisedBoard.direction.heading_font,style.heading_font);
 await completeBoardFixture(brand,org,revised);
 // Complete helper marks all jobs succeeded, restore the failed attempt explicitly.
 const prior=(await boards.read(alice,brand.id)).boards.find(b=>b.id===failed.id);
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=ANY($1::uuid[])",[[prior.image_job_id,prior.carousel_job_id]]);
 await assert.rejects(boards.create(alice,brand.id,{revision:1,feedback:'Third version'},randomUUID()),/revision|two|limit/i);
 await boards.approve(alice,brand.id,first.id);
 assert.equal((await boards.read(alice,brand.id)).boards.find(b=>b.id===first.id).status,'locked');
});


test('failed campaign planning retries the saved request without creating a second campaign',async()=>{
 const {org,brand}=await readyBusiness();
 const board=await boards.create(alice,brand.id,{revision:1},randomUUID());
 await completeBoardFixture(brand,org,board);await boards.approve(alice,brand.id,board.id);
 const body={moodboard_id:board.id,starts_on:'2026-12-01',duration:'week',channels:['instagram'],static_count:2,carousel_count:1,timezone:'UTC'};
 const campaign=await campaigns.create(alice,brand.id,body,randomUUID());
 await assert.rejects(campaigns.create(alice,brand.id,body,randomUUID()),/already being prepared/);
 const original=(await campaigns.read(alice,brand.id)).campaigns[0];
 await admin.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[original.planning_job_id]);
 await campaigns.retry(alice,brand.id,campaign.id);
 const retried=(await campaigns.read(alice,brand.id)).campaigns[0];
 assert.notEqual(retried.planning_job_id,original.planning_job_id);
 assert.deepEqual(retried.planning_request,original.planning_request);
 await campaigns.retry(alice,brand.id,campaign.id);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns[0].planning_job_id,retried.planning_job_id);
 await admin.query("UPDATE app.jobs SET status='unknown' WHERE id=$1",[retried.planning_job_id]);
 await assert.rejects(campaigns.retry(alice,brand.id,campaign.id),/checking/);
 assert.equal((await campaigns.read(alice,brand.id)).campaigns.length,1);
 assert.equal((await guided.read(alice,brand.id)).answers_locked,true);
});


test('monthly allowance is shared across brands, concurrency-safe, and resets by UTC month',async()=>{
 const first=await readyBusiness(),second=await readyBusiness(first.org);
 await admin.query('INSERT INTO app.content_allowance_plans(organization_id,static_limit) VALUES($1,1)',[first.org.id]);
 const threads=await Promise.all([first,second].map(({brand})=>canvas.createThread(alice,brand.id,{title:'Shared allowance'},randomUUID())));
 const body={prompt:'Coffee in natural light',format:'static',channel:'instagram',size:'1024x1024'};
 const results=await Promise.allSettled([first,second].map(({brand},i)=>canvas.submit(alice,brand.id,threads[i].id,body,randomUUID())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/monthly/i);
 assert.equal((await boards.read(alice,first.brand.id)).allowance.items.static.used,1);
 assert.equal((await boards.read(alice,second.brand.id)).allowance.items.static.used,1);
 await admin.query("UPDATE app.content_allowance_reservations SET month_start=(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '1 month')::date WHERE organization_id=$1",[first.org.id]);
 assert.equal((await boards.read(alice,first.brand.id)).allowance.items.static.remaining,1);
 const index=results.findIndex(r=>r.status==='rejected'),target=[first,second][index];
 await canvas.submit(alice,target.brand.id,threads[index].id,body,randomUUID());
 assert.equal((await boards.read(alice,target.brand.id)).allowance.items.static.used,1);
});

test('one-profile onboarding persists across reads, rejects disabled platforms and stays tenant scoped',async()=>{
 const org=await workspaces.create(alice,{name:'Profile onboarding'});
 const target=await workspaces.createBrand(alice,org.id,{name:'Profile cafe'},randomUUID());
 const service=new GuidedBusiness(businesses,new Intake(businesses),['instagram']);
 const details={business_name:'Profile cafe',website:'',business_type:'services',industry:'food',cta:'',differentiator:'',timing:'',competitors:[],priority_offers:'',folder_url:'',guidelines:'',references:[],social_profile:{platform:'instagram',handle:'@profilecafe'}};
 await service.save(alice,target.id,{revision:0,brief:{...brief,details},step:1});
 const saved=await service.read(alice,target.id);
 assert.deepEqual(saved.brief.details.social_profile,details.social_profile);
 assert.deepEqual(saved.onboarding,{social_profile_limit:1,channels:['instagram']});
 await assert.rejects(service.save(alice,target.id,{revision:1,brief:{...brief,details:{...details,social_profile:{platform:'facebook',handle:''}}}}),/not available/);
 assert.equal((await service.read(alice,target.id)).revision,1);
 await assert.rejects(service.read(bob,target.id),/not found|access|Forbidden/i);
 const disabled=new GuidedBusiness(businesses,new Intake(businesses),[]);
 await disabled.save(alice,target.id,{revision:1,brief:saved.brief,step:2});
 assert.equal((await disabled.read(alice,target.id)).step,2,'A saved platform becoming unavailable does not prevent resume');
 await disabled.save(alice,target.id,{revision:2,brief:{...brief,details:{...details,social_profile:{platform:'help',handle:''}}}});
 assert.equal((await disabled.read(alice,target.id)).brief.details.social_profile.platform,'help');
});

test('researched audience and competitor suggestions reach the questionnaire and survive an edited answer (MOCK OpenAI)',async()=>{
 const account=await workspaces.create(alice,{name:'Suggestions account'});
 const target=await workspaces.createBrand(alice,account.id,{name:'Suggestion cafe'},randomUUID());
 const empty=await guided.read(alice,target.id);assert.deepEqual(empty.suggestions,{audience:[],competitors:[]});
 await guided.save(alice,target.id,{revision:0,brief});
 const job=await guided.research(alice,target.id,{revision:1},randomUUID());
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',1000000,1,1,'LOCAL TEST ONLY',true)",[account.id,target.id]);
 const audiences=['Parents near Bandra planning a relaxed weekend brunch','Remote workers who want a calm table before noon','Families booking small birthday meals'];
 const analyzer=new BrandAnalyzer(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(_,init)=>{
  const context=JSON.parse(JSON.parse(init.body).input);
  const direction={summary:'A family cafe in Mumbai',rationale:'Proposed friendly creative direction',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Welcoming',imagery:'Real food in natural light',pillars:['Local stories','Everyday rituals'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Three scenes: arrival, a coffee close-up, and a shared table.'}],essential_questions:[],evidence_ids:[context.chunks[0].id],audience_suggestions:audiences,competitor_gaps:[]};
  return Response.json({object:'response',id:'resp_mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({findings:[],recommendation:null,missing:[],business_direction:direction}),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
 }}));
 assert.equal(await new IntakeJobs(new AssetJobs(worker,null,null),analyzer).run({organizationId:account.id,brandId:target.id,jobId:job.id}),'succeeded');
 // A finished capture with market research, as the worker saves it. Stored output is
 // display data only, so anything malformed is dropped when read.
 const capture=randomUUID();
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'website.extract','succeeded')",[capture,account.id,target.id,alice]);
 await admin.query('INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,website_url,result) VALUES($1,$2,$3,$4,$5,$6,$7)',[capture,account.id,target.id,randomUUID(),'a'.repeat(64),'https://example.org/',JSON.stringify({market:{status:'completed',discovered_competitors:[{name:'Third Table',url:'https://third-table.test/'},{name:'Bad link',url:'javascript:alert(1)'}]}})]);
 const researched=await guided.read(alice,target.id);
 assert.deepEqual(researched.suggestions,{audience:audiences,competitors:[{name:'Third Table',url:'https://third-table.test/'}]});
 // Choosing a suggestion changes the brief, which detaches it from the finished research.
 const edited=await guided.save(alice,target.id,{revision:1,brief:{...brief,audience:audiences[0]}});assert.equal(edited.brief.audience,audiences[0]);
 const after=await guided.read(alice,target.id);
 assert.equal(after.research_job_id,null);assert.equal(after.result,null);assert.deepEqual(after.suggestions,researched.suggestions);
 await assert.rejects(guided.read(bob,target.id));
});
