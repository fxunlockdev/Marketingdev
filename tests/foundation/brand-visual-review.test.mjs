import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {BrandBrain,canonicalJSON,hash} from '../../dist/brand-brain.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),app=new Pool({connectionString:config.appDatabaseUrl}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl});
const database=new TenantDatabase(app),workspaces=new Workspaces(database),brain=new BrandBrain(database);
const owner=randomUUID(),outsider=randomUUID(),viewer=randomUUID();let org,brand,other;
before(async()=>{
 for(const id of [owner,outsider,viewer])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)',[id,`${id}@example.test`]);
 org=await workspaces.create(owner,{name:'Visual review fixtures'});
 brand=await workspaces.createBrand(owner,org.id,{name:'Visual business'},randomUUID());
 other=await workspaces.createBrand(owner,org.id,{name:'Other business'},randomUUID());
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,active) VALUES($1,$2,'viewer',true)",[org.id,viewer]);
 for(const [field,value] of [['brand_name','Visual business'],['offering','Software'],['audience','Designers']]){
  const f=await brain.manual(owner,org.id,brand.id,{field,value},randomUUID());
  await brain.review(owner,org.id,brand.id,f.id,{revision:f.revision,decision:'correct'});
 }
});
after(async()=>{await Promise.all([admin.end(),app.end(),worker.end()]);});
const suggestion={category:'composition',observation:'TEST FIXTURE: a spacious layout.',creative_direction:'Use generous spacing.',image_ids:['fixture:overview']};
const manifest=[{id:'fixture:overview',visual_id:randomUUID(),source_id:randomUUID(),website_url:'https://example.org/',source_sha256:'a'.repeat(64),sha256:'b'.repeat(64),view:'overview',viewport:'desktop',width:1440,height:1000,crop:{x:0,y:0,width:1440,height:1000}}];
async function analysis(guidance=[suggestion]){
 const id=randomUUID();
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'brand.analyze','succeeded')",[id,org.id,brand.id,owner]);
 await admin.query("INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,result) VALUES($1,$2,$3,$4,'explicit-fixture',$5)",[id,org.id,brand.id,randomUUID(),JSON.stringify({visual_guidance:guidance,visual_manifest:manifest})]);
 await admin.query('UPDATE app.brand_review_state SET revision=revision+1 WHERE brand_id=$1',[brand.id]);
 return (await brain.read(owner,org.id,brand.id)).visuals;
}
const body=(d,decision='correct',value)=>({analysis_job_id:d.analysis_job_id,index:d.index,evidence_sha256:d.evidence_sha256,revision:d.review?.revision??0,decision,...(value!==undefined?{value}:{})});
const approve=async()=>brain.approve(owner,org.id,brand.id,{revision:(await brain.read(owner,org.id,brand.id)).revision});
test('visual review is mandatory when supplied; exact retries preserve revision; approval freezes source provenance and feeds existing planner facts',async()=>{
 const v=await analysis(),d=v.directions[0];
 await assert.rejects(approve(),/Review every visual/);
 const saved=await brain.reviewVisual(owner,org.id,brand.id,body(d));
 const r=(await brain.read(owner,org.id,brand.id)).revision;
 assert.deepEqual(await brain.reviewVisual(owner,org.id,brand.id,body(d)),saved);
 assert.equal((await brain.read(owner,org.id,brand.id)).revision,r);
 const approved=await approve(),f=approved.snapshot.facts.find(f=>f.field==='visual_direction_composition');
 assert.equal(f.value,suggestion.creative_direction);assert.equal(f.references[0].source_sha256,'a'.repeat(64));assert.equal(f.evidence_type,'approved_visual_direction');
 assert.equal(approved.sha256,hash(canonicalJSON(approved.snapshot)));
 const latest=(await brain.read(owner,org.id,brand.id)).visuals.directions[0];
 await brain.reviewVisual(owner,org.id,brand.id,body(latest,'edited','Use compact typography and wide margins.'));
 assert.equal((await brain.version(owner,org.id,brand.id,approved.id)).snapshot.facts.find(f=>f.field==='visual_direction_composition').value,suggestion.creative_direction);
 assert.equal((await approve()).snapshot.facts.find(f=>f.field==='visual_direction_composition').value,'Use compact typography and wide margins.');
});
test('concurrent first decisions serialize; conflicting stale edits fail; wrong directions never enter approved context',async()=>{
 const d=(await analysis()).directions[0];
 const results=await Promise.allSettled([brain.reviewVisual(owner,org.id,brand.id,body(d,'edited','Direction A')),brain.reviewVisual(owner,org.id,brand.id,body(d,'edited','Direction B'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const latest=(await brain.read(owner,org.id,brand.id)).visuals.directions[0];
 await brain.reviewVisual(owner,org.id,brand.id,body(latest,'wrong'));
 assert.ok(!(await approve()).snapshot.facts.some(f=>f.field.startsWith('visual_direction_')));
});
test('business, tenant, viewer and revoked access cannot read or change visual decisions',async()=>{
 const d=(await analysis()).directions[0];
 for(const user of [outsider,viewer])await assert.rejects(brain.reviewVisual(user,org.id,brand.id,body(d)));
 await assert.rejects(brain.reviewVisual(owner,org.id,other.id,body(d)),/not found/);
 await assert.rejects(brain.read(outsider,org.id,brand.id));
 assert.deepEqual((await brain.read(owner,org.id,other.id)).visuals.directions,[]);
 await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[org.id,owner]);
 try{await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,body(d)));}finally{await admin.query('UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2',[org.id,owner]);}
});
test('changed analysis or website capture invalidates prior decisions and approval until current evidence is reviewed',async()=>{
 const old=(await analysis()).directions[0];
 await brain.reviewVisual(owner,org.id,brand.id,body(old));
 const fresh=(await analysis([{...suggestion,creative_direction:'New direction'}])).directions[0];
 await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,body(old)),/not found/);
 await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,{...body(fresh),evidence_sha256:'0'.repeat(64)}),/evidence changed/);
 await assert.rejects(approve(),/Review every visual/);
 await brain.reviewVisual(owner,org.id,brand.id,body(fresh));
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status,created_at,updated_at) VALUES($1,$2,$3,$4,'website.extract','succeeded',now()+interval '1 second',now()+interval '1 second')",[randomUUID(),org.id,brand.id,owner]);
 await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,body(fresh)),/evidence changed/);
 await assert.rejects(approve(),/Website evidence changed/);
 // Keep following fixtures chronological without a wall-clock sleep.
 await admin.query("UPDATE app.jobs SET created_at=now()-interval '1 minute',updated_at=now()-interval '1 minute' WHERE brand_id=$1 AND kind='website.extract'",[brand.id]);
});
test('runtime roles cannot forge provenance, mutate evidence or write approvals from a worker',async()=>{
 const d=(await analysis()).directions[0];const saved=await brain.reviewVisual(owner,org.id,brand.id,body(d));
 await assert.rejects(database.transaction(owner,org.id,true,db=>db.query("UPDATE app.brand_visual_reviews SET suggestion='{}' WHERE id=$1",[saved.id]),brand.id),/permission denied/);
 await assert.rejects(database.transaction(owner,org.id,true,db=>db.query(`INSERT INTO app.brand_visual_reviews(id,organization_id,brand_id,analysis_job_id,suggestion_index,suggestion,manifest,status,value,reviewed_by) VALUES($1,$2,$3,$4,1,$5,$6,'correct','Forged',$7)`,[randomUUID(),org.id,brand.id,d.analysis_job_id,JSON.stringify({...suggestion,creative_direction:'Forged'}),JSON.stringify(manifest),owner]),brand.id),/row-level security/);
 await assert.rejects(worker.query('SELECT * FROM app.brand_visual_reviews'),/permission denied/);
});
test('invalid decisions and injected fields are rejected without altering saved review',async()=>{
 const d=(await analysis()).directions[0];
 for(const override of [{decision:'approve'},{value:'cannot override correct'},{decision:'edited',value:''},{decision:'edited',value:'x'.repeat(1501)},{revision:-1},{index:12},{manifest:[]},{evidence_sha256:'bad'}])await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,{...body(d),...override}));
 assert.equal((await brain.read(owner,org.id,brand.id)).visuals.directions[0].review,null);
});

