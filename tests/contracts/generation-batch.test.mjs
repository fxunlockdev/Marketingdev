import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scheduleBatch,allowanceShortfalls,allowanceMessage,slotProgress,nextPollDelay,GENERATION_LIMITS} from '../../dist/creative-budget.js';
import {directionPromptContext,approvedDirection} from '../../dist/monthly-plan-approval.js';
import {SlotCreatives} from '../../dist/slot-creatives.js';
import {GuidedCampaigns} from '../../dist/guided-campaigns.js';
import {GuidedVideos} from '../../dist/guided-videos.js';

const plan='11111111-1111-4111-8111-111111111111';
const ids=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const allowance=(staticLeft=20,carouselLeft=5)=>({period:'2026-11',items:{static:{limit:20,used:20-staticLeft,remaining:staticLeft},carousel:{limit:5,used:5-carouselLeft,remaining:carouselLeft},video:{limit:5,used:0,remaining:5}}});

test('a whole batch is reserved against one daily cap and overflow moves to following days',()=>{
 assert.equal(GENERATION_LIMITS.dailyImages,90);
 assert.deepEqual(scheduleBatch([{id:'a',images:1},{id:'b',images:3,exports:3}],{images:0}),[{id:'a',day:0},{id:'b',day:0}]);
 // 88 already made today: the static fits, the 3-slide carousel waits, a later static still fits today.
 assert.deepEqual(scheduleBatch([{id:'a',images:1},{id:'b',images:3,exports:3},{id:'c',images:1}],{images:88}),[{id:'a',day:0},{id:'b',day:1},{id:'c',day:0}]);
 assert.deepEqual(scheduleBatch([{id:'a',images:10,exports:10}],{images:0,exports:95}),[{id:'a',day:1}],'export capacity is part of the same reservation');
 const month=[...Array.from({length:20},(_,i)=>({id:`s${i}`,images:1})),...Array.from({length:5},(_,i)=>({id:`c${i}`,images:10,exports:10}))];
 assert.ok(scheduleBatch(month,{images:0}).every(p=>p.day===0),'a full monthly allowance fits in one day');
 const busy=scheduleBatch(month,{images:60});assert.equal(busy.filter(p=>p.day===0).length,21);assert.ok(busy.every(p=>p.day<=1));
 assert.deepEqual(scheduleBatch([{id:'v',images:0}],{images:90}),[{id:'v',day:0}],'posts without images never wait');
 assert.throws(()=>scheduleBatch([{id:'a',images:91}],{images:0}),/more images than one day allows/);
});

test('an exhausted monthly allowance is reported with exact counts before anything is queued',()=>{
 assert.deepEqual(allowanceShortfalls(allowance().items,{static:20,carousel:5}),[]);
 const short=allowanceShortfalls(allowance(3,0).items,{static:4,carousel:1,video:0});
 assert.deepEqual(short,[{kind:'static',requested:4,limit:20,used:17,remaining:3},{kind:'carousel',requested:1,limit:5,used:5,remaining:0}]);
 assert.equal(allowanceMessage(short),'This month’s allowance cannot cover this plan: 4 static posts requested, 3 of 20 left (17 used); 1 carousel requested, 0 of 5 left (5 used). Remove posts or wait for next month’s allowance.');
 assert.equal(allowanceMessage([]),null);assert.deepEqual(allowanceShortfalls(undefined,{static:99}),[]);
});

