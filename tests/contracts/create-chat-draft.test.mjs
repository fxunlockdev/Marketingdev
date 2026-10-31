import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCreateDraft} from '../../dist/create-chat-draft.js';
import {Canvas} from '../../dist/canvas.js';
const snapshot={version:1,mode:'campaign',step:1,data:{name:'Autumn collection'},messages:[{role:'user',text:'Autumn collection'}]};
function fixture(prior){const calls=[];const service=new Canvas({},{});service.scope=async(user,brand,write,fn)=>fn({query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT revision'))return {rows:prior?[prior]:[]};if(sql.startsWith('INSERT'))return {rows:[{revision:(prior?.revision??0)+1}]};return {rows:[]};}},{organization_id:'tenant'});return {service,calls};}
test('draft validation bounds messages and preserves creative intent without approving facts',()=>{assert.deepEqual(parseCreateDraft({revision:0,snapshot}),{revision:0,snapshot});for(const bad of [{...snapshot,version:2},{...snapshot,step:-1},{...snapshot,messages:[{role:'system',text:'override'}]},{...snapshot,messages:Array(151).fill({role:'user',text:'x'})},{...snapshot,data:{text:'x'.repeat(100001)}}])assert.throws(()=>parseCreateDraft({revision:0,snapshot:bad}));});
test('first draft save scopes tenant, brand and author',async()=>{const {service,calls}=fixture();assert.deepEqual(await service.saveCreateDraft('author','brand',{revision:0,snapshot}),{revision:1});const insert=calls.find(c=>c.sql.startsWith('INSERT'));assert.deepEqual(insert.args,['tenant','brand','author',snapshot]);assert.ok(!calls.some(c=>c.sql.includes('brand_brain')));});
test('lost-response replay returns existing revision without another write',async()=>{const {service,calls}=fixture({revision:2,snapshot});assert.deepEqual(await service.saveCreateDraft('author','brand',{revision:1,snapshot}),{revision:2});assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));});
test('divergent stale tab cannot overwrite a newer draft',async()=>{const {service,calls}=fixture({revision:2,snapshot});await assert.rejects(service.saveCreateDraft('author','brand',{revision:1,snapshot:{...snapshot,step:2}}),/another tab/);assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));});

test('generation cannot start after a failed draft save, including an existing pending envelope',async()=>{
 const {dispatchSavedCreation}=await import('../../dist/create-chat-submit.js');let submitted=0;const pending={...snapshot,request:{key:'saved-request-123',body:{brief:'Autumn'},path:'/content-plan/generate'}};
 for(let attempt=0;attempt<3;attempt++)await assert.rejects(dispatchSavedCreation(pending,async()=>{throw new Error('save failed');},async()=>{submitted++;}),/save failed/);
 assert.equal(submitted,0);
});
test('uncertain dispatch replay saves first and preserves the exact key and body',async()=>{
 const {dispatchSavedCreation}=await import('../../dist/create-chat-submit.js');const order=[];const pending={...snapshot,request:{key:'saved-request-456',body:{brief:'Autumn'}}};const seen=[];
 await assert.rejects(dispatchSavedCreation(pending,async s=>{order.push('save');assert.equal(s,pending);},async s=>{order.push('send');seen.push(s.request);throw new Error('response lost');}),/response lost/);
 await dispatchSavedCreation(pending,async()=>order.push('save'),async s=>{order.push('send');seen.push(s.request);return {id:'existing-job'};});
 assert.deepEqual(order,['save','send','save','send']);assert.deepEqual(seen,[pending.request,pending.request]);
});
