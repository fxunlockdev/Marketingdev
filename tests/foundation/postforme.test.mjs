import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {SocialConnections} from '../../dist/social-connections.js';
import {Postforme} from '../../dist/postforme.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG),admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),pool=new Pool({connectionString:config.appDatabaseUrl}),database=new TenantDatabase(pool),workspaces=new Workspaces(database),businesses=new Businesses(database,workspaces),service=new Postforme(new SocialConnections(businesses,true),{},'mock-key');
const alice=randomUUID(),bob=randomUUID(),viewer=randomUUID(),session=randomUUID();let org,brand,foreign,attempt,binding;let calls=0;
before(async()=>{for(const user of [alice,bob,viewer])await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[user,'Postforme fixture',`${user}@example.test`]);org=await workspaces.create(alice,{name:'Postforme A'});const other=await workspaces.create(bob,{name:'Postforme B'});brand=await workspaces.createBrand(alice,org.id,{name:'Postforme brand'},randomUUID());foreign=await workspaces.createBrand(bob,other.id,{name:'Other brand'},randomUUID());await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",[org.id,viewer]);service.client={call:async(path,method,body)=>{calls++;if(path.includes('auth-url')){assert.deepEqual(body.permissions,['posts','feeds']);binding=body.external_id;return {url:'https://api.postforme.dev/oauth/mock'};}return {};},accounts:async external=>[{remote_id:'fixture-'+brand.id,external_id:external,platform:'instagram',username:'Fixture profile',profile_photo_url:null,status:'connected'}]};});
after(async()=>{await Promise.all([admin.end(),pool.end()]);});
test('Postforme ownership is enforced by genuine RLS and callback session binding',async()=>{assert.equal((await service.read(alice,brand.id)).accounts.length,0);await assert.rejects(service.authorize(viewer,session,brand.id,{platform:'instagram'}));await assert.rejects(service.read(bob,brand.id));attempt=await service.authorize(alice,session,brand.id,{platform:'instagram'});assert.ok(attempt.url);assert.ok(binding);const before=calls;await assert.rejects(service.finish(alice,randomUUID(),brand.id,{attempt_id:attempt.attempt_id}));assert.equal(calls,before);const finished=await service.finish(alice,session,brand.id,{attempt_id:attempt.attempt_id});assert.equal(finished.accounts.length,1);assert.equal(finished.accounts[0].status,'connected');assert.ok(!JSON.stringify(finished).includes(binding));assert.ok(!JSON.stringify(finished).includes('mock-key'));assert.equal((await service.read(bob,foreign.id)).accounts.length,0);assert.equal((await pool.query('SELECT * FROM app.postforme_accounts')).rowCount,0);const account=finished.accounts[0];await assert.rejects(service.disconnect(bob,foreign.id,account.id));await database.transaction(alice,org.id,false,async db=>{assert.equal((await db.query('SELECT count(*)::int n FROM app.postforme_accounts')).rows[0].n,1);},brand.id);});
test('Postforme foreign remote-account collision cannot overwrite existing tenant ownership',async()=>{const bAttempt=await service.authorize(bob,randomUUID(),foreign.id,{platform:'instagram'});assert.ok(bAttempt);await assert.rejects(service.refresh(bob,foreign.id),e=>e.getStatus?.()===409);const current=await service.read(alice,brand.id);assert.equal(current.accounts.length,1);});
test('Postforme disconnected accounts and expired attempts are honest persisted states',async()=>{await admin.query("UPDATE app.postforme_attempts SET expires_at=now()-interval '1 second' WHERE id=$1",[attempt.attempt_id]);await assert.rejects(service.finish(alice,session,brand.id,{attempt_id:attempt.attempt_id}));service.client.accounts=async()=>[];await service.refresh(alice,brand.id);assert.equal((await service.read(alice,brand.id)).accounts[0].status,'disconnected');});
test('Postforme unknown publication is durable, replays without a provider write and reconciles only matching identity',async()=>{const {canonicalJSON,hash}=await import('../../dist/brand-brain.js');const account=(await admin.query('SELECT id,remote_id FROM app.postforme_accounts WHERE brand_id=$1',[brand.id])).rows[0],plan=randomUUID(),slot=randomUUID(),publication=randomUUID(),requestKey=randomUUID(),at=new Date(Date.now()+3600000).toISOString();await admin.query("INSERT INTO app.content_plans(id,organization_id,brand_id,title,objective,starts_on,timezone,created_by,request_key,request_hash) VALUES($1,$2,$3,'Mock plan','Test','2026-10-28','UTC',$4,$5,$6)",[plan,org.id,brand.id,alice,randomUUID(),'a'.repeat(64)]);await admin.query("INSERT INTO app.content_slots(id,organization_id,brand_id,plan_id,channel,planned_at,format,brief,pillar,hook,cta,created_by) VALUES($1,$2,$3,$4,'instagram',$5,'static','Mock brief','','','',$6)",[slot,org.id,brand.id,plan,at,alice]);const body={slot_id:slot,revision:1,export_id:randomUUID(),channel_id:account.id,confirmed:true};await admin.query("INSERT INTO app.postforme_publications(id,organization_id,brand_id,account_id,slot_id,revision,request_key,request_hash,proof,caption,scheduled_at,phase) VALUES($1,$2,$3,$4,$5,1,$6,$7,'{}','Mock caption',$8,'unknown')",[publication,org.id,brand.id,account.id,slot,requestKey,hash(canonicalJSON({user:alice,body})),at]);service.publishing=true;const start=calls;assert.deepEqual(await service.submit(alice,brand.id,body,requestKey),{id:publication,phase:'unknown'});assert.equal(calls,start);await assert.rejects(service.submit(alice,brand.id,{...body,revision:2},requestKey));service.client.call=async path=>{calls++;if(path.includes('social-post-results'))return {data:[{post_id:'remote-post',social_account_id:account.remote_id,success:true,platform_data:{url:'https://instagram.com/p/mock'}}]};return {data:[{id:'remote-post',external_id:publication,caption:'Mock caption',scheduled_at:at,social_accounts:[{id:'foreign-account'}],status:'processed'}]};};await service.reconcile(alice,brand.id,publication);assert.equal((await admin.query('SELECT phase FROM app.postforme_publications WHERE id=$1',[publication])).rows[0].phase,'unknown');service.client.call=async path=>path.includes('social-post-results')?{data:[{post_id:'remote-post',social_account_id:account.remote_id,success:true,platform_data:{url:'https://instagram.com/p/mock'}}]}:{data:[{id:'remote-post',external_id:publication,caption:'Mock caption',scheduled_at:at,social_accounts:[{id:account.remote_id}],status:'processed'}]};assert.equal((await service.reconcile(alice,brand.id,publication)).observed_state,'published');await assert.rejects(service.reconcile(bob,foreign.id,publication));});

test('learning loop: scheduled collection snapshots published posts idempotently and insights read them under RLS',async()=>{
 const {collect,syncSnapshotSQL}=await import('../../dist/learning-sync.js'),{readPostformeObservations}=await import('../../dist/learning-observations.js'),{insightObservations}=await import('../../dist/insights.js');
 const dispatch=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl});
 const account=(await admin.query('SELECT id,remote_id FROM app.postforme_accounts WHERE brand_id=$1',[brand.id])).rows[0];
 await admin.query("UPDATE app.postforme_accounts SET status='connected' WHERE id=$1",[account.id]);
 try{
  const pub=(await admin.query("SELECT id,scheduled_at FROM app.postforme_publications WHERE brand_id=$1 AND observed_state='published'",[brand.id])).rows[0];
  const now=new Date(pub.scheduled_at.getTime()+2*3600000);let fetches=0;
  const client={call:async path=>{fetches++;assert.ok(path.startsWith('/v1/social-account-feeds/'+encodeURIComponent(account.remote_id)));return {data:[{social_account_id:account.remote_id,platform_post_id:'pp-1',platform:'instagram',caption:'Mock caption',posted_at:pub.scheduled_at.toISOString(),platform_url:'https://instagram.com/p/mock/',metrics:{likes:7,views:120}}]};}};
  assert.deepEqual(await collect({pool:dispatch,client,now}),{due:1,collected:1,missing:0,accounts:1,failed_accounts:0,rate_limited:false});
  assert.equal((await collect({pool:dispatch,client,now})).due,0);assert.equal(fetches,1);
  const row=[pub.id,org.id,brand.id,account.id,'1h','available','{"likes":999}',null,now.toISOString()];
  assert.equal((await dispatch.query(syncSnapshotSQL,row)).rowCount,0,'a checkpoint is written once');
  const foreignOrg=(await admin.query('SELECT organization_id FROM app.brands WHERE id=$1',[foreign.id])).rows[0].organization_id;
  await assert.rejects(dispatch.query(syncSnapshotSQL,[pub.id,foreignOrg,foreign.id,account.id,'24h','missing','{}',null,now.toISOString()]),e=>['42501','23503'].includes(e.code));
  await assert.rejects(dispatch.query('SELECT proof FROM app.postforme_publications'),e=>e.code==='42501');
  await assert.rejects(dispatch.query('SELECT username FROM app.postforme_accounts'),e=>e.code==='42501');
  assert.equal((await dispatch.query("SELECT count(*)::int n FROM app.postforme_publications WHERE phase NOT IN ('accepted','unknown')")).rows[0].n,0);
  await assert.rejects(database.transaction(alice,org.id,true,db=>db.query(syncSnapshotSQL,[pub.id,org.id,brand.id,account.id,'24h','missing','{}',null,now.toISOString()]),brand.id),e=>e.code==='42501');
  const seen=await database.transaction(alice,org.id,false,db=>readPostformeObservations(db),brand.id);
  assert.equal(seen.published,1);assert.equal(seen.observations.length,1);const [o]=seen.observations;
  assert.deepEqual(o.metrics,{likes:7,views:120});assert.equal(o.publication_id,pub.id);assert.equal(o.hours_since_publish,2);
  assert.equal(o.attribution.channel,'instagram');assert.equal(o.attribution.format,'static');assert.equal(o.attribution.timezone,'UTC');assert.ok(o.attribution.posted_weekday);assert.equal(o.attribution.stock_used,null);
  assert.equal((await database.transaction(alice,org.id,false,db=>insightObservations(db),brand.id)).source,'postforme');
  const other=await database.transaction(bob,foreignOrg,false,db=>insightObservations(db),foreign.id);
  assert.deepEqual(other,{source:'postforme',observations:[]},'another business sees neither the posts nor the snapshots');
 }finally{await admin.query("UPDATE app.postforme_accounts SET status='disconnected' WHERE id=$1",[account.id]);await dispatch.end();}
});

