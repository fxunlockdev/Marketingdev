import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {validateGeneratedPlan,validatePlanningResult,PLANNING_SKILLS} from '../../dist/planning-contracts.js';
import {generatedPlan,modelResponse} from '../fixtures/planning.mjs';
const input={task:'content_plan',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['linkedin','instagram'],must_avoid:'Unsupported claims',revision:1},brief:'Brand-specific plan',post_count:30};
const message={type:'model',step:1,messages:[{role:'user',content:'UNTRUSTED TEST FIXTURE'}],tools:[]};
test('planning uses the official Responses SDK with bounded 16000-token output, no storage and no implicit retry',async()=>{
 let calls=0;
 const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(url,init)=>{
  calls++;assert.equal(new URL(url).pathname,'/v1/responses');const body=JSON.parse(init.body);assert.equal(body.max_output_tokens,16000);assert.equal(body.store,false);assert.equal(body.parallel_tool_calls,false);return modelResponse(generatedPlan(input));
 }}));
 const wire=provider.plannerRequest(message,'MOCK-plan',16000);assert.equal(wire.maxOutputTokens,16000);assert.ok(wire.maxInputTokens>=Buffer.byteLength(JSON.stringify(wire.body)));
 const result=await provider.plan(message,'MOCK-plan',16000);assert.equal(validateGeneratedPlan(JSON.parse(result.content),input).slots.length,30);assert.equal(calls,1);
 assert.equal(provider.plannerRequest(message,'MOCK-creative').maxOutputTokens,4000);
});
test('plan contract rejects fabricated facts, copied variants, missing channels, invalid periods and malformed shapes',()=>{
 for(const change of [p=>p.slots.pop(),p=>p.slots[0].fact_ids=['invented'],p=>{p.slots[1].brief=p.slots[0].brief;p.slots[1].hook=p.slots[0].hook;},p=>p.slots.forEach(s=>s.channel='linkedin'),p=>p.slots[0].planned_at='2026-12-01T08:00:00Z',p=>p.slots[0].format='video',p=>p.slots.forEach(s=>s.planned_at='2026-11-01T08:00:00Z'),p=>p.slots[0].approved=true,p=>p.title='',p=>p.slots[0].fact_ids.push(p.slots[0].fact_ids[0])]){
  const value=generatedPlan(input);change(value);assert.throws(()=>validateGeneratedPlan(value,input),/PLAN_OUTPUT_INVALID/);
 }
});
test('planning skill result requires exact owner skill digests, actual reads and no helper execution',()=>{
 const value={type:'result',version:'deepagents-0.7.29/desvio-plan-v1',plan:generatedPlan(input),skills:Object.entries(PLANNING_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(PLANNING_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false};
 assert.equal(validatePlanningResult(value,input).plan.slots.length,30);
 for(const change of [v=>v.skills[0].tree_sha256='wrong',v=>v.reads.pop(),v=>v.reads.push('/etc/passwd'),v=>v.reads.push('/skills/image/SKILL.md'),v=>v.helpers_executed=true,v=>v.model_calls=4]){
  const bad=structuredClone(value);change(bad);assert.throws(()=>validatePlanningResult(bad,input),/SKILL_/);
 }
});

test('thirty-day planning crosses month/year boundaries and leap days without being tied to one month',()=>{
 for(const starts_on of ['2028-02-15','2026-12-20','2026-04-25']){
  const context=structuredClone(input);context.preferences.starts_on=starts_on;
  const plan=generatedPlan(context);assert.equal(validateGeneratedPlan(plan,context).slots.length,30);
  assert.notEqual(plan.slots[0].planned_at.slice(0,7),plan.slots[29].planned_at.slice(0,7));
 }
});

test('daily, weekly and custom horizons preserve exact counts and reject out-of-period drafts',()=>{
 for(const [days,count] of [[1,1],[1,2],[4,4],[6,12],[7,7],[90,90]]){
  const context={...structuredClone(input),duration_days:days,post_count:count},result=generatedPlan(context);
  assert.equal(validateGeneratedPlan(result,context).slots.length,count);
  result.slots[0].planned_at=new Date(Date.parse(context.preferences.starts_on)+days*86400000).toISOString();
  assert.throws(()=>validateGeneratedPlan(result,context),/PLAN_OUTPUT_INVALID/);
 }
 for(const days of [0,91,1.5,NaN])assert.throws(()=>validateGeneratedPlan(generatedPlan(input),{...input,duration_days:days}),/PLAN_OUTPUT_INVALID/);
});

test('mixed plans require the exact video count and complete bounded concepts without enabling generation',()=>{
 const context={...structuredClone(input),duration_days:6,post_count:6,video_count:2};
 const plan=generatedPlan(context);assert.equal(validateGeneratedPlan(plan,context).slots.filter(s=>s.format==='video').length,2);
 for(const change of [p=>p.slots[0]=null,p=>delete p.slots[0].video_draft,p=>p.slots[0].video_draft.duration_seconds=60,p=>p.slots[0].video_draft.script='',p=>p.slots[0].video_draft.approved=true,p=>p.slots[2].format='video']){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateGeneratedPlan(bad,context));}
 for(const video_count of [-1,7,1.5])assert.throws(()=>validateGeneratedPlan(plan,{...context,video_count}));
});
