// Actual isolated skill sandbox (Docker) with a MOCK broker: Brand Engine recipes are preloaded for
// image and carousel briefs, recorded in the reads manifest, and a fresh result without them is refused.
// Run: npm run build && node --test --test-concurrency=1 tests/quality/brand-engine-recipes.test.mjs
import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSkillImage} from '../../scripts/skill-test-image.mjs';
import {SkillRuntime, BRAND_ENGINE_RECIPES, hasBrandEngineRecipes, skillTask} from '../../dist/skill-runtime.js';
import {validateSkillResult} from '../../dist/creative-contracts.js';
import {business, carouselPlan} from './fixtures/businesses.mjs';

let runtime;
before(() => {runtime = new SkillRuntime(prepareSkillImage());});
const groomer = business('groomer'), pack = business('backpack');
const staticInput = format => ({brand: {learning: pack.learning, knowledge: pack.knowledge, id: pack.brandId, sha256: pack.sha256, facts: pack.facts}, prompt: pack.static.prompt, format, channel: 'instagram', parent: null});
const carouselInput = {task: 'carousel', brand: {id: groomer.brandId, sha256: groomer.sha256, facts: groomer.facts, learning: groomer.learning}, prompt: groomer.static.prompt, channel: 'instagram', slide_count: 5};

const cases = [
  ['static', () => runtime.plan(staticInput('static'), ...broker(pack.static.brief)), 'Static ad creative'],
  ['ad', () => runtime.plan(staticInput('ad'), ...broker(pack.static.brief)), 'Static ad creative'],
  ['carousel', () => runtime.carouselPlan(carouselInput, ...broker(carouselPlan(groomer)), groomer.knowledge), 'Swipe carousel'],
];
let seen;
function broker(answer) {
  return [async request => {seen.push(request); return {content: JSON.stringify(answer), tool_calls: []};}];
}

for (const [name, run, recipe] of cases) {
  test(`${name} brief receives the Brand Engine recipes in its first and only model call (MOCK model)`, async () => {
    seen = [];
    const result = await run();
    assert.equal(seen.length, 1, 'preloading must not cost an extra paid model call');
    const system = seen[0].messages.find(m => m.role === 'system').content;
    assert.ok(system.includes('Brand Engine recipes for this task'));
    for (const heading of ['Mandatory production loop', 'Design quality bar', 'Voice QA pass', recipe]) assert.ok(system.includes(heading), heading);
    assert.ok(system.includes('customer_preference'), 'the planner is told how to use customer preferences');
    assert.ok(system.length < 60000, 'context stays bounded');
    for (const path of BRAND_ENGINE_RECIPES) assert.ok(result.reads.includes(path), path);
    assert.equal(hasBrandEngineRecipes(result, name === 'carousel' ? 'carousel' : 'creative'), true);
  });
}

test('a fresh image or carousel result without the recipes in its reads is refused; other tasks are unaffected', () => {
  const reads = ['/skills/brand-engine/SKILL.md', '/skills/desvio-production/SKILL.md'];
  assert.equal(hasBrandEngineRecipes({reads}, 'creative'), false);
  assert.equal(hasBrandEngineRecipes({reads: [...reads, BRAND_ENGINE_RECIPES[0]]}, 'carousel'), false);
  assert.equal(hasBrandEngineRecipes({reads: [...reads, ...BRAND_ENGINE_RECIPES]}, 'creative'), true);
  assert.equal(hasBrandEngineRecipes({reads}, 'video'), true);
  assert.equal(hasBrandEngineRecipes({}, 'content_plan'), true);
  assert.equal(skillTask({brand: {}, prompt: 'x'}), 'creative');
  assert.equal(skillTask({task: 'carousel'}), 'carousel');
});

test('a stored brief saved before recipes were preloaded stays valid (only fresh runs are checked)', async () => {
  seen = [];
  const result = await runtime.plan(staticInput('static'), ...broker(pack.static.brief));
  const legacy = {...result, reads: result.reads.filter(p => !BRAND_ENGINE_RECIPES.includes(p))};
  assert.doesNotThrow(() => validateSkillResult(legacy, staticInput('static')));
});
