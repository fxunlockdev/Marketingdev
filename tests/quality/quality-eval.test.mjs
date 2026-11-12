// The quality harness plumbing in MOCK mode; live mode refuses without a cap or a shell key.
// Run: npm run build && node --test tests/quality/quality-eval.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {parseArgs, run, SpendGuard, UsageError} from '../../scripts/quality-eval.mjs';
import {scoreJudgement, contactSheet} from '../../scripts/quality-eval-judge.mjs';

test('live mode refuses without a positive spend cap or without a key in the shell; mock needs neither', () => {
  assert.throws(() => parseArgs(['--live'], {OPENAI_API_KEY: 'k'}), UsageError);
  assert.throws(() => parseArgs(['--live', '--spend-cap-usd', '0'], {OPENAI_API_KEY: 'k'}), UsageError);
  assert.throws(() => parseArgs(['--live', '--spend-cap-usd', '5'], {}), UsageError);
  assert.throws(() => parseArgs(['--live', '--mock', '--spend-cap-usd', '5'], {OPENAI_API_KEY: 'k'}), UsageError);
  assert.equal(parseArgs(['--live', '--spend-cap-usd', '5'], {OPENAI_API_KEY: 'k'}).cap, 5);
  const mock = parseArgs([], {});
  assert.equal(mock.live, false);
  assert.deepEqual(mock.businesses, ['coffee', 'backpack', 'groomer']);
  assert.throws(() => parseArgs(['--formats', 'banner'], {}), UsageError);
});

test('the spend guard stops before a call would pass the cap', () => {
  const guard = new SpendGuard(1, true);
  guard.reserve(0.6, 'one');
  assert.throws(() => guard.reserve(0.6, 'two'), e => e.code === 'SPEND_CAP');
  assert.equal(guard.spent, 0.6);
  const mock = new SpendGuard(0, false);
  mock.reserve(100, 'free');
  assert.equal(mock.spent, 0);
});

test('a mock run renders through the real image path, checks, judges and writes the report', async () => {
  const out = await mkdtemp(join(tmpdir(), 'quality-eval-'));
  try {
    const {results, summary} = await run({live: false, cap: 0, businesses: ['groomer'], formats: ['static', 'story'], out, imageCost: 0.4});
    assert.deepEqual(results.map(r => r.id), ['groomer-static', 'groomer-story']);
    const [still, story] = results;
    assert.equal(still.size, '1664x2080');
    assert.equal(still.stored, '1024x1280');
    assert.equal(story.stored, '1080x1920');
    assert.deepEqual(story.references, ['stock_base', 'style_moodboard', 'style_moodboard']);
    assert.equal(still.logo, 'top_right');
    assert.ok(still.prompt.includes('CUSTOMER FEEDBACK'), 'groomer rejected wording before');
    assert.equal(still.scores.headline_spelling, 5);
    assert.equal(summary.judged, 2);
    for (const file of ['report.md', 'report.html', 'results.json', 'groomer-static.png', 'groomer-static-sheet.jpg']) assert.ok((await stat(join(out, file))).size > 0, file);
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /MOCK run/);
    assert.ok(!(await readFile(join(out, 'results.json'), 'utf8')).includes('OPENAI_API_KEY'));
  } finally {await rm(out, {recursive: true, force: true});}
});

test('the judge scores spelling deterministically and puts the candidate beside the benchmarks', async () => {
  const raw = JSON.stringify({brief_fit: 4, brand_palette: 4, brand_typography: 3, logo: 5, composition: 4, benchmark_likeness: 3, artefact_free: 5, found_text: ['A good day for a gr00m.'], artefacts: [], notes: 'x'});
  assert.equal(scoreJudgement(raw, ['A good day for a groom.']).scores.headline_spelling, 1);
  assert.equal(scoreJudgement(raw.replace('gr00m', 'groom'), ['A good day for a groom.']).scores.headline_spelling, 5);
  assert.throws(() => scoreJudgement(JSON.stringify({brief_fit: 9}), []));
  const sheet = await contactSheet(await sharp({create: {width: 1024, height: 1280, channels: 3, background: '#f00'}}).png().toBuffer());
  const meta = await sharp(sheet).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1600, 1200, 'jpeg']);
});