test('per-post progress comes from the saved job state and never invents a percentage',()=>{
 const states=Object.fromEntries(['scheduled','queued','running','retrying','succeeded','unknown','failed','rejected','canceled','awaiting_approval','needs_attachment','review_changed'].map(s=>[s,slotProgress({status:s})]));
 assert.deepEqual(Object.values(states).map(s=>s.state),['scheduled','queued','generating','checking','ready','waiting','failed','failed','failed','parked','attention','attention']);
 assert.ok(['queued','running','retrying'].every(s=>states[s].active)&&['scheduled','succeeded','unknown','failed','awaiting_approval'].every(s=>!states[s].active));
 assert.ok(['failed','rejected','canceled'].every(s=>states[s].retryable));
 assert.equal(states.unknown.retryable,false,'an uncertain provider outcome is never retried from the batch view');
 assert.equal(states.unknown.label,'Waiting on provider');
 assert.match(slotProgress({status:'failed',error_code:'CREATIVE_BUDGET_EXHAUSTED'}).reason,/generation budget/);
 assert.match(slotProgress({status:'failed',error_code:'SOMETHING_NEW'}).reason,/topic is saved/);
 assert.equal(slotProgress({status:undefined}),null);assert.equal(slotProgress(null),null);
 assert.ok(Object.values(states).every(s=>!/%/.test(`${s.label}${s.reason??''}`)));
});

test('polling backs off while nothing changes and stops when nothing is active',()=>{
 assert.equal(nextPollDelay(false,0),null);assert.equal(nextPollDelay(false,9),null);
 const delays=[0,1,2,3,4,5,50].map(n=>nextPollDelay(true,n));
 assert.deepEqual(delays,[3000,5000,8000,13000,20000,30000,30000]);
});

const source={moodboard:{palette:['#112233','#445566','#778899'],heading_font:'Fraunces',body_font:'Inter',voice:'Warm and direct '.repeat(20),imagery:'Daylight, real hands, close product detail. '.repeat(15),summary:'A neighbourhood cafe',feedback:'More everyday moments'},creative_brief:{markets:'Mumbai',direction:'Never use stock-looking smiles'}};
test('the approved mood board and creative brief are sized to fit and ranked below brand facts',()=>{
 const full=directionPromptContext(source,4000);
 assert.match(full.priority,/after approved brand facts/i);assert.deepEqual(full.mood_board.palette,source.moodboard.palette);
 assert.equal(full.mood_board.heading_font,'Fraunces');assert.equal(full.mood_board.customer_feedback,'More everyday moments');assert.equal(full.creative_brief.markets,'Mumbai');
 for(const room of [1000,500,260,200]){const block=directionPromptContext(source,room);assert.ok(block,`fits ${room}`);assert.ok(JSON.stringify(block).length<=room);assert.deepEqual(block.mood_board.palette,source.moodboard.palette);}
 assert.equal(directionPromptContext(source,40),undefined,'no room: the request continues without the block');
 assert.equal(directionPromptContext(null,4000),undefined);
 assert.equal(directionPromptContext({moodboard:null,creative_brief:{timing:'Weekday mornings'}},4000).creative_brief.timing,'Weekday mornings');
});

test('approved direction reads only the locked mood board and saved brief for that business',async()=>{
 const seen=[];const db={query:async(sql,args)=>{seen.push([sql,args]);if(sql.includes('app.guided_moodboards'))return {rows:[{direction:{palette:[{role:'primary',hex:'#112233'},{role:'secondary',hex:'not-a-colour'}],heading_font:'Fraunces',body_font:'Inter',voice:'Warm',imagery:'Daylight',summary:'Cafe'},feedback:'Brighter'}]};return {rows:[{creative_brief:{markets:'Mumbai',languages:''}}]};}};
 const found=await approvedDirection(db,'org','brand');
 assert.deepEqual(found.moodboard.palette,['#112233']);assert.equal(found.moodboard.feedback,'Brighter');assert.deepEqual(found.creative_brief,{markets:'Mumbai'});
 assert.match(seen[0][0],/approved_at IS NOT NULL/);assert.ok(seen.every(([,args])=>args[0]==='org'&&args[1]==='brand'));
 assert.equal(await approvedDirection({query:async()=>({rows:[]})},'org','brand'),null);
});

