import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageGenerationCapacity,CREATIVE_PLANNER_LIMITS as limits} from '../../dist/creative-budget.js';
test('generation capacity covers actual reserve plus every bounded planning call and reference',()=>{
 const grant={max_image_request_micros:5000000,input_micros_per_token:2,output_micros_per_token:8};
 for(const count of [0,1,3]){const quote=imageGenerationCapacity(grant,count);const bound=5000000*(1+count)+limits.steps*Math.ceil((limits.bodyBytes+limits.inputAllowance)*2+limits.outputTokens*8);assert.ok(quote.credits*10000>=bound);assert.ok(quote.credits*10000<bound+10000);}
 assert.throws(()=>imageGenerationCapacity(grant,4));assert.throws(()=>imageGenerationCapacity({...grant,max_image_request_micros:NaN},0));
});
