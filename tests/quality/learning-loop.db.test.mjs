// Learning loop proof on a real local database, real storage and the real isolated skill sandbox, with
// MOCK model and image transports. A business rejects two creatives for "too many people"; the next
// creative's brief input, image prompt and vision check all carry the avoid instruction, and a check
// that sees people forces the one regeneration.
// Run: npm run build && node scripts/quality-eval-db.mjs
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import OpenAI from 'openai';
import {TenantDatabase} from '../../dist/database.js';
import {Workspaces} from '../../dist/workspaces.js';
import {Businesses} from '../../dist/businesses.js';
import {BrandBrain} from '../../dist/brand-brain.js';
import {Canvas} from '../../dist/canvas.js';
import {ObjectStore} from '../../dist/object-store.js';
import {AssetJobs} from '../../dist/jobs.js';
import {SkillRuntime} from '../../dist/skill-runtime.js';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {CreativeJobs} from '../../dist/creative-jobs.js';
import {ImageQa} from '../../dist/image-qa.js';
import {MODEL_POLICY} from '../../dist/model-policy.js';

const config = JSON.parse(process.env.DESVIO_TEST_CONFIG);
const admin = new Pool({connectionString: process.env.DESVIO_TEST_ADMIN_URL}), app = new Pool({connectionString: config.appDatabaseUrl}), worker = new Pool({connectionString: config.jobs.workerDatabaseUrl});
const database = new TenantDatabase(app), workspaces = new Workspaces(database), businesses = new Businesses(database, workspaces), brain = new BrandBrain(database);
const store = new ObjectStore(config.storage), canvas = new Canvas(businesses, store), jobs = new AssetJobs(worker, store, null);
const owner = randomUUID();
let org, brand, thread;

const art = {layout_archetype: 'lifestyle_hero', text_mode: 'in_image', headline_treatment: 'DM Sans 600, sentence case, ink black, bottom band', hierarchy: 'Product, headline, logo', composition: 'Backpack centred on a concrete ledge', lighting: 'Morning daylight', palette_roles: {dominant: '#ECE8E1', headline: '#111111', accent: '#6E7F73'}, product_placement: 'The Metro backpack on the ledge', logo_placement: 'none'};
const answer = value => Response.json({object: 'response', id: 'resp_fixture', status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(value), annotations: []}]}], usage: {input_tokens: 100, output_tokens: 100, total_tokens: 200}});
const pass = {text_matches: true, found_text: ['Carry it through the city.'], brief_fit: 5, brand_fit: 5, artefacts: [], verdict: 'pass'};

/** Records what reaches the planner, the image model and the vision check. */
function transport(checks) {
  const log = {planner: [], prompts: [], sizes: [], checks: []};
  const fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/responses') {
      const body = JSON.parse(init.body);
      if (body.text?.format?.name === 'desvio_image_qa') {log.checks.push(body); return answer(checks[log.checks.length - 1] ?? pass);}
      log.planner.push(body);
      const user = body.input.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n'));
      const value = JSON.parse(user.content.slice(user.content.indexOf('\n') + 1));
      return answer({headline: 'Carry it through the city.', body: '', cta: '', caption: 'One bag, whole day.', image_prompt: 'The black backpack on a concrete ledge, glass towers behind', palette: ['#111111', '#ECE8E1'], fact_ids: [value.brand.facts.find(f => f.field === 'offering').id], warnings: [], art_direction: art});
    }
    const fields = path.endsWith('edits') ? Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === 'string')) : JSON.parse(init.body);
    log.prompts.push(fields.prompt); log.sizes.push(fields.size);
    const [width, height] = fields.size.split('x').map(Number);
    const png = await sharp({create: {width, height, channels: 3, background: log.prompts.length % 2 ? '#8899aa' : '#aa9988'}}).png().toBuffer();
    return Response.json({created: 1, data: [{b64_json: png.toString('base64')}], usage: {input_tokens: 50, output_tokens: 100, total_tokens: 150}});
  };
  return {log, provider: new CreativeProvider(undefined, new OpenAI({apiKey: 'fixture-only', maxRetries: 0, fetch}))};
}
const scope = j => ({organizationId: org.id, brandId: brand.id, jobId: j.id});
const submit = prompt => canvas.submit(owner, brand.id, thread.id, {prompt, format: 'static', channel: 'instagram', size: '1024x1024', parent_version_id: null}, randomUUID());
async function generate(prompt, checks = []) {
  const {log, provider} = transport(checks);
  const handler = new CreativeJobs(jobs, new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE), provider, undefined, undefined, new ImageQa(provider));
  const j = await submit(prompt);
  assert.equal(await handler.run(scope(j)), 'succeeded');
  const version = (await admin.query('SELECT v.id,v.skill_manifest,v.qa,m.width,m.height FROM app.creative_requests r JOIN app.creative_versions v ON v.id=r.output_version_id JOIN app.creative_media m ON m.id=v.media_id WHERE r.job_id=$1', [j.id])).rows[0];
  return {log, version, job: j};
}

