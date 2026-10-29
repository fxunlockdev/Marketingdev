import test from 'node:test';
import assert from 'node:assert/strict';
import {ContentPlan} from '../../dist/content-plan.js';
const brand='11111111-1111-4111-8111-111111111111',plan='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333';
const body={format:'static',brief:'A calm modern home',context:'Use a blue sky and no people',channel:'instagram',planned_at:'2026-10-28T12:30:00Z',creative_spec:{placement:'feed',aspect:'square',slide_count:null},reference_ids:[]};
function fixture({prior,referenceCount=0,found=true}={}){const queries=[];const service=new ContentPlan({});service.scope=async(u,b,w,fn)=>fn({query:async(sql,args)=>{queries.push({sql,args});if(sql.includes('SELECT id,request_hash'))return {rows:prior?[prior]:[]};if(sql.includes('SELECT starts_on'))return {rows:found?[{starts_on:'2026-10-28',timezone:'UTC',duration_days:7}]:[]};if(sql.includes('count(*)'))return {rows:[{n:0}]};if(sql.includes('SELECT id FROM app.brand_references'))return {rowCount:referenceCount};if(sql.includes('INSERT INTO app.content_slots'))return {rows:[{id:'new-slot',revision:1}]};return {rows:[]};}},{organization_id:'org'});return {service,queries};}
test('campaign post persists creative context for generation, scoped draft and history',async()=>{const {service,queries}=fixture();assert.deepEqual(await service.addPost(user,brand,plan,body,'new-post-123'),{id:'new-slot'});const insert=queries.find(q=>q.sql.includes('INSERT INTO app.content_slots'));assert.match(insert.args[7],/Additional creative direction: Use a blue sky and no people/);assert.match(insert.sql,/'content_needed'/);assert.equal(insert.args[2],brand);assert.equal(insert.args[3],plan);assert.ok(queries.some(q=>q.sql.includes('INSERT INTO app.content_slot_events')));});
test('campaign post rejects missing campaign and unavailable cross-brand references',async()=>{await assert.rejects(fixture({found:false}).service.addPost(user,brand,plan,body,'new-post-123'),/Content plan not found/);await assert.rejects(fixture().service.addPost(user,brand,plan,{...body,reference_ids:[user]},'new-post-123'),/no longer approved/);});
test('campaign post validates placement and coordinated carousel slide count',()=>{const {service}=fixture();assert.throws(()=>service.addPost(user,brand,plan,{...body,format:'carousel',creative_spec:{placement:'feed',aspect:'square',slide_count:1}},'new-post-123'),/compatible creative format/);assert.throws(()=>service.addPost(user,brand,plan,{...body,creative_spec:{placement:'reel',aspect:'vertical',slide_count:null}},'new-post-123'),/compatible creative format/);});
test('campaign idempotency never silently reuses a different request',async()=>{await assert.rejects(fixture({prior:{id:'old',request_hash:'different'}}).service.addPost(user,brand,plan,body,'new-post-123'),/another post/);});

test('Add Context reaches LLM image regeneration with original parent version and durable request',async()=>{
 const {SlotCreatives}=await import('../../dist/slot-creatives.js');
 const captured=[],slot={id:plan,plan_id:plan,format:'static',channel:'instagram',revision:2,state:'draft_ready',brief:body.brief+'\n\nAdditional creative direction: '+body.context,creative_version_id:user,reference_ids:[]};
 const db={query:async(sql,args)=>{captured.push({sql,args});if(sql.startsWith('SELECT * FROM app.content_slots'))return {rows:[slot]};if(sql.startsWith('SELECT strategy'))return {rows:[{strategy:{campaign:{name:'Summer homes',theme:'Quiet coastal living',cta:'Explore the collection'}}}]};if(sql.startsWith('SELECT p.thread_id'))return {rows:[{thread_id:brand,width:1024,height:1024}]};if(sql.startsWith('UPDATE app.content_slots'))return {rows:[{...slot,revision:3}]};return {rows:[]};}};
 let submitted;const plans={scope:async(u,b,w,fn)=>fn(db,{organization_id:'org'}),event:async()=>{}};
 const canvas={submit:async(u,b,t,prompt)=>{submitted=prompt;return {id:'job',status:'queued'};}};
 await new SlotCreatives(plans,canvas).generate(user,brand,plan,{revision:2,feedback:'Change the sky to sunset; preserve the building'},'context-test-123');
 assert.equal(submitted.parent_version_id,user);
 assert.match(submitted.prompt,/Quiet coastal living/);
 assert.match(submitted.prompt,/Explore the collection/);
 assert.match(submitted.prompt,/Use a blue sky and no people/);
 assert.match(submitted.prompt,/"user_feedback":"Change the sky to sunset; preserve the building"/);
 assert.ok(captured.some(q=>q.sql.startsWith('INSERT INTO app.content_slot_generations')&&q.args[5]==='Change the sky to sunset; preserve the building'));
});


test('new posts retain per-post typography in the stored generation specification',async()=>{
 const {service,queries}=fixture();const artwork={text:'headline',typography:{headline:{family:'Playfair Display',weight:600},body:{family:'Montserrat',weight:500}}};
 await service.addPost(user,brand,plan,{...body,creative_spec:{...body.creative_spec,artwork}},'post-artwork-123');
 const insert=queries.find(q=>q.sql.includes('INSERT INTO app.content_slots'));
 assert.deepEqual(JSON.parse(insert.args[8]).artwork,artwork);
});