test('learning loop: customer signals are append-only, actor-bound and private to the business',async()=>{
 const {recordSignal,signalSummary}=await import('../../dist/learning-signals.js');
 const slot=(await admin.query('SELECT id FROM app.content_slots WHERE brand_id=$1 LIMIT 1',[brand.id])).rows[0].id,scope={organizationId:org.id,brandId:brand.id,actorId:alice};
 const write=(user,input,as=user)=>database.transaction(user,org.id,true,db=>recordSignal(db,{...scope,actorId:as},input),brand.id);
 for(const reason of ['Too many people','No faces please'])await write(alice,{kind:'rejected',slot_id:slot,reason,context:{format:'static'}});
 await write(alice,{kind:'edited',slot_id:slot,diff:{headline:{before:'A long headline',after:'Short'}}});
 await assert.rejects(write(viewer,{kind:'approved',slot_id:slot}));
 await assert.rejects(database.transaction(viewer,org.id,false,db=>recordSignal(db,{...scope,actorId:viewer},{kind:'approved',slot_id:slot}),brand.id),e=>['42501','25006'].includes(e.code),'the database itself refuses a read-only member');
 await assert.rejects(write(alice,{kind:'approved',slot_id:slot},bob),e=>e.code==='42501','a signal cannot be recorded as someone else');
 await assert.rejects(write(alice,{kind:'approved',slot_id:randomUUID()}),e=>e.code==='23503');
 const summary=await database.transaction(viewer,org.id,false,db=>signalSummary(db),brand.id);
 assert.deepEqual(summary.map(s=>s.statement),['Rejection reasons mention people: 2 of 2 rejections with a reason']);
 const foreignOrg=(await admin.query('SELECT organization_id FROM app.brands WHERE id=$1',[foreign.id])).rows[0].organization_id;
 assert.deepEqual(await database.transaction(bob,foreignOrg,false,db=>signalSummary(db),foreign.id),[]);
 await assert.rejects(database.transaction(bob,foreignOrg,true,db=>recordSignal(db,{organizationId:org.id,brandId:brand.id,actorId:bob},{kind:'approved',slot_id:slot}),foreign.id));
 for(const sql of ["UPDATE app.creative_signals SET reason='rewritten'",'DELETE FROM app.creative_signals'])await assert.rejects(database.transaction(alice,org.id,true,db=>db.query(sql),brand.id),e=>e.code==='42501');
 assert.equal((await admin.query('SELECT count(*)::int n FROM app.creative_signals WHERE brand_id=$1',[brand.id])).rows[0].n,3);
});

