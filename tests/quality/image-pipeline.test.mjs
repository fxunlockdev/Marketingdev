// The image call as the worker sends it, with a MOCK provider transport. No database, no key.
// Run: npm run build && node --test tests/quality/image-pipeline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import OpenAI from 'openai';
import {CreativeProvider, MAX_IMAGE_REFERENCES} from '../../dist/creative-provider.js';
import {imageCallPlan, sceneReferences, STYLE_REFERENCE_LABEL} from '../../dist/image-render.js';
import {imageFeedback, feedbackSection} from '../../dist/image-preferences.js';
import {compositeLogo, isLogoLabel} from '../../dist/image-logo.js';
import {qaExpectation, settleVerdict, qaRetryNotes} from '../../dist/image-qa.js';
import {masterImageSize, recommendedGrants, MODEL_POLICY} from '../../dist/model-policy.js';
import {buildImagePrompt} from '../../dist/image-prompt.js';
import {business} from './fixtures/businesses.mjs';
import {referenceSet, stockPhoto, moodboardImages, logo as logoFile} from './fixtures/assets.mjs';

const MODEL = MODEL_POLICY.image.model;
function mockProvider(log, {refuse = () => false} = {}) {
  return new CreativeProvider(undefined, new OpenAI({apiKey: 'mock-only', maxRetries: 0, fetch: async (url, init) => {
    const fields = {}, images = [];
    if (init.body instanceof FormData) {
      for (const [key, value] of init.body.entries()) {
        if (typeof value === 'string') fields[key] = value;
        else images.push(await sharp(Buffer.from(await value.arrayBuffer())).metadata());
      }
    } else Object.assign(fields, JSON.parse(init.body));
    log.push({path: new URL(String(url)).pathname, fields, images});
    if (refuse(fields)) return Response.json({error: {message: `Invalid size '${fields.size}'.`, param: 'size', type: 'invalid_request_error'}}, {status: 400});
    const [width, height] = fields.size.split('x').map(Number);
    const out = await sharp({create: {width, height, channels: 3, background: '#2b5d7a'}}).png().toBuffer();
    return Response.json({created: 1, data: [{b64_json: out.toString('base64')}]});
  }}));
}
const pack = business('backpack');
const spec = aspect => ({placement: aspect === 'vertical' ? 'story' : 'feed', aspect, slide_count: null});
async function plan(overrides = {}) {
  const refs = await referenceSet(pack, ['product', 'logo']);
  const board = await moodboardImages(pack);
  return imageCallPlan({brief: pack.static.brief, facts: pack.facts, prompt: pack.static.prompt, references: refs, stock: null,
    moodboard: {...pack.moodboard, images: [{label: 'mood board image', bytes: board.image}, {label: 'mood board carousel cover', bytes: board.cover}]},
    placement: spec('portrait'), model: MODEL, quality: 'high', parent: null, learning: pack.learning,
    logo: {bytes: refs[1].bytes, source: 'attached'}, ...overrides});
}

test('mood board images reach the image model as labelled STYLE references after brand references, within the cap', async () => {
  const p = await plan();
  assert.deepEqual(p.manifest.map(m => m.kind), ['upload', 'style_moodboard', 'style_moodboard']);
  assert.ok(p.manifest[1].label.startsWith(STYLE_REFERENCE_LABEL));
  assert.match(p.prompt, /STYLE REFERENCE: the customer-approved mood board/);
  const withStock = await plan({stock: {photo: await stockPhoto(), use: 'base'}});
  assert.deepEqual(withStock.manifest.map(m => m.kind), ['upload', 'stock_base', 'style_moodboard', 'style_moodboard']);
  const full = await plan({references: [...await referenceSet(pack, ['product', 'product', 'product'])].map((r, i) => ({...r, label: `${r.label} ${i}`})), stock: {photo: await stockPhoto(), use: 'inspiration'}});
  assert.equal(full.manifest.filter(m => m.kind === 'style_moodboard').length, 0, 'style images never push out brand or stock references');
  const capped = await plan({styleLimit: 1});
  assert.equal(capped.manifest.filter(m => m.kind === 'style_moodboard').length, 1);
  const edit = await plan({parent: {bytes: await sharp({create: {width: 1024, height: 1280, channels: 3, background: '#fff'}}).png().toBuffer(), text: {hasOverlayText: false}}});
  assert.equal(edit.manifest.filter(m => m.kind === 'style_moodboard').length, 0, 'an edit keeps its own look');
  const again = await plan();
  assert.equal(again.prompt, p.prompt, 'replays send the identical prompt');
  assert.deepEqual(again.manifest, p.manifest, 'and identical references');
});

