import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_POLICY,acceptsModel,reasoningEffort,reservationRates,recommendedGrants} from '../../dist/model-policy.js';
import {IMAGE_PLANNING_MODEL,imagePlanningRates} from '../../dist/creative-planning.js';
import {CHAT_MODEL,CHAT_RATES} from '../../dist/chat-contracts.js';
import {RESEARCH_MODEL,researchRequest} from '../../dist/openai-website-research.js';

test('every role uses the GPT-6 family, with images on the image line',()=>{
  assert.equal(MODEL_POLICY.strategy.model,'gpt-6-astra');
  assert.equal(MODEL_POLICY.research.model,'gpt-6.1-sol');
  assert.equal(MODEL_POLICY.brief.model,'gpt-6.1-sol');
  assert.equal(MODEL_POLICY.chat.model,'gpt-6.1-sol');
  assert.equal(MODEL_POLICY.check.model,'gpt-6-luna');
  assert.equal(MODEL_POLICY.image.model,'gpt-image-2.6-sunburst');
  for(const [role,entry] of Object.entries(MODEL_POLICY))
    assert.match(entry.model,role==='image'?/^gpt-image-/:/^gpt-6(\.\d)?-(astra|sol|luna)$/,role);
});

test('existing constants come from the policy, with no stray model names',()=>{
  assert.equal(IMAGE_PLANNING_MODEL,MODEL_POLICY.brief.model);
  assert.equal(CHAT_MODEL,MODEL_POLICY.chat.model);
  assert.equal(RESEARCH_MODEL,MODEL_POLICY.research.model);
  assert.equal(researchRequest('https://example.com').model,'gpt-6.1-sol');
});

test('reservations are never below list price',()=>{
  // List prices per million tokens: Astra $10/$50, Sol $2/$10, Luna $0.10/$0.50.
  const list={strategy:[10,50],research:[2,10],brief:[2,10],chat:[2,10],check:[0.1,0.5]};
  for(const [role,[input,output]] of Object.entries(list)){
    const rates=reservationRates(role);
    assert.ok(rates.input_micros_per_token>=input,role);
    assert.ok(rates.output_micros_per_token>=output,role);
  }
  assert.deepEqual(CHAT_RATES,{input:reservationRates('chat').input_micros_per_token,output:reservationRates('chat').output_micros_per_token});
  assert.ok(imagePlanningRates(1000).input_micros_per_token>=2);
  // Long prompts reserve at least as much per token as short ones.
  assert.ok(imagePlanningRates(300000).input_micros_per_token>=imagePlanningRates(1000).input_micros_per_token);
  assert.throws(()=>reservationRates('image'),/MODEL_ROLE_HAS_NO_TOKEN_RATES/);
});

test('reasoning effort follows the job, and unknown models get none',()=>{
  assert.equal(reasoningEffort('gpt-6-astra'),'medium');
  assert.equal(reasoningEffort('gpt-6.1-sol'),'low');
  assert.equal(reasoningEffort('gpt-6-luna'),'low');
  assert.equal(reasoningEffort('gpt-6-sol'),'low');
  assert.equal(reasoningEffort('gpt-4.1-2025-04-14'),undefined);
  assert.equal(reasoningEffort('gemini-3-pro'),undefined);
});

test('work saved under the previous brief and chat model can still finish',()=>{
  assert.equal(acceptsModel('brief','gpt-6.1-sol'),true);
  assert.equal(acceptsModel('brief','gpt-6-sol'),true);
  assert.equal(acceptsModel('chat','gpt-6-sol'),true);
  assert.equal(acceptsModel('brief','gpt-4.1'),false);
  assert.equal(acceptsModel('strategy','gpt-6-sol'),false);
});

test('recommended grants name the policy models and prices for operators',()=>{
  const grants=recommendedGrants();
  assert.equal(grants.planning.model,'gpt-6-astra');
  assert.equal(grants.creative.text_model,'gpt-6.1-sol');
  assert.equal(grants.creative.image_model,'gpt-image-2.6-sunburst');
  assert.equal(grants.onboarding.model,'gpt-6.1-sol');
  assert.equal(grants.insights.model,'gpt-6.1-sol');
  assert.ok(grants.planning.input_micros_per_token>=10&&grants.planning.output_micros_per_token>=50);
});