function staticFixture({direction=true,brief='Image topic'}={}){
 let prompt;const slot={id:ids[0],plan_id:plan,revision:1,format:'static',channel:'instagram',state:'content_needed',brief,pillar:'Community',hook:'Hello',cta:'Visit',reference_ids:[],creative_spec:null,creative_version_id:null};
 const db={query:async sql=>{
  if(sql.startsWith('SELECT * FROM app.content_slots'))return {rows:[slot]};
  if(sql.startsWith('UPDATE app.content_slots'))return {rows:[{...slot,revision:2}]};
  if(sql.includes('app.guided_moodboards')&&sql.includes('approved_at IS NOT NULL'))return {rows:direction?[{direction:{palette:source.moodboard.palette.map((hex,i)=>({role:['primary','secondary','accent'][i],hex})),heading_font:'Fraunces',body_font:'Inter',voice:'Warm and direct',imagery:'Daylight and real hands',summary:'Cafe'},feedback:'More everyday moments'}]:[]};
  if(sql.includes('app.business_onboarding'))return {rows:direction?[{creative_brief:{direction:'Never use stock-looking smiles'}}]:[]};
  return {rows:[]};}};
 const canvas={createThread:async()=>({id:'thread'}),submit:async(_u,_b,_t,body)=>{prompt=body.prompt;return {id:'job',status:'queued'};}};
 const svc=new SlotCreatives({scope:async(_u,_b,_w,fn)=>fn(db,{organization_id:'org'}),event:async()=>{}},canvas);
 return {svc,prompt:()=>prompt};
}
test('every static post prompt carries the approved mood board below brand facts',async()=>{
 const f=staticFixture();await f.svc.generate('user',plan,ids[0],{revision:1},'static-direction-key');
 const sent=JSON.parse(f.prompt().slice(f.prompt().indexOf('{')));
 assert.deepEqual(sent.approved_direction.mood_board.palette,source.moodboard.palette);assert.equal(sent.approved_direction.mood_board.heading_font,'Fraunces');
 assert.equal(sent.approved_direction.creative_brief.direction,'Never use stock-looking smiles');assert.match(sent.approved_direction.priority,/Brand facts win/);
 assert.match(f.prompt(),/^Create or revise this channel-specific draft using approved brand facts/,'brand facts stay the leading instruction');
 const none=staticFixture({direction:false});await none.svc.generate('user',plan,ids[0],{revision:1},'static-direction-key');
 assert.equal(JSON.parse(none.prompt().slice(none.prompt().indexOf('{'))).approved_direction,undefined);
 const long=staticFixture({brief:'B'.repeat(3300)});await long.svc.generate('user',plan,ids[0],{revision:1},'static-direction-key');
 assert.ok(long.prompt().length<=4000,'a long brief shrinks the direction instead of failing');
 assert.deepEqual(JSON.parse(long.prompt().slice(long.prompt().indexOf('{'))).approved_direction.mood_board.palette,source.moodboard.palette);
});