test('monthly review: owners accept recommendations for next month, planners receive them, members and other businesses cannot',async()=>{
 const {LearningReviews}=await import('../../dist/learning-review-api.js'),{planningLearning,learningSections}=await import('../../dist/learning-context.js');
 const reviews=new LearningReviews(businesses);
 const pub=(await admin.query("SELECT id,slot_id,scheduled_at FROM app.postforme_publications WHERE brand_id=$1 AND observed_state='published'",[brand.id])).rows[0];
 const month=pub.scheduled_at.toISOString().slice(0,7),review=await reviews.review(alice,brand.id,month);
 assert.ok(review.published.some(p=>p.publication_id===pub.id));assert.ok(review.proposed_changes.length>=3);assert.equal(review.can_accept,true);assert.deepEqual(review.accepted,[]);
 assert.ok(review.proposed_changes.every(c=>c.label&&Number.isInteger(c.sample_size)),'every recommendation carries its sample size and label');
 assert.equal((await reviews.review(viewer,brand.id,month)).can_accept,false);
 await assert.rejects(reviews.accept(viewer,brand.id,{month,changes:[0],confirmed:true}),e=>e.getStatus?.()===403);
 await assert.rejects(reviews.accept(alice,brand.id,{month,changes:[99],confirmed:true}),e=>e.getStatus?.()===400);
 await assert.rejects(reviews.accept(alice,brand.id,{month,changes:[0]}),e=>e.getStatus?.()===400);
 await assert.rejects(reviews.accept(bob,brand.id,{month,changes:[0],confirmed:true}));
 const after=await reviews.accept(alice,brand.id,{month,changes:[0,1],confirmed:true});
 const chosen=[review.proposed_changes[0].text,review.proposed_changes[1].text].sort();
 assert.deepEqual(after.accepted.map(a=>a.text).sort(),chosen);
 assert.equal((await reviews.accept(alice,brand.id,{month,changes:[0],confirmed:true})).accepted.length,2,'accepting the same recommendation again is a no-op');
 const context=await database.transaction(alice,org.id,false,db=>planningLearning(db),brand.id);
 assert.deepEqual(learningSections(context).accepted.map(a=>a.text).sort(),chosen,'the next planning request carries what the owner accepted');
 await assert.rejects(database.transaction(alice,org.id,true,db=>db.query("UPDATE app.learning_accepted_changes SET text='rewritten'"),brand.id),e=>e.code==='42501');
 await assert.rejects(reviews.withdraw(viewer,brand.id,after.accepted[0].id),e=>e.getStatus?.()===403);
 await reviews.withdraw(alice,brand.id,after.accepted[0].id);
 assert.equal(learningSections(await database.transaction(alice,org.id,false,db=>planningLearning(db),brand.id)).accepted.length,1);
 const foreignOrg=(await admin.query('SELECT organization_id FROM app.brands WHERE id=$1',[foreign.id])).rows[0].organization_id;
 assert.deepEqual(learningSections(await database.transaction(bob,foreignOrg,false,db=>planningLearning(db),foreign.id)).accepted,[]);
 const trends=await reviews.trends(alice,brand.id);
 assert.ok(trends.published>=1&&trends.measured>=1);assert.ok(trends.groups.some(g=>g.dimension==='format'&&g.value==='static'&&g.measured>=1));assert.match(trends.label,/^unproven/);assert.ok(trends.as_of);
 const drawer=await service.slot(viewer,brand.id,pub.slot_id);
 assert.equal(drawer.publications[0].id,pub.id);assert.deepEqual(drawer.metrics.metrics,{likes:7,views:120});assert.equal(drawer.metrics.semantics,'lifetime');assert.ok(drawer.metrics.as_of);
 const unpublished=(await admin.query("SELECT slot_id FROM app.postforme_publications WHERE brand_id=$1 AND observed_state<>'published' LIMIT 1",[brand.id])).rows[0];
 if(unpublished)assert.equal((await service.slot(alice,brand.id,unpublished.slot_id)).metrics,null,'no reading means no metrics, never zeros');
 await assert.rejects(service.slot(bob,brand.id,pub.slot_id));
});

