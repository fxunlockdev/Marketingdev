import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationTimingEstimate as estimate} from '../../dist/generation-timing.js';
test('estimates require three valid completed samples rather than inventing a wait',()=>{
 for(const values of [[],[60,120],[null,'',NaN,-1,Infinity,7201]])assert.equal(estimate(values,'image'),null);
});
test('estimates round a historical range and retain a positive floor for fast jobs',()=>{
 assert.deepEqual(estimate([1,10,20],'image'),{min_seconds:30,max_seconds:30,sample_count:3,source:'recent_generations'});
 assert.deepEqual(estimate([100,200,300,400],'image'),{min_seconds:90,max_seconds:420,sample_count:4,source:'recent_generations'});
 assert.deepEqual(estimate(['100','200','300','400'],'video'),{min_seconds:60,max_seconds:420,sample_count:4,source:'recent_generations'});
});
