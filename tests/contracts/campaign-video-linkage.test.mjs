import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoCanvas} from '../../dist/video-canvas.js';
const id='11111111-1111-4111-8111-111111111111',slotId='22222222-2222-4222-8222-222222222222';
const spec={placement:'reel',aspect:'9:16'};
function service({linked=true,current=id,replay}={}) {
 const source={thread_id:id,channel:'instagram',duration_seconds:6,approved_brief:{video_prompt:'Warm campaign scene'},text_provider:'openai',slot_id:linked?slotId:null,creative_spec:spec,brand_reference_id:id,source_sha256:'abc'};
 const db={query:async sql=>({rows:sql.includes('FROM app.video_versions')?[{...source}]:sql.includes('request_key')?(replay?[replay]:[]):sql.includes('FROM app.content_slots')?[{revision:9,video_version_id:current,state:'draft'}]:[]})};
 const instance=new VideoCanvas({scope:async(_u,_b,_w,fn)=>fn(db,{organization_id:id})},{},true);
 let captured;instance.submit=async(...args)=>{captured=args;return {id,status:'queued'};};return {instance,get captured(){return captured;}};
}
test('campaign video regeneration retains slot, current revision, framing and user direction',async()=>{const s=service();await s.instance.regenerate(id,id,id,{feedback:'Slower camera movement'},'regen-1234');const body=s.captured[3];assert.equal(body.slot_id,slotId);assert.equal(body.slot_revision,9);assert.deepEqual(body.creative_spec,spec);assert.equal(body.parent_version_id,id);assert.match(body.prompt,/Slower camera movement/);assert.equal(body.reference.confirmed,true);});
test('regeneration replay uses its original slot revision after slot attachment advances',async()=>{const s=service({current:slotId,replay:{slot_revision:7,creative_spec:spec}});await s.instance.regenerate(id,id,id,{feedback:'Slower camera movement'},'regen-1234');assert.equal(s.captured[3].slot_revision,7);});
test('a superseded campaign video cannot silently replace the current slot video',async()=>{const s=service({current:slotId});await assert.rejects(s.instance.regenerate(id,id,id,{feedback:'Change it'},'regen-1234'),/current video/);assert.equal(s.captured,undefined);});
test('legacy unlinked video regeneration remains unlinked',async()=>{const s=service({linked:false});await s.instance.regenerate(id,id,id,{feedback:'Change it'},'regen-1234');assert.equal(s.captured[3].slot_id,undefined);assert.equal(s.captured[3].parent_version_id,id);});
test('actual queued video request persists campaign theme, CTA, visual design and user context',async()=>{
 let saved;
 const db={query:async(sql,args)=>{
  if(sql.includes('INSERT INTO app.video_requests'))saved=args;
  const rows=sql.includes('SELECT * FROM app.content_slots')?[{plan_id:id,format:'video',channel:'instagram',revision:1,state:'draft',creative_spec:null}]:sql.includes('SELECT strategy')?[{strategy:{campaign:{name:'Live well',theme:'Quiet luxury by the sea',cta:'Book a visit',design:{style:'editorial',font:'classic'}}}}]:sql.includes('FROM app.canvas_threads')?[{id}]:sql.includes('count(*)')?[{n:0}]:sql.includes('sum(bytes)')?[{n:0}]:sql.includes('FROM app.brand_brain_versions')?[{id}]:[];
  return {rows,rowCount:rows.length};
 }};
 const s=new VideoCanvas({scope:async(_u,_b,_w,fn)=>fn(db,{organization_id:id})},{image:'renderer',bind:async()=>{}},true);
 await s.submit(id,id,id,{slot_id:slotId,slot_revision:1,prompt:'Show the terrace in golden hour; slow pan.',channel:'instagram',duration_seconds:6,reference:{}},'submit-1234');
 assert.match(saved[5],/Quiet luxury by the sea/);assert.match(saved[5],/Book a visit/);assert.match(saved[5],/editorial magazine/);assert.match(saved[5],/golden hour; slow pan/);assert.equal(saved[10],slotId);
});