test('the approved logo is never sent to the image model and is composited exactly at the art direction corner', async () => {
  const log = [], p = await plan(), out = await p.render(mockProvider(log), 'a'.repeat(64));
  assert.equal(log.length, 1);
  assert.equal(log[0].images.length, 3, 'product + two style images; no logo');
  assert.ok(!p.manifest.some(m => isLogoLabel(m.label)));
  assert.match(p.prompt, /approved logo file is placed afterwards, exactly, as a small lockup at the top left/);
  assert.equal(out.logo.placement, 'top_left');
  assert.ok(out.logo.box.left < 100 && out.logo.box.top < 100);
  // The corner now carries dark logo pixels (on a chip or directly) that the mock output did not have.
  const corner = await sharp(out.bytes).extract(out.logo.box).stats();
  assert.ok(corner.channels[0].min < 60, 'logo ink is present');
  assert.equal(p.logo.source, 'attached');
  const none = await plan({brief: {...pack.static.brief, art_direction: {...pack.static.brief.art_direction, logo_placement: 'none'}}});
  assert.equal(none.logo, null);
  assert.match(none.prompt, /Logo: none/);
});

test('2K master in the exact aspect, downsampled to the platform size; the master is kept; a refused size falls back', async () => {
  assert.equal(masterImageSize(MODEL, {width: 1024, height: 1280}), '1664x2080');
  assert.equal(masterImageSize(MODEL, {width: 1080, height: 1920}), '1152x2048');
  assert.equal(masterImageSize('gpt-image-fixture', {width: 1024, height: 1024}), null);
  assert.equal(recommendedGrants().creative.quality, 'high');
  const log = [], p = await plan(), out = await p.render(mockProvider(log), 'a'.repeat(64));
  assert.equal(log[0].fields.size, '1664x2080');
  assert.equal(log[0].fields.quality, 'high');
  assert.equal(log[0].fields.output_format, 'png');
  assert.deepEqual([out.width, out.height], [1024, 1280]);
  assert.deepEqual([out.master.width, out.master.height], [1664, 2080]);
  assert.equal((await sharp(out.bytes).metadata()).format, 'png');
  assert.ok(out.source && out.source.sha256 === out.master.sha256);
  assert.match(p.prompt, /downsampled from this canvas without cropping/);
  const story = await plan({placement: spec('vertical'), brief: pack.story.brief});
  assert.equal(story.size, '1152x2048');
  assert.match(story.prompt, /top 14% and bottom 20%/);
  const refusedLog = [], refused = await p.render(mockProvider(refusedLog, {refuse: f => f.size !== '1024x1536'}), 'a'.repeat(64));
  assert.deepEqual(refusedLog.map(r => r.fields.size), ['1664x2080', '1024x1536']);
  assert.deepEqual([refused.width, refused.height], [1024, 1280]);
  // Fixture models and briefs without art direction keep the earlier size and request.
  const legacy = await plan({model: 'gpt-image-fixture'});
  assert.equal(legacy.size, '1024x1536');
  assert.equal(legacy.fallbackSize, undefined);
});

test('briefs saved before art direction keep their earlier request exactly', async () => {
  const {art_direction, ...old} = pack.static.brief;
  const p = await plan({brief: old});
  assert.equal(p.size, '1024x1536');
  assert.deepEqual(p.manifest.map(m => m.kind), ['upload', 'upload'], 'logo still a reference, no style images');
  assert.ok(!p.prompt.includes('CUSTOMER FEEDBACK'));
  assert.equal(p.logo, null);
});

