#!/usr/bin/env node
/** "What the model sees": records, in mock mode, exactly what three representative requests send to
 * (a) the isolated skill sandbox, (b) the brief model call and (c) the image call.
 *
 *   node scripts/quality-eval-dump.mjs [--out work/quality-eval/dump.md] [--no-sandbox]
 *
 * The sandbox is the real Deep Agents container with a MOCK broker; the image call goes through the
 * real CreativeProvider with a MOCK transport that captures the HTTP request. No paid call, no key.
 * Private skill and production-rule text is summarised by path, size and hash, never printed.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import OpenAI from 'openai';
import {SkillRuntime} from '../dist/skill-runtime.js';
import {CreativeProvider} from '../dist/creative-provider.js';
import {IMAGE_PLANNING_MODEL} from '../dist/creative-planning.js';
import {MODEL_POLICY, recommendedGrants} from '../dist/model-policy.js';
import {carouselSlideBrief,carouselPlanSchema} from '../dist/carousel-planning.js';
import {stockSkipReason} from '../dist/stock-planning.js';
import {normalizeCreativeSpec} from '../dist/campaign-formats.js';
import {imageCallPlan} from '../dist/image-render.js';
import {BUSINESSES, AUDIT_REQUESTS, business, carouselPlan} from '../tests/quality/fixtures/businesses.mjs';
import {referenceSet, stockPhoto, moodboardImages} from '../tests/quality/fixtures/assets.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback;};
const OUT = resolve(option('--out', 'work/quality-eval/dump.md'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const OWN_SYSTEM_MARKERS = ["You are Desvio's creative planner", "You are Desvio's carousel planner"];

/** Inputs exactly as CreativeJobs assembles them from the stored request, brain and knowledge pack. */
export function creativeInput(b, prompt) {
  return {brand: {learning: b.learning, knowledge: b.knowledge, id: b.brandId, sha256: b.sha256, facts: b.facts}, prompt, format: 'static', channel: b.channel, parent: null};
}
export function carouselInput(b, prompt, slides) {
  return {task: 'carousel', brand: {id: b.brandId, sha256: b.sha256, facts: b.facts, learning: b.learning}, prompt, channel: b.channel, slide_count: slides};
}

function summariseSystem(content) {
  const own = OWN_SYSTEM_MARKERS.find(m => content.includes(m));
  const preloaded = [...content.matchAll(/^(\/skills\/[a-z0-9-]+\/references\/[a-z0-9-]+\.md)$/gm)].map(m => m[1]);
  const markers = {production_guidance: content.includes('Shared production guidance for this task'), brand_engine_recipes: content.includes('Brand Engine recipes for this task'), customer_preferences_rule: /customer_preference/.test(content), creative_direction_rule: /creative_direction/.test(content)};
  return {chars: content.length, sha256: sha(content), own_prompt: own ?? null, preloaded_reference_paths: preloaded, markers};
}

