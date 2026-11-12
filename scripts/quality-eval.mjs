#!/usr/bin/env node
/** Quality harness: three sample businesses (coffee shop, city backpacks, dog grooming) with fixed
 * research and brief fixtures go through the real image path (image-render.ts: references, mood board
 * style images, customer avoid list, 2K master, framing, logo composite), the production vision check
 * with its one regeneration, and a rubric judge against the Roama and Groomday benchmarks.
 *
 *   node scripts/quality-eval.mjs [--mock]                     plumbing only, no network, no key
 *   OPENAI_API_KEY=… node scripts/quality-eval.mjs --live --spend-cap-usd 10
 *
 * Options: --businesses coffee,backpack,groomer  --formats static,story,carousel  --out <dir>
 *          --assets <dir>  real brand files: <key>-product.jpg, <key>-logo.jpg, <key>-stock.jpg
 *          --image-cost-usd 0.40  estimated cost of one image call used by the spend guard
 * Live mode refuses to start without a positive --spend-cap-usd and reads the key only from the shell;
 * the key is never written to disk or printed. Writes report.md, report.html and results.json.
 */
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import OpenAI from 'openai';
import {CreativeProvider} from '../dist/creative-provider.js';
import {imageCallPlan} from '../dist/image-render.js';
import {isLogoLabel} from '../dist/image-logo.js';
import {ImageQa, qaExpectation, qaPreview, qaRetryNotes, settleVerdict} from '../dist/image-qa.js';
import {inImageCopy} from '../dist/image-typography.js';
import {carouselSlideBrief} from '../dist/carousel-planning.js';
import {normalizeCreativeSpec} from '../dist/campaign-formats.js';
import {MODEL_POLICY, IMAGE_QUALITY, reservationRates} from '../dist/model-policy.js';
import {BUSINESSES, carouselPlan} from '../tests/quality/fixtures/businesses.mjs';
import {referenceSet, stockPhoto, moodboardImages} from '../tests/quality/fixtures/assets.mjs';
import {mockFetch} from './quality-eval-mock.mjs';
import {judge, BENCHMARKS} from './quality-eval-judge.mjs';