function batchFixture({attempts=[],used=0,quota=allowance(),formats=['static','static','carousel']}={}){
 const inserted={batches:[],items:[]},submitted=[];
 const saved=formats.map((format,i)=>({id:ids[i],plan_id:plan,revision:1,format,channel:'instagram',state:'content_needed',brief:'Topic',planned_at:`2026-12-0${i+1}T09:00:00Z`,reference_ids:[],creative_spec:{placement:'feed',aspect:'square',slide_count:format==='carousel'?3:null}}));
 const db={query:async(sql,args)=>{
  if(sql.includes('SELECT DISTINCT ON (slot_id)'))return {rows:attempts};
  if(sql.startsWith('SELECT * FROM app.content_slots'))return {rows:saved.filter(s=>args[3].includes(s.id))};
  if(sql.includes('app.content_allowances'))return {rows:[{value:quota}]};
  if(sql.includes('AS images'))return {rows:[{images:used,exports:0}]};
  if(sql.startsWith('INSERT INTO app.campaign_image_batches'))inserted.batches.push(args);
  if(sql.startsWith('INSERT INTO app.campaign_batch_items'))inserted.items.push(args);
  return {rows:[]};}};
 const carousels={submit:async(_u,_b,body)=>{submitted.push(body.slot_id);return {id:`job-${body.slot_id}`};}};
 const svc=new SlotCreatives({scope:async(_u,_b,_w,fn)=>fn(db,{organization_id:'org'})},{},carousels);
 svc.generationQuote=async()=>({available:true,slots:saved.map(s=>({id:s.id,revision:1,credits:s.format==='carousel'?16:5,...(s.format==='carousel'?{planning_credits:1}:{})}))});
 svc.generate=async(_u,_b,slot)=>{submitted.push(slot);return {id:`job-${slot}`};};
 const body=(extra={})=>({slots:saved.map(s=>({id:s.id,revision:1})),credit_cap:100,...extra});
 return {svc,inserted,submitted,body};
}
const itemState=row=>({slot:row[3],job:row[7],state:row[8],scheduled:row[9]});
test('work beyond today’s image capacity is scheduled instead of failing the whole batch',async()=>{
 const f=batchFixture({used:88});await f.svc.generateBatch('user',plan,plan,f.body(),'overflow-batch-key');
 assert.deepEqual(f.submitted,[ids[0],ids[1]],'two statics use the two remaining images');
 const items=f.inserted.items.map(itemState);
 assert.deepEqual(items.map(i=>i.state),['queued','queued','scheduled']);
 assert.equal(items[2].job,null);assert.ok(Date.parse(items[2].scheduled)>Date.now()+23*3600000,'the carousel waits for tomorrow’s capacity');
 assert.equal(f.inserted.batches.length,1);assert.deepEqual(f.inserted.batches[0][5],[`job-${ids[0]}`,`job-${ids[1]}`]);
 const full=batchFixture();await full.svc.generateBatch('user',plan,plan,full.body(),'overflow-batch-key');
 assert.ok(full.inserted.items.map(itemState).every(i=>i.state==='queued'&&i.scheduled===null));
});

test('an exhausted allowance stops the batch before any request with exact counts',async()=>{
 const f=batchFixture({quota:allowance(1,0)});
 await assert.rejects(f.svc.generateBatch('user',plan,plan,f.body(),'allowance-batch-key'),/2 static posts requested, 1 of 20 left \(19 used\); 1 carousel requested, 0 of 5 left \(5 used\)/);
 assert.equal(f.submitted.length,0);assert.equal(f.inserted.batches.length,0);
});

test('retry failed is explicit, limited to failed or stopped posts and never retries an uncertain request',async()=>{
 const attempt=status=>ids.map(id=>({slot_id:id,id:`old-${id}`,status}));
 for(const status of ['failed','canceled','rejected']){const f=batchFixture({attempts:attempt(status)});await f.svc.generateBatch('user',plan,plan,f.body({retry_failed:true}),'retry-batch-key');assert.equal(f.submitted.length,3,status);}
 for(const status of ['unknown','queued','running','retrying','succeeded','needs_attachment','scheduled']){const f=batchFixture({attempts:attempt(status)});await assert.rejects(f.svc.generateBatch('user',plan,plan,f.body({retry_failed:true}),'retry-batch-key'),status==='unknown'?/Stop waiting/:/Only posts whose last attempt failed/);assert.equal(f.submitted.length,0,status);}
 const never=batchFixture();await assert.rejects(never.svc.generateBatch('user',plan,plan,never.body({retry_failed:true}),'retry-batch-key'),/Only posts whose last attempt failed/);
 assert.throws(()=>batchFixture().svc.generateBatch('user',plan,plan,{slots:[{id:ids[0],revision:1}],credit_cap:5,automatic:true,retry_failed:true},'retry-batch-key'),/retry/i);
 assert.throws(()=>batchFixture().svc.generateBatch('user',plan,plan,{slots:[{id:ids[0],revision:1}],retry_failed:true},'retry-batch-key'),/credit cap/);
 // A post already waiting for a later day cannot be queued a second time by another request.
 const waiting=batchFixture({attempts:[{slot_id:ids[0],id:ids[0],status:'scheduled'}]});await assert.rejects(waiting.svc.generateBatch('user',plan,plan,waiting.body(),'second-batch-key'),/already scheduled or in progress/);
});