async function sandboxAudit(runtime, request, b) {
  const calls = [];
  const broker = async message => {
    calls.push(message);
    const brief = request.kind === 'carousel' ? carouselPlan(b) : b.static.brief;
    return {content: JSON.stringify(brief), tool_calls: []};
  };
  const result = request.kind === 'carousel'
    ? await runtime.carouselPlan(carouselInput(b, b.static.prompt, 5), broker, b.knowledge)
    : await runtime.plan(creativeInput(b, b.static.prompt), broker);
  const first = calls[0];
  const user = first.messages.find(m => m.role === 'user' && m.content.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:'));
  const data = JSON.parse(user.content.slice(user.content.indexOf('\n') + 1));
  return {
    model_calls: result.model_calls,
    skills: result.skills.map(s => s.name),
    reads: result.reads,
    messages: first.messages.map(m => ({role: m.role, chars: m.content.length, sha256: sha(m.content), ...(m.role === 'system' ? {system: summariseSystem(m.content)} : {})})),
    tools: first.tools.map(t => t.function?.name),
    business_data_keys: Object.keys(data),
    brand_keys: Object.keys(data.brand),
    brand_json: data.brand,
    first_request: first,
  };
}

function briefWire(provider, request, b, first) {
  const message = request.kind === 'carousel'
    ? {...first, carousel_plan_schema: carouselPlanSchema(carouselInput(b, b.static.prompt, 5))}
    : {...first, creative_fact_ids: b.facts.map(f => f.id)};
  // Carousel plans are answered with a larger output allowance (carousel-jobs.ts).
  const wire = provider.plannerRequest(message, IMAGE_PLANNING_MODEL, request.kind === 'carousel' ? 16000 : 4000);
  const format = wire.body.text?.format;
  return {model: wire.body.model, reasoning: wire.body.reasoning ?? null, max_output_tokens: wire.body.max_output_tokens, schema: format ? {name: format.name, strict: format.strict, required: format.schema.required ?? Object.keys(format.schema)} : null, input_items: wire.body.input.length, body_bytes: Buffer.byteLength(JSON.stringify(wire.body)), tools: wire.body.tools.map(t => t.name)};
}

/** The real provider with a transport that records the request and answers with a blank PNG of the asked size. */
function capturingProvider(log) {
  return new CreativeProvider(undefined, new OpenAI({apiKey: 'mock-only', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname, entry = {path, fields: {}, images: []};
    if (init.body instanceof FormData) {
      for (const [key, value] of init.body.entries()) {
        if (typeof value === 'string') entry.fields[key] = value;
        else {const bytes = Buffer.from(await value.arrayBuffer()), m = await sharp(bytes).metadata(); entry.images.push({field: key, name: value.name, type: value.type, bytes: bytes.length, width: m.width, height: m.height, sha256: sha(bytes)});}
      }
    } else entry.fields = JSON.parse(init.body);
    log.push(entry);
    const [width, height] = String(entry.fields.size).split('x').map(Number);
    const out = await sharp({create: {width, height, channels: 3, background: '#808080'}}).png().toBuffer();
    return Response.json({created: 1, data: [{b64_json: out.toString('base64')}], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}});
  }}));
}

/** References that count as scene content when deciding whether stock is needed (creative-jobs rule). */
const sceneReferences = references => references.length;

async function imageAudit(request, b, provider, log) {
  const brief = request.kind === 'carousel' ? carouselSlideBrief(carouselPlan(b), 0) : b.static.brief;
  const references = await referenceSet(b, request.references);
  const skip = stockSkipReason({imagePrompt: brief.image_prompt, orientation: 'vertical', edit: false, brandReferences: sceneReferences(references), layoutArchetype: brief.art_direction?.layout_archetype, carouselPosition: request.kind === 'carousel' ? 0 : null});
  const stock = request.stock && !skip ? {photo: await stockPhoto(), use: request.stock} : null;
  const moodboard = {...b.moodboard, ...(await moodboardImages(b))};
  const placement = normalizeCreativeSpec(request.spec, request.kind === 'carousel' ? 'carousel' : 'static', b.channel);
  const quality = recommendedGrants().creative.quality ?? 'medium';
  const plan = await imageCallPlan({brief, facts: b.facts, learning: b.learning, prompt: b.static.prompt, references, stock, moodboard, placement, model: MODEL_POLICY.image.model, quality, parent: null, carouselPosition: request.kind === 'carousel' ? 0 : null});
  log.length = 0;
  const output = await plan.render(provider, 'a'.repeat(64));
  const sent = log.at(-1);
  return {model: sent.fields.model, size: sent.fields.size, quality: sent.fields.quality, output_format: sent.fields.output_format, endpoint: sent.path, prompt: sent.fields.prompt, images: sent.images.map((image, i) => ({...image, role: plan.manifest[i]?.kind ?? 'unknown', label: plan.manifest[i]?.label ?? null})), stock: stock ? request.stock : (request.stock ? `skipped: ${skip}` : 'not requested'), stored: {width: output.width, height: output.height, master: output.master ?? null, logo: output.logo ?? null}, manifest: plan.manifest};
}