test('empty or partial AI analysis cannot silently erase previously approved visual preferences',async()=>{
 let d=(await analysis()).directions[0];await brain.reviewVisual(owner,org.id,brand.id,body(d));await approve();
 let state=await analysis([]);assert.equal(state.retained[0].value,suggestion.creative_direction);
 assert.equal((await approve()).snapshot.facts.find(f=>f.field==='visual_direction_composition').value,suggestion.creative_direction);
 d=(await analysis([{...suggestion,category:'imagery',creative_direction:'Use original studio photographs.'}])).directions[0];
 await brain.reviewVisual(owner,org.id,brand.id,body(d));
 assert.equal((await approve()).snapshot.facts.filter(f=>f.evidence_type==='approved_visual_direction').length,2);
});

test('retained styles can be edited and removed without another model call; old approved snapshots remain intact',async()=>{
 let d=(await analysis()).directions[0];await brain.reviewVisual(owner,org.id,brand.id,body(d,'edited','Calm typography and generous spacing.'));const original=await approve();
 await analysis([]);
 let state=(await brain.read(owner,org.id,brand.id)).visuals;
 let retained=state.retained_directions.find(d=>d.suggestion.category==='composition');
 assert.equal(retained.approved_value,'Calm typography and generous spacing.');
 const edit=body(retained,'edited','Bold typography with generous spacing.');
 const saved=await brain.reviewVisual(owner,org.id,brand.id,edit);
 assert.deepEqual(await brain.reviewVisual(owner,org.id,brand.id,edit),saved);
 const revised=await approve();
 assert.equal(revised.snapshot.facts.find(f=>f.field==='visual_direction_composition').value,'Bold typography with generous spacing.');
 assert.equal((await brain.version(owner,org.id,brand.id,original.id)).snapshot.facts.find(f=>f.field==='visual_direction_composition').value,'Calm typography and generous spacing.');
 retained=(await brain.read(owner,org.id,brand.id)).visuals.retained_directions.find(d=>d.suggestion.category==='composition');
 await brain.reviewVisual(owner,org.id,brand.id,body(retained,'wrong'));
 assert.ok(!(await approve()).snapshot.facts.some(f=>f.field==='visual_direction_composition'));
 await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,body(retained,'edited','Bring it back')),/not found/);
});
test('a replacement analysis prevents a stale retained-style edit and business access is rechecked',async()=>{
 let d=(await analysis()).directions[0];await brain.reviewVisual(owner,org.id,brand.id,body(d));await approve();await analysis([]);
 const retained=(await brain.read(owner,org.id,brand.id)).visuals.retained_directions.find(d=>d.suggestion.category==='composition');
 await assert.rejects(brain.reviewVisual(viewer,org.id,brand.id,body(retained,'edited','Changed')));
 await assert.rejects(brain.reviewVisual(owner,org.id,other.id,body(retained,'edited','Changed')));
 await analysis([{...suggestion,creative_direction:'A replacement suggestion'}]);
 await assert.rejects(brain.reviewVisual(owner,org.id,brand.id,body(retained,'edited','Stale edit')),/not found/);
});
test('retained provenance must still match the immutable approved evidence digest',async()=>{
 const d=(await analysis()).directions[0];await brain.reviewVisual(owner,org.id,brand.id,body(d));await approve();await analysis([]);
 const retained=(await brain.read(owner,org.id,brand.id)).visuals.retained_directions.find(d=>d.suggestion.category==='composition');
 await admin.query("UPDATE app.brand_visual_reviews SET suggestion=jsonb_set(suggestion,'{observation}','\"Tampered fixture\"') WHERE id=$1",[retained.review.id]);
 try{await assert.rejects(brain.read(owner,org.id,brand.id),/could not be verified/);await assert.rejects(approve(),/could not be verified/);}
 finally{await admin.query('UPDATE app.brand_visual_reviews SET suggestion=$2 WHERE id=$1',[retained.review.id,JSON.stringify(retained.suggestion)]);}
});