test('disabled platforms cannot initiate OAuth and existing records remain accessible',async()=>{
 const limited=new Postforme(service.connections,{},'mock-key',false,['instagram','tiktok']);
 let invoked=false;limited.client={call:async()=>{invoked=true;throw Error('must not call');}};
 const view=await limited.read(alice,brand.id);assert.deepEqual(view.platforms,['instagram','tiktok']);assert.ok(view.accounts.length);
 for(const platform of ['youtube','threads','twitter','pinterest'])await assert.rejects(limited.authorize(alice,session,brand.id,{platform}),e=>e.getStatus?.()===400);
 assert.equal(invoked,false);
});

test('Postforme publication holds protect calendar edits, review, archive and brand removal',async()=>{
 const {ContentPlan}=await import('../../dist/content-plan.js'),plans=new ContentPlan(businesses);
 const account=(await admin.query('SELECT id FROM app.postforme_accounts WHERE brand_id=$1',[brand.id])).rows[0];
 const plan=await plans.create(alice,brand.id,{title:'Publication hold',objective:'Keep remote schedules visible',starts_on:'2027-01-01',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'Approved fixture',planned_at:'2027-01-02T09:00:00Z'}]},randomUUID());
 const slot=(await admin.query('SELECT * FROM app.content_slots WHERE plan_id=$1',[plan.id])).rows[0],publication=randomUUID();
 await admin.query("INSERT INTO app.postforme_publications(id,organization_id,brand_id,account_id,slot_id,revision,request_key,request_hash,proof,caption,scheduled_at,phase) VALUES($1,$2,$3,$4,$5,1,$6,$7,'{}','Fixture',now()+interval '1 day','preparing')",[publication,org.id,brand.id,account.id,slot.id,randomUUID(),'b'.repeat(64)]);
 const before=await plans.history(alice,brand.id,slot.id);
 for(const phase of ['preparing','submitting','accepted','unknown']){
  await admin.query('UPDATE app.postforme_publications SET phase=$2 WHERE id=$1',[publication,phase]);
  await assert.rejects(plans.edit(alice,brand.id,slot.id,{revision:1,brief:'Changed',reset_approval:true}),/publication/);
  for(const decision of ['reopen','cancelled'])await assert.rejects(plans.review(alice,brand.id,slot.id,{revision:1,decision}),/publication/);
  await assert.rejects(database.transaction(alice,org.id,true,db=>db.query("UPDATE app.content_slots SET state='pending_review',approved_by=NULL,approved_at=NULL,revision=revision+1 WHERE id=$1",[slot.id]),brand.id),/publication/);
  await assert.rejects(businesses.remove(alice,brand.id,{organization_id:org.id,name:brand.name,revision:1}),/publications/);
 }
 assert.deepEqual(await plans.history(alice,brand.id,slot.id),before);
 // Legacy canceled slots must not be restored while a remote outcome is unresolved.
 await admin.query("UPDATE app.content_slots SET state='cancelled',approved_by=NULL,approved_at=NULL WHERE id=$1",[slot.id]);
 await assert.rejects(plans.restore(alice,brand.id,slot.id,{revision:1}),/publication/);
 await admin.query("UPDATE app.postforme_publications SET phase='rejected' WHERE id=$1",[publication]);
 const restored=await plans.restore(alice,brand.id,slot.id,{revision:1});assert.equal(restored.state,'content_needed');
 const deleted=await businesses.remove(alice,brand.id,{organization_id:org.id,name:brand.name,revision:1});assert.equal(deleted.removed,true);
 await assert.rejects(admin.query("INSERT INTO app.postforme_publications(id,organization_id,brand_id,account_id,slot_id,revision,request_key,request_hash,proof,caption,scheduled_at,phase) VALUES($1,$2,$3,$4,$5,2,$6,$7,'{}','Fixture',now()+interval '1 day','preparing')",[randomUUID(),org.id,brand.id,account.id,slot.id,randomUUID(),'c'.repeat(64)]),/BUSINESS_REMOVED/);
});