test('customer rejections become must-avoid picture instructions and a vision-check retry', async () => {
  const feedback = imageFeedback(pack.learning);
  assert.deepEqual(feedback.avoid.map(a => a.key), ['people']);
  assert.deepEqual(feedback.prefer, ['The customer approves product hero layouts.']);
  const p = await plan();
  assert.match(p.prompt, /CUSTOMER FEEDBACK[\s\S]*Must avoid: Show no people at all/);
  assert.deepEqual(p.mustAvoid, ['people, faces, hands or human figures']);
  const expectation = qaExpectation(pack.static.brief, 'in_image', p.identity, p.mustAvoid);
  assert.deepEqual(expectation.must_avoid, ['people, faces, hands or human figures']);
  const finding = {text_matches: true, found_text: ['Carry it through the city.'], brief_fit: 5, brand_fit: 5, artefacts: ['Avoided element visible: a man carrying the bag'], verdict: 'pass'};
  assert.equal(settleVerdict(finding, expectation), 'retry', 'a person in the picture forces the one regeneration');
  assert.match(qaRetryNotes(finding, expectation), /rejected before[\s\S]*people, faces, hands/);
  assert.equal(settleVerdict({...finding, artefacts: []}, expectation), 'pass');
  assert.equal(qaExpectation(pack.static.brief, 'in_image', p.identity).must_avoid, undefined, 'no avoid list keeps older checks unchanged');
  assert.equal(feedbackSection(imageFeedback([])), '');
  assert.equal(imageFeedback([{kind: 'customer_preference', statement: 'Rejects lifestyle_hero layouts: 3 of 4 decisions', count: 3, of: 4, last_seen: '2026-11-01T00:00:00Z'}]).avoid[0].key, 'layout_lifestyle_hero');
});

test('a logo-only attachment does not make stock unnecessary; product photos still do', () => {
  assert.equal(sceneReferences([{label: 'Northline logo'}]), 0);
  assert.equal(sceneReferences([{label: 'Northline logo'}, {label: 'Metro product photo'}]), 1);
  assert.equal(isLogoLabel('Brand wordmark'), true);
  assert.equal(isLogoLabel('Logistics van'), false);
});

test('the provider accepts up to four references, decodes a 2K master, and still refuses unknown sizes', async () => {
  const log = [], provider = mockProvider(log);
  const ref = await sharp({create: {width: 2048, height: 2048, channels: 3, background: '#fff'}}).png().toBuffer();
  const out = await provider.image(MODEL, 'test', '2048x2048', 'high', 'a'.repeat(64), undefined, Array(MAX_IMAGE_REFERENCES).fill(ref));
  assert.deepEqual([out.width, out.height, out.size], [2048, 2048, '2048x2048']);
  await assert.rejects(provider.image(MODEL, 'test', '2048x2048', 'high', 'a'.repeat(64), undefined, Array(MAX_IMAGE_REFERENCES + 1).fill(ref)), /CREATIVE_REFERENCE_INVALID/);
  assert.throws(() => provider.imageRequest(MODEL, 'test', '4096x4096', 'high', 'a'.repeat(64)), /CREATIVE_IMAGE_CONFIG_INVALID/);
});

test('logo compositing is deterministic and keeps story safe areas', async () => {
  const canvas = await sharp({create: {width: 1080, height: 1920, channels: 3, background: '#ECE8E1'}}).png().toBuffer();
  const mark = await logoFile('backpack');
  const a = await compositeLogo(canvas, mark, 'top_left'), b = await compositeLogo(canvas, mark, 'top_left');
  assert.equal(a.sha256, b.sha256);
  assert.ok(a.lockup.box.top >= 1920 * 0.14, 'below the story header');
  const bottom = await compositeLogo(canvas, mark, 'bottom_right');
  assert.ok(bottom.lockup.box.top + bottom.lockup.box.height <= 1920 * 0.8, 'above the story footer');
  assert.equal(await compositeLogo(canvas, mark, 'none'), null);
});

test('the image prompt without feedback or logo is unchanged for directed briefs (prompt replay)', () => {
  const identity = [{id: 'f1', field: 'brand_name', value: 'Northline'}];
  const base = {brief: pack.static.brief, identity, references: [], hasParent: false, textMode: 'in_image'};
  assert.equal(buildImagePrompt({...base, customerFeedback: {avoid: [], prefer: []}, logoComposited: false}), buildImagePrompt(base));
});