function markdown(results) {
  const lines = ['# What the model sees (mock run)', '', `Generated ${new Date().toISOString()} by \`node scripts/quality-eval-dump.mjs\`. Image model policy: \`${MODEL_POLICY.image.model}\`; brief model \`${IMAGE_PLANNING_MODEL}\`.`, ''];
  for (const r of results) {
    lines.push(`## ${r.id} (${r.business})`, '', '### (a) Skill sandbox', '');
    if (r.sandbox.skipped) lines.push('_Sandbox not run (--no-sandbox)._', '');
    else {
      const sys = r.sandbox.messages.find(m => m.system)?.system;
      lines.push(`- Skills pinned: ${r.sandbox.skills.join(', ')}`, `- Model calls: ${r.sandbox.model_calls}`, `- Reads manifest (${r.sandbox.reads.length}): ${r.sandbox.reads.map(p => '`' + p + '`').join(', ')}`,
        `- System prompt: ${sys?.chars} chars, own prompt \`${sys?.own_prompt}\`, sha256 \`${sys?.sha256.slice(0, 16)}…\``,
        `- Preloaded references in the system prompt: ${sys?.preloaded_reference_paths.map(p => '`' + p + '`').join(', ') || 'none'}`,
        `- System prompt markers: ${Object.entries(sys?.markers ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `- Messages: ${r.sandbox.messages.map(m => `${m.role}(${m.chars})`).join(', ')}; tools: ${r.sandbox.tools.join(', ')}`,
        `- Business data keys: ${r.sandbox.business_data_keys.join(', ')}; brand keys: ${r.sandbox.brand_keys.join(', ')}`, '',
        '<details><summary>Brand JSON sent to the sandbox</summary>', '', '```json', JSON.stringify(r.sandbox.brand_json, null, 1), '```', '</details>', '');
    }
    lines.push('### (b) Brief model call', '', '```json', JSON.stringify(r.brief, null, 1), '```', '', '### (c) Image call', '',
      `- Endpoint \`${r.image.endpoint}\`, model \`${r.image.model}\`, size \`${r.image.size}\`, quality \`${r.image.quality}\`, output_format \`${r.image.output_format}\``,
      `- Stock: ${r.image.stock}`,
      `- Stored creative: ${r.image.stored.width}x${r.image.stored.height}${r.image.stored.master ? `; master ${r.image.stored.master.width}x${r.image.stored.master.height}` : ''}${r.image.stored.logo ? `; logo composited at ${r.image.stored.logo.placement}` : ''}`,
      `- Reference images (${r.image.images.length}):`, ...r.image.images.map((im, i) => `  ${i + 1}. ${im.role} — "${im.label}" — ${im.width}x${im.height} ${im.type}, ${im.bytes} bytes`), '',
      '<details><summary>Full image prompt</summary>', '', '```text', r.image.prompt, '```', '</details>', '');
  }
  return lines.join('\n');
}

async function main() {
  const runtime = args.includes('--no-sandbox') ? null : new SkillRuntime((await import('./skill-test-image.mjs')).prepareSkillImage());
  const log = [], provider = capturingProvider(log), results = [];
  for (const request of AUDIT_REQUESTS) {
    const b = business(request.business);
    const sandbox = runtime ? await sandboxAudit(runtime, request, b) : {skipped: true};
    const first = sandbox.first_request ?? {type: 'model', step: 1, messages: [{role: 'user', content: 'UNTRUSTED BUSINESS DATA AND REQUEST:\n{}'}], tools: []};
    delete sandbox.first_request;
    results.push({id: request.id, business: b.name, sandbox, brief: briefWire(provider, request, b, first), image: await imageAudit(request, b, provider, log)});
  }
  await mkdir(dirname(OUT), {recursive: true});
  await writeFile(OUT, markdown(results));
  await writeFile(OUT.replace(/\.md$/, '.json'), JSON.stringify(results, null, 1));
  process.stdout.write(`Wrote ${OUT} for ${BUSINESSES.length} fixture businesses\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
