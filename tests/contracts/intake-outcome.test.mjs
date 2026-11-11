import test from 'node:test';
import assert from 'node:assert/strict';
import {exhaustedIntakeOutcome} from '../../dist/intake-outcome.js';

test('analysis that never reached the provider can be retried',()=>{
  assert.deepEqual(exhaustedIntakeOutcome('brand.analyze',null),{status:'failed',code:'AI_ANALYSIS_FAILED_BEFORE_SUBMISSION'});
});
test('analysis with an uncertain paid call stays under review',()=>{
  for(const call of ['submitted','unknown'])
    assert.deepEqual(exhaustedIntakeOutcome('brand.analyze',call),{status:'unknown',code:'AI_SUBMISSION_REQUIRES_REVIEW'});
});
test('analysis whose provider call was settled is a plain failure',()=>{
  assert.deepEqual(exhaustedIntakeOutcome('brand.analyze','rejected'),{status:'failed',code:'AI_ANALYSIS_FAILED_AFTER_REJECTION'});
  assert.deepEqual(exhaustedIntakeOutcome('brand.analyze','succeeded'),{status:'failed',code:'AI_ANALYSIS_RESULT_NOT_SAVED'});
});
test('website capture keeps its existing outcome',()=>{
  assert.deepEqual(exhaustedIntakeOutcome('website.extract',null),{status:'failed',code:'WEBSITE_RETRIES_EXHAUSTED'});
});
test('unknown job kinds are refused',()=>{
  assert.throws(()=>exhaustedIntakeOutcome('creative.generate',null),/JOB_KIND_DENIED/);
});