test('one-profile plan serializes platform attempts and rejects excess provider accounts without losing saved connections',async()=>{
 const user=randomUUID(),sid=randomUUID();await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[user,'Profile quota',`${user}@example.test`]);
 const workspace=await workspaces.create(user,{name:'Profile quota'}),business=await workspaces.createBrand(user,workspace.id,{name:'One profile'},randomUUID());
 const subject=new Postforme(service.connections,{},'mock-key');let writes=0,results=[];
 subject.client={call:async()=>{writes++;return {url:'https://api.postforme.dev/oauth/mock'};},accounts:async()=>results};
 const attempts=await Promise.allSettled(['instagram','facebook'].map(platform=>subject.authorize(user,sid,business.id,{platform})));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(writes,1);
 let active=(await subject.read(user,business.id,sid)).attempt;
 await assert.rejects(subject.cancelAttempt(user,randomUUID(),business.id,{attempt_id:active.id}),/not found/);
 await subject.cancelAttempt(user,sid,business.id,{attempt_id:active.id});
 assert.equal((await subject.read(user,business.id,sid)).attempt,null);
 await assert.rejects(subject.finish(user,sid,business.id,{attempt_id:active.id}),/expired/);
 await subject.authorize(user,sid,business.id,{platform:active.platform});
 active=(await subject.read(user,business.id,sid)).attempt;
 const record=id=>({remote_id:id,platform:active.platform,username:id,profile_photo_url:null,status:'connected'});
 results=[record('quota-one'),record('quota-two')];
 await assert.rejects(subject.finish(user,sid,business.id,{attempt_id:active.id}),/one social profile/);
 assert.equal((await subject.read(user,business.id)).accounts.length,0);
 results=[record('quota-one')];await subject.finish(user,sid,business.id,{attempt_id:active.id});
 const saved=await subject.read(user,business.id);assert.equal(saved.social_profile_limit,1);assert.equal(saved.accounts.length,1);
 await assert.rejects(subject.authorize(user,sid,business.id,{platform:active.platform==='instagram'?'facebook':'instagram'}),/one social profile/);assert.equal(writes,2);
 results.push(record('quota-two'));await assert.rejects(subject.refresh(user,business.id),/one social profile/);
 assert.deepEqual((await subject.read(user,business.id)).accounts,saved.accounts);
 // Reauthorizing the same profile still works, and replacing it is possible after provider removal.
 await subject.authorize(user,sid,business.id,{platform:active.platform});results=[record('quota-one')];await subject.refresh(user,business.id);
 results=[record('quota-two')];await subject.refresh(user,business.id);
 assert.equal((await subject.read(user,business.id)).accounts.filter(a=>a.status==='connected').length,1);
 await assert.rejects(subject.refresh(bob,business.id));
});

