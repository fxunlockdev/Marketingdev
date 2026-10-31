import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creativeTextModel,IMAGE_PLANNING_MODEL,imagePlanningRates} from '../../dist/creative-planning.js';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {imageGenerationCapacity,CREATIVE_PLANNER_LIMITS as limits} from '../../dist/creative-budget.js';
test('new images and carousel slides use GPT-6 with an active grant; absent grants remain blocked',async()=>{
 const db={query:async()=>({rows:[{text_model:'previous-model'}]})};
 assert.equal(await creativeTextModel(db,'org','brand','openai','image'),IMAGE_PLANNING_MODEL);
 assert.equal(await creativeTextModel(db,'org','brand','openai'),'previous-model');
 assert.equal(await creativeTextModel({query:async()=>({rows:[]})},'org','brand','openai','image'),null);
});
test('GPT-6 creative wire uses bounded low reasoning and tier-aware reservations',()=>{
 const wire=new CreativeProvider().plannerRequest({step:1,messages:[{role:'user',content:'Plan a carousel'}],tools:[]},IMAGE_PLANNING_MODEL,16000);
 assert.equal(wire.body.model,'gpt-6-sol');assert.equal(wire.body.reasoning.effort,'low');assert.equal(wire.body.store,false);
 assert.deepEqual(imagePlanningRates(272000),{input_micros_per_token:2.5,output_micros_per_token:10});
 assert.deepEqual(imagePlanningRates(272001),{input_micros_per_token:5,output_micros_per_token:15});
 const rates=imagePlanningRates(limits.bodyBytes+limits.inputAllowance),grant={...rates,max_image_request_micros:1000000};
 assert.ok(imageGenerationCapacity(grant,3).credits*10000>=4000000+3*((limits.bodyBytes+limits.inputAllowance)*5+4000*15));
});
