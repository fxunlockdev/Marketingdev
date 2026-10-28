import test from 'node:test';
import assert from 'node:assert/strict';
import {SlotCreatives} from '../../dist/slot-creatives.js';
import {canonicalJSON,hash} from '../../dist/brand-brain.js';
const id='11111111-1111-4111-8111-111111111111',slot='22222222-2222-4222-8222-222222222222';
const body={slots:[{id:slot,revision:1}],credit_cap:5,automatic:true};
function make({prior=false,attempts=[],format='static',budget=5}={}){let submissions=0;const db={query:async(sql,args)=>{
 if(sql.startsWith('SELECT request_hash'))return {rows:prior?[{request_hash:hash(canonicalJSON({planId:id,slots:body.slots,automatic:true,credit_cap:5}))}]:[]};
 if(sql.includes('SELECT DISTINCT ON (slot_id)'))return {rows:attempts};
 if(sql.startsWith('SELECT * FROM app.content_slots'))return {rows:[{id:slot,revision:1,format,channel:'instagram',state:'content_needed',brief:'Image topic',reference_ids:[],creative_spec:{placement:'feed',aspect:'square',slide_count:format==='carousel'?3:null}}]};
 return {rows:[]};}};const svc=new SlotCreatives({scope:async(u,b,w,fn)=>fn(db,{organization_id:'org'})},{});svc.generationQuote=async()=>({available:true,slots:[{id:slot,revision:1,credits:budget}]});svc.generate=async()=>{submissions++;return {id:'job'};};return {svc,count:()=>submissions};}
test('automatic image generation reuses persisted request across actors without another provider request',async()=>{const f=make({prior:true,attempts:[{slot_id:slot,id:'job',status:'running'}]});const result=await f.svc.generateBatch('another-user',id,id,body,'auto-test-key');assert.equal(result.jobs[0].id,'job');assert.equal(f.count(),0);});
test('automatic image generation blocks every previous attempt including failed and unknown',async()=>{for(const status of ['running','unknown','failed','succeeded','canceled']){const f=make({attempts:[{slot_id:slot,id:'old',status}]});await assert.rejects(f.svc.generateBatch('user',id,id,body,'different-key'),/already has a generation attempt/);assert.equal(f.count(),0);}});
test('automatic creation cannot bypass credit capacity or auto-start videos',async()=>{const f=make({budget:6});await assert.rejects(f.svc.generateBatch('user',id,id,body,'automatic-key'),/capacity of at least 6/);assert.equal(f.count(),0);await assert.rejects(make({format:'video'}).svc.generateBatch('user',id,id,body,'automatic-key'),/images and carousels only/);});
test('new missing image is queued once through existing durable generation service',async()=>{const f=make();await f.svc.generateBatch('user',id,id,body,'automatic-key');assert.equal(f.count(),1);});

test('automatic creation requires a quoted credit cap',()=>{const f=make();assert.throws(()=>f.svc.generateBatch('user',id,id,{slots:body.slots,automatic:true},'automatic-key'),/requires the current generation credit cap/);assert.equal(f.count(),0);});