test('Home counts are scoped to one business and agree with the upcoming list beside them',async()=>{
 const {BusinessOverview}=await import('../../dist/business-overview.js'),{ContentPlan}=await import('../../dist/content-plan.js');
 const overview=new BusinessOverview(businesses),plans=new ContentPlan(businesses);
 // Fresh businesses: earlier cases remove the shared fixture brand.
 const home=await workspaces.createBrand(alice,org.id,{name:'Home brand'},randomUUID()),sibling=await workspaces.createBrand(alice,org.id,{name:'Sibling brand'},randomUUID());
 await admin.query("INSERT INTO app.postforme_bindings(organization_id,brand_id,platform) VALUES($1,$2,'instagram')",[org.id,home.id]);
 const account=(await admin.query("INSERT INTO app.postforme_accounts(organization_id,brand_id,platform,remote_id,username,status) VALUES($1,$2,'instagram',$3,'home','connected') RETURNING id",[org.id,home.id,`home-${randomUUID()}`])).rows[0];
 const before=(await overview.read(alice,home.id)).counts;
 const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const plan=await plans.create(alice,home.id,{title:'Home counts',objective:'Counts match the list',starts_on:day(1),timezone:'UTC',slots:[1,2,3].map(n=>({channel:'instagram',format:'static',brief:`Home slot ${n}`,planned_at:`${day(n)}T09:00:00Z`}))},randomUUID());
 const slots=(await admin.query('SELECT id FROM app.content_slots WHERE plan_id=$1 ORDER BY planned_at',[plan.id])).rows.map(r=>r.id);
 const publish=(slot,observed)=>admin.query("INSERT INTO app.postforme_publications(id,organization_id,brand_id,account_id,slot_id,revision,request_key,request_hash,proof,caption,scheduled_at,phase,observed_state) VALUES($1,$2,$3,$4,$5,1,$6,$7,'{}','Home fixture',now()+interval '1 day','accepted',$8)",[randomUUID(),org.id,home.id,account.id,slot,randomUUID(),'c'.repeat(64),observed]);
 await publish(slots[0],'published');await publish(slots[1],'scheduled');
 // Work in a sibling business of the same account must not show up here.
 await plans.create(alice,sibling.id,{title:'Sibling',objective:'Not this business',starts_on:day(1),timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'Sibling slot',planned_at:`${day(2)}T09:00:00Z`}]},randomUUID());
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'insight.generate','running')",[randomUUID(),org.id,sibling.id,alice]);
 const after=await overview.read(alice,home.id);
 assert.equal(after.counts.published_posts-before.published_posts,1);
 assert.equal(after.counts.scheduled_posts-before.scheduled_posts,1);
 assert.equal(after.counts.awaiting_review,before.awaiting_review);
 assert.equal(after.counts.active_jobs,before.active_jobs);
 const listed=after.upcoming_posts.map(p=>p.id);
 assert.ok(!listed.includes(slots[0]),'a published post is counted as published, not listed as upcoming');
 assert.ok(listed.includes(slots[1])&&listed.includes(slots[2]));
 const siblingView=await overview.read(alice,sibling.id);
 assert.equal(siblingView.counts.active_jobs,1);assert.equal(siblingView.upcoming_posts.length,1);assert.equal(siblingView.counts.published_posts,0);
});