test('scheduled posts are released once their day arrives, with their approved budgets',async()=>{
 const f=batchFixture({attempts:ids.slice(0,2).map(id=>({slot_id:id,id,status:'scheduled'})),formats:['static','static']});
 const due=ids.slice(0,2).map(id=>({slot_id:id,source_revision:1,max_cost_micros:'70000',planning_cost_micros:null,request_key:'overflow-batch-key'}));
 let budgets=[];f.svc.generate=async(_u,_b,slot,body)=>{f.submitted.push(slot);budgets.push(body.max_cost_micros);return {id:`job-${slot}`};};
 const original=f.svc.plans.scope;f.svc.plans.scope=(u,b,w,fn)=>original(u,b,w,(db,scope)=>fn({query:async(sql,args)=>sql.includes("i.state='scheduled'")?{rows:due}:db.query(sql,args)},scope));
 const result=await f.svc.releaseScheduled('user',plan,plan);
 assert.equal(result.released,2);assert.deepEqual(f.submitted,ids.slice(0,2));assert.deepEqual(budgets,[70000,70000]);
 assert.match(f.inserted.batches[0][3],/^scheduled:[a-f0-9]{64}$/,'the release key is derived from the waiting items, so a repeat cannot double-submit');
 due.length=0;assert.deepEqual(await f.svc.releaseScheduled('user',plan,plan),{released:0});
});

test('videos are parked without an error until video generation is connected',async()=>{
 let scoped=0;const parked=new GuidedVideos({enabled:false,canvas:{scope:async()=>{scoped++;}},submit:async()=>{throw new Error('must not submit');}});
 await parked.advance('user','brand','campaign');assert.equal(scoped,0,'no request and no saved error while parked');
});

test('plan approval is refused with exact counts when the allowance cannot cover it',async()=>{
 const campaign='55555555-5555-4555-8555-555555555555',updates=[];
 const rows=[{id:ids[0],revision:1,format:'static'},{id:ids[1],revision:1,format:'carousel'},{id:ids[2],revision:1,format:'carousel'}];
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM app.guided_campaigns g JOIN app.planning_requests'))return {rows:[{id:campaign,output_plan_id:plan,generation_started_at:null}]};
  if(sql.startsWith('SELECT id,revision,format FROM app.content_slots'))return {rows};
  if(sql.includes('app.content_allowances'))return {rows:[{value:allowance(20,1)}]};
  if(sql.startsWith('UPDATE'))updates.push(args);
  return {rows:[]};}};
 const svc=new GuidedCampaigns({plans:{scope:async(_u,_b,_w,fn)=>fn(db,{organization_id:'org'})}},{},['instagram']);
 const slots=rows.map(({id,revision})=>({id,revision}));
 await assert.rejects(svc.approvePlan('user',plan,campaign,{slots}),/2 carousels requested, 1 of 5 left \(4 used\)/);assert.equal(updates.length,0);
});

test('the review screen never starts paid generation without a click',()=>{
 const images=readFileSync(new URL('../../apps/web/components/campaign-images.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(images,/autoAttempt|generate\(true\)/,'no effect may submit a generation request on load');
 const submits=[...images.matchAll(/void (generate|retryFailed)\(/g)].length,clicks=[...images.matchAll(/onClick=\{\(\)=>void (generate|retryFailed)\(/g)].length;
 assert.ok(clicks>=2&&submits===clicks,'every submission is wired to a button click');
});