before(async () => {
  await admin.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)', [owner, `${owner}@example.test`]);
  org = await workspaces.create(owner, {name: 'Quality account'});
  brand = await workspaces.createBrand(owner, org.id, {name: 'Northline'}, randomUUID());
  for (const [field, value] of [['brand_name', 'Northline'], ['offering', 'Slim water-resistant city backpacks'], ['audience', 'Urban professionals who walk to work']])
    await brain.manual(owner, org.id, brand.id, {field, value}, randomUUID());
  for (const f of (await brain.read(owner, org.id, brand.id)).findings) await brain.review(owner, org.id, brand.id, f.id, {decision: 'correct', revision: f.revision});
  await brain.approve(owner, org.id, brand.id, {revision: (await brain.read(owner, org.id, brand.id)).revision});
  thread = await canvas.createThread(owner, brand.id, {title: 'Learning loop'}, randomUUID());
  await admin.query("INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text',$3,'high',now()+interval '1 hour',100000000,0.01,0.02,100000,'LOCAL TEST ONLY',true)", [org.id, brand.id, MODEL_POLICY.image.model]);
  await admin.query('INSERT INTO app.content_allowance_plans(organization_id,static_limit) VALUES($1,50) ON CONFLICT(organization_id) DO UPDATE SET static_limit=50', [org.id]);
});
after(async () => {store.close(); await Promise.all([admin.end(), app.end(), worker.end()]);});

test('two rejections for "too many people" reach the next brief, image prompt and vision check, and people in the picture force a regeneration', async () => {
  // Two creatives made before any feedback: nothing to avoid yet.
  const first = await generate('Lifestyle hero: carry it through the city');
  assert.ok(!first.log.prompts[0].includes('CUSTOMER FEEDBACK'));
  const second = await generate('Lifestyle hero: one bag, whole day');
  for (const [made, reason] of [[first, 'Too many people in this one, show the bag'], [second, 'Again too many people. We want the product, not models.']]) {
    await canvas.review(owner, brand.id, made.version.id, {decision: 'in_review', feedback: '', revision: 1});
    await canvas.review(owner, brand.id, made.version.id, {decision: 'rejected', feedback: reason, revision: 2});
  }
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.creative_signals WHERE brand_id=$1 AND kind='rejected'", [brand.id])).rows[0].n, 2);

  // The next creative. The vision check first reports a person; the regeneration passes.
  const seen = {...pass, artefacts: ['Avoided element visible: a man carrying the backpack']};
  const next = await generate('Lifestyle hero: the commute', [seen, pass]);
  const {log, version} = next;

  // (1) The brief planner receives the learned preference and the rule for using it.
  const plannerText = JSON.stringify(log.planner[0].input);
  assert.match(plannerText, /Rejection reasons mention people: 2 of 2 rejections with a reason/);
  assert.match(plannerText, /customer_preference/);
  // (2) The image prompt carries the avoid instruction, on the 2K master size.
  assert.match(log.prompts[0], /CUSTOMER FEEDBACK[\s\S]*Must avoid: Show no people at all/);
  assert.equal(log.sizes[0], '2048x2048');
  // (3) The vision check is told what to look for, and a visible person forces the one regeneration.
  const spec = JSON.parse(log.checks[0].input[1].content[0].text.split('\n').slice(1).join('\n'));
  assert.deepEqual(spec.must_avoid, ['people, faces, hands or human figures']);
  assert.equal(log.prompts.length, 2);
  assert.match(log.prompts[1], /rejected before[\s\S]*people, faces, hands or human figures/);
  assert.equal(version.qa.retried, true);
  assert.equal(version.qa.verdict, 'pass');
  // The record says what was avoided and that the stored creative came from a 2K master.
  assert.deepEqual(version.skill_manifest.customer_feedback.avoid, ['people']);
  assert.deepEqual([version.width, version.height], [1024, 1024]);
  assert.deepEqual([version.skill_manifest.master.width, version.skill_manifest.master.height], [2048, 2048]);
  assert.ok(version.skill_manifest.reads.includes('/skills/brand-engine/references/design-recipes.md'));
});