export class UsageError extends Error {}
export function parseArgs(argv, env = process.env) {
  const value = name => {const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined;};
  const live = argv.includes('--live');
  if (live && argv.includes('--mock')) throw new UsageError('Choose --mock or --live, not both');
  const cap = Number(value('--spend-cap-usd'));
  if (live && !(Number.isFinite(cap) && cap > 0)) throw new UsageError('--live needs --spend-cap-usd <positive dollars>; refusing to spend without a cap');
  if (live && !env.OPENAI_API_KEY) throw new UsageError('--live reads OPENAI_API_KEY from the shell; it is not set');
  const list = (name, all) => (value(name)?.split(',').map(s => s.trim()).filter(Boolean) ?? all);
  const businesses = list('--businesses', BUSINESSES.map(b => b.key)), formats = list('--formats', ['static', 'story', 'carousel']);
  for (const b of businesses) if (!BUSINESSES.some(x => x.key === b)) throw new UsageError(`Unknown business ${b}`);
  for (const f of formats) if (!['static', 'story', 'carousel'].includes(f)) throw new UsageError(`Unknown format ${f}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {live, cap: live ? cap : 0, businesses, formats, out: resolve(value('--out') ?? `work/quality-eval/${stamp}`), assets: value('--assets'), imageCost: Number(value('--image-cost-usd') ?? 0.4)};
}

/** Refuses any call whose estimated cost would take the run over the cap. Estimates, not invoices. */
export class SpendGuard {
  constructor(capUsd, live) {this.cap = capUsd; this.live = live; this.spent = 0;}
  reserve(usd, what) {
    if (!this.live) return;
    if (this.spent + usd > this.cap) throw Object.assign(new Error(`Spend cap $${this.cap} reached before ${what} (estimated $${this.spent.toFixed(2)} spent)`), {code: 'SPEND_CAP'});
    this.spent += usd;
  }
}
const checkCost = () => {const r = reservationRates('check'); return (8000 * r.input_micros_per_token + 2000 * r.output_micros_per_token) / 1e6;};

async function assetFor(dir, name, fallback) {
  if (!dir) return fallback();
  try {return await readFile(join(dir, name));} catch {return fallback();}
}

function jobsFor(b, formats) {
  const plan = carouselPlan(b), sceneRole = b.key === 'groomer' ? 'premises' : 'product';
  const jobs = [];
  if (formats.includes('static')) jobs.push({id: `${b.key}-static`, format: 'static', brief: b.static.brief, spec: {placement: 'feed', aspect: b.key === 'coffee' ? 'square' : 'portrait', slide_count: null}, roles: [sceneRole, 'logo'], stock: null});
  if (formats.includes('story')) jobs.push({id: `${b.key}-story`, format: 'story', brief: b.story.brief, spec: {placement: 'story', aspect: 'vertical', slide_count: null}, roles: ['logo'], stock: 'base'});
  if (formats.includes('carousel')) plan.slides.forEach((_, i) => jobs.push({id: `${b.key}-carousel-${i + 1}`, format: 'carousel', brief: carouselSlideBrief(plan, i), spec: {placement: 'feed', aspect: 'portrait', slide_count: 5}, roles: [sceneRole, 'logo'], stock: null}));
  return jobs;
}

async function renderJob(ctx, b, job) {
  const refs = await referenceSet(b, job.roles);
  const real = await Promise.all(refs.map(async r => ({...r, bytes: await assetFor(ctx.options.assets, `${b.key}-${r.role === 'logo' ? 'logo' : 'product'}.jpg`, () => r.bytes)})));
  const board = await moodboardImages(b), logo = real.find(r => isLogoLabel(r.label));
  const stock = job.stock ? {photo: await assetFor(ctx.options.assets, `${b.key}-stock.jpg`, stockPhoto), use: job.stock} : null;
  const placement = normalizeCreativeSpec(job.spec, job.format === 'carousel' ? 'carousel' : 'static', b.channel);
  const plan = await imageCallPlan({brief: job.brief, facts: b.facts, prompt: b.static.prompt, references: real, stock, placement, model: MODEL_POLICY.image.model, quality: IMAGE_QUALITY, parent: null, learning: b.learning,
    moodboard: {...b.moodboard, images: [{label: 'mood board image', bytes: board.image}, {label: 'mood board carousel cover', bytes: board.cover}]}, logo: logo ? {bytes: logo.bytes, source: 'attached'} : null});
  const expectation = qaExpectation(job.brief, plan.textMode, plan.identity, plan.mustAvoid);
  const attempt = async prompt => {ctx.guard.reserve(ctx.options.imageCost, `${job.id} image`); return plan.render(ctx.provider, 'e'.repeat(64), prompt);};
  const check = async image => {ctx.guard.reserve(checkCost(), `${job.id} check`); const wire = ctx.qa.request(await qaPreview(image.bytes), expectation); return ctx.qa.check(wire);};
  let image = await attempt(), finding = await check(image), retried = false;
  if (settleVerdict(finding, expectation) === 'retry') {image = await attempt(plan.prompt + qaRetryNotes(finding, expectation)); finding = await check(image); retried = true;}
  ctx.guard.reserve(checkCost(), `${job.id} judge`);
  const expected = plan.textMode === 'in_image' ? Object.values(inImageCopy(job.brief)).filter(Boolean) : [];
  const judgement = await judge(ctx.provider, image.bytes, {brand: b.name, creative_task: job.brief.image_prompt, art_direction: job.brief.art_direction, text_mode: plan.textMode, expected_text: expected, customer_must_avoid: plan.mustAvoid}, expected);
  await writeFile(join(ctx.options.out, `${job.id}.png`), image.bytes);
  await writeFile(join(ctx.options.out, `${job.id}-sheet.jpg`), judgement.sheet);
  return {id: job.id, business: b.key, format: job.format, size: plan.size, stored: `${image.width}x${image.height}`, master: image.master ? `${image.master.width}x${image.master.height}` : null,
    references: plan.manifest.map(m => m.kind), logo: image.logo?.placement ?? null, must_avoid: plan.mustAvoid, text_mode: plan.textMode, qa: {verdict: settleVerdict(finding, expectation), retried},
    scores: judgement.scores, overall: judgement.overall, found_text: judgement.found_text, artefacts: judgement.artefacts, notes: judgement.notes, prompt: plan.prompt};
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const mean = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 : null;
export function summary(results) {
  const ok = results.filter(r => r.scores);
  const by = key => Object.fromEntries([...new Set(ok.map(r => r[key]))].map(k => [k, mean(ok.filter(r => r[key] === k).map(r => r.overall))]));
  return {outputs: results.length, judged: ok.length, overall: mean(ok.map(r => r.overall)), by_business: by('business'), by_format: by('format'),
    by_criterion: ok.length ? Object.fromEntries(Object.keys(ok[0].scores).map(k => [k, mean(ok.map(r => r.scores[k]))])) : {}};
}

function reports(results, meta) {
  const s = summary(results), criteria = Object.keys(s.by_criterion);
  const md = [`# Quality evaluation (${meta.mode})`, '', `${meta.started}. Image model \`${MODEL_POLICY.image.model}\` (quality ${IMAGE_QUALITY}), judge \`${MODEL_POLICY.check.model}\`. Benchmarks: ${BENCHMARKS.join(', ')}.`,
    meta.mode === 'mock' ? '\n**MOCK run: placeholder images and fixed scores. This proves the plumbing, not quality.**\n' : `\nEstimated spend: $${meta.spent.toFixed(2)} of a $${meta.cap} cap.\n`,
    `Overall ${s.overall} / 5 over ${s.judged} of ${s.outputs} outputs. By business: ${JSON.stringify(s.by_business)}. By format: ${JSON.stringify(s.by_format)}.`, '',
    `| Output | Size → stored | References | Logo | QA | ${criteria.join(' | ')} | Overall |`, `|${'---|'.repeat(criteria.length + 6)}`,
    ...results.map(r => r.error ? `| ${r.id} | ${r.error} |` : `| ![](${r.id}.png) ${r.id} | ${r.size} → ${r.stored} | ${r.references.join(', ')} | ${r.logo ?? '–'} | ${r.qa.verdict}${r.qa.retried ? ' (retried)' : ''} | ${criteria.map(k => r.scores[k]).join(' | ')} | ${r.overall} |`),
    '', ...results.filter(r => r.notes).map(r => `- **${r.id}**: ${r.notes}${r.artefacts.length ? ` Artefacts: ${r.artefacts.join('; ')}` : ''}`)].join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Quality evaluation</title><style>body{font:14px system-ui;margin:24px;background:#faf9f7;color:#1b1b1b}figure{display:inline-block;width:300px;margin:8px;vertical-align:top;background:#fff;padding:8px;border:1px solid #ddd}img{width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 6px}details{margin-top:4px}pre{white-space:pre-wrap;font-size:11px}</style>
<h1>Quality evaluation (${esc(meta.mode)})</h1><p>${esc(meta.started)}. Overall <b>${s.overall}</b> / 5. ${meta.mode === 'mock' ? '<b>MOCK run: placeholders and fixed scores.</b>' : `Estimated spend $${meta.spent.toFixed(2)} of $${meta.cap}.`}</p>
<table><tr><th>Criterion</th>${criteria.map(k => `<th>${esc(k)}</th>`).join('')}</tr><tr><td>mean</td>${criteria.map(k => `<td>${s.by_criterion[k]}</td>`).join('')}</tr></table>
${results.map(r => r.error ? `<figure><b>${esc(r.id)}</b><p>${esc(r.error)}</p></figure>` : `<figure><img src="${esc(r.id)}.png" alt="${esc(r.id)}"><b>${esc(r.id)}</b> ${r.overall}/5<br>${esc(r.size)} → ${esc(r.stored)}; QA ${esc(r.qa.verdict)}${r.qa.retried ? ' (retried)' : ''}<br>${Object.entries(r.scores).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}<br><i>${esc(r.notes)}</i><details><summary>Comparison sheet</summary><img src="${esc(r.id)}-sheet.jpg" alt="sheet"></details><details><summary>Prompt</summary><pre>${esc(r.prompt)}</pre></details></figure>`).join('\n')}`;
  return {md, html, summary: s};
}

export async function run(options) {
  await mkdir(options.out, {recursive: true});
  const log = [];
  const sdk = options.live ? new OpenAI({apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 180000}) : new OpenAI({apiKey: 'mock-only', maxRetries: 0, fetch: mockFetch(log)});
  const provider = new CreativeProvider(undefined, sdk);
  const ctx = {options, provider, qa: new ImageQa(provider), guard: new SpendGuard(options.cap, options.live)};
  const results = [], started = new Date().toISOString();
  for (const key of options.businesses) {
    const b = BUSINESSES.find(x => x.key === key);
    for (const job of jobsFor(b, options.formats)) {
      try {results.push(await renderJob(ctx, b, job));}
      catch (error) {
        results.push({id: job.id, business: b.key, format: job.format, error: error.code === 'SPEND_CAP' ? error.message : `failed: ${error.code ?? error.message}`});
        if (error.code === 'SPEND_CAP') break;
      }
    }
  }
  const meta = {mode: options.live ? 'live' : 'mock', started, spent: ctx.guard.spent, cap: options.cap};
  const {md, html, summary: s} = reports(results, meta);
  await writeFile(join(options.out, 'report.md'), md);
  await writeFile(join(options.out, 'report.html'), html);
  await writeFile(join(options.out, 'results.json'), JSON.stringify({meta, summary: s, results, requests: log}, null, 1));
  return {results, summary: s, out: options.out};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const {summary: s, out} = await run(options);
    process.stdout.write(`${options.live ? 'LIVE' : 'MOCK'} quality eval: overall ${s.overall}/5 over ${s.judged}/${s.outputs} outputs. Report: ${join(out, 'report.html')}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof UsageError ? 'Usage: ' : ''}${error.message}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
