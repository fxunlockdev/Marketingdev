import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SkillRuntime} from '../../dist/skill-runtime.js';
import {generatedPlan} from '../fixtures/planning.mjs';
const image=process.env.SKILL_RUNTIME_IMAGE;
test('actual isolated planner preserves approved mood board typography for static and carousel slots (MOCK model)',{skip:!image},async()=>{
 const artwork={text:'headline',typography:{headline:{family:'Playfair Display',weight:400},body:{family:'DM Sans',weight:400}}};
 const input={task:'content_plan',brand:{id:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),facts:[{id:'22222222-2222-4222-8222-222222222222',field:'offering',value:'Coffee'}]},preferences:{goal:'awareness',timezone:'UTC',cadence:3,channels:['instagram'],must_avoid:'',starts_on:'2026-12-01',revision:1},brief:'Create a cafe campaign',post_count:2,video_count:0,duration_days:7,content_mix:['static','carousel'].map(format=>({channel:'instagram',format,count:1,creative_spec:{placement:'feed',aspect:'square',slide_count:format==='carousel'?3:null,artwork}}))};
 let calls=0;const runtime=new SkillRuntime(image);const result=await runtime.contentPlan(input,async request=>{calls++;assert.deepEqual(request.content_plan_schema.$defs.factId.enum,input.brand.facts.map(f=>f.id));assert.ok(request.messages.some(m=>m.content.includes('Preserve artwork')));return {content:JSON.stringify(generatedPlan(input)),tool_calls:[]};});
 assert.equal(calls,1);assert.equal(result.plan.slots.length,2);for(const slot of result.plan.slots)assert.deepEqual(slot.creative_spec.artwork,artwork);
 const bad=structuredClone(input);bad.content_mix[0].creative_spec.artwork.typography.headline.url='https://example.com/font';
 await assert.rejects(runtime.contentPlan(bad,async()=>{throw Error('Invalid input must not reach model');}),/SKILL_INPUT_INVALID/);
});
