import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {MODEL_POLICY,recommendedGrants} from '../../dist/model-policy.js';
import {planOutputTokens,validateGeneratedPlan} from '../../dist/planning-contracts.js';
import {planningSchema} from '../../dist/planning-schema.js';
import {STRATEGY_OUTPUT_TOKENS} from '../../dist/strategy-contracts.js';
import {generatedPlan,modelResponse} from '../fixtures/planning.mjs';

const input={task:'content_plan',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['linkedin','instagram'],must_avoid:'',revision:1},brief:'Plan',post_count:30,storylines:true};

test('output limits grow with the plan so reasoning never crowds out the answer',()=>{
 assert.equal(planOutputTokens({...input,post_ideas:{plan_id:'p',format:'static',channel:'instagram'}}),4000);
 for(const [posts,limit] of [[1,16000],[7,16000],[14,16000],[15,32000],[30,32000],[31,48000],[90,48000]])assert.equal(planOutputTokens({...input,post_count:posts}),limit,`${posts} posts`);
 assert.equal(planOutputTokens({...input,planning_mode:'natural'}),48000,'the model chooses the size, so reserve for the largest');
 assert.equal(STRATEGY_OUTPUT_TOKENS,32000);
});

test('a gpt-6-astra planning grant sends the policy model, effort and limit, and the reply validates',async()=>{
 const grant=recommendedGrants().planning;assert.equal(grant.model,'gpt-6-astra');
 let seen;
 const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(_url,init)=>{seen=JSON.parse(init.body);return modelResponse(generatedPlan(input));}}));
 const request={type:'model',step:1,messages:[{role:'user',content:'UNTRUSTED TEST FIXTURE'}],tools:[],content_plan_schema:planningSchema(input)},limit=planOutputTokens(input);
 const wire=provider.plannerRequest(request,grant.model,limit);
 const result=await provider.plan(request,grant.model,limit);
 assert.equal(seen.model,'gpt-6-astra');assert.deepEqual(seen.reasoning,{effort:MODEL_POLICY.strategy.effort});assert.equal(seen.max_output_tokens,32000);assert.equal(seen.text.format.strict,true);assert.equal(seen.store,false);
 assert.equal(validateGeneratedPlan(JSON.parse(result.content),input).slots.length,30);
 // The reservation covers the whole limit at the grant's rates: no call can cost more than was held.
 const reserved=Math.ceil(wire.maxInputTokens*grant.input_micros_per_token+wire.maxOutputTokens*grant.output_micros_per_token);
 assert.equal(wire.maxOutputTokens,32000);assert.ok(reserved>=32000*50&&reserved<5_000_000,`reserved ${reserved} micro-dollars`);
});
