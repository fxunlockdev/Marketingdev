import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGeneratedPlan} from '../../dist/planning-contracts.js';
import {planningSchema,validateStoryline,storylineKind,LAYOUT_ARCHETYPES} from '../../dist/planning-schema.js';
import {normalizeContentMix,contentMixCounts} from '../../dist/generation-plan.js';
import {generatedPlan} from '../fixtures/planning.mjs';

const base={task:'content_plan',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['instagram'],must_avoid:'',revision:1},brief:'Plan',post_count:30};
const rows=[['static','feed','square',null],['carousel','feed','portrait',4],['static','story','vertical',null],['video','reel','vertical',null]].map(([format,placement,aspect,slide_count])=>({channel:'instagram',format,creative_spec:{placement,aspect,slide_count},count:1}));
const mix=normalizeContentMix(rows);
const context={...structuredClone(base),duration_days:7,...contentMixCounts(mix),content_mix:mix,storylines:true};

test('the image agent layout enum is shared',()=>{
 assert.deepEqual([...LAYOUT_ARCHETYPES],['lifestyle_hero','product_hero','type_led_poster','comparison','offer','quote']);
});

test('every format maps to one storyline kind',()=>{
 assert.equal(storylineKind('static',{placement:'feed'}),'static');assert.equal(storylineKind('static',{placement:'story'}),'story');
 assert.equal(storylineKind('carousel',{placement:'feed'}),'carousel');assert.equal(storylineKind('video',{placement:'reel'}),'video');
 assert.equal(storylineKind('static',undefined),'static');assert.equal(storylineKind('video',undefined),'video');
});

test('a plan that asks for storylines needs a valid one on every slot',()=>{
 const plan=generatedPlan(context);
 assert.equal(validateGeneratedPlan(plan,context).slots.length,4);
 assert.deepEqual(plan.slots.map(s=>s.storyline.kind),['static','carousel','story','video']);
 assert.equal(plan.slots[1].storyline.slides.length,4);
 assert.ok(plan.slots[3].video_draft&&plan.slots[3].storyline.shots.length>=2,'video keeps its draft and gains shots');
 const changes=[p=>delete p.slots[0].storyline,p=>p.slots[0].storyline.layout_archetype='collage',p=>p.slots[0].storyline.concept='',p=>p.slots[0].storyline.on_image_copy.headline='x'.repeat(81),p=>p.slots[0].storyline.extra=1,
  p=>p.slots[0].storyline=p.slots[1].storyline,p=>p.slots[1].storyline.slides.pop(),p=>p.slots[1].storyline.slides[0].role='filler',p=>p.slots[2].storyline.frames=[],p=>p.slots[3].storyline.shots=[p.slots[3].storyline.shots[0]],p=>p.slots[3].storyline.shots[0].visual='bad\u0000'];
 for(const change of changes){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateGeneratedPlan(bad,context),/PLAN_OUTPUT_INVALID/);}
});

test('plans requested before storylines existed stay valid and may not smuggle one in',()=>{
 const legacy={...context};delete legacy.storylines;
 const plan=generatedPlan(legacy);assert.equal(plan.slots[0].storyline,undefined);assert.equal(validateGeneratedPlan(plan,legacy).slots.length,4);
 const extra=generatedPlan(context);assert.throws(()=>validateGeneratedPlan(extra,legacy),/PLAN_OUTPUT_INVALID/);
 const old={...structuredClone(base)};assert.equal(validateGeneratedPlan(generatedPlan(old),{...old,preferences:{...old.preferences,channels:['instagram']}}).slots.length,30);
});

test('the provider schema requires the storyline that fits each slot',()=>{
 const variants=planningSchema(context).properties.slots.items.anyOf;
 assert.deepEqual(variants.map(v=>v.properties.storyline.properties.kind.enum[0]),['static','carousel','story','video']);
 assert.ok(variants.every(v=>v.required.includes('storyline')));
 assert.deepEqual(variants[0].properties.storyline.properties.layout_archetype.enum,[...LAYOUT_ARCHETYPES]);
 assert.equal(variants[1].properties.storyline.properties.slides.minItems,4);assert.equal(variants[1].properties.storyline.properties.slides.maxItems,4);
 const legacy={...context};delete legacy.storylines;
 assert.ok(planningSchema(legacy).properties.slots.items.anyOf.every(v=>!v.properties.storyline));
 const ideas={...context,post_ideas:{plan_id:'p',format:'static',channel:'instagram'}};delete ideas.storylines;
 assert.ok(planningSchema(ideas).properties.slots.items.anyOf.every(v=>!v.properties.storyline));
});

test('customer edits are checked against the slot format',()=>{
 const plan=generatedPlan(context);
 for(const slot of plan.slots)assert.deepEqual(validateStoryline(slot.storyline,slot.format,slot.creative_spec),slot.storyline);
 assert.throws(()=>validateStoryline(plan.slots[0].storyline,'carousel',plan.slots[1].creative_spec),/STORYLINE_INVALID/);
 assert.throws(()=>validateStoryline({...plan.slots[1].storyline,slides:plan.slots[1].storyline.slides.slice(0,3)},'carousel',plan.slots[1].creative_spec),/STORYLINE_INVALID/);
 assert.throws(()=>validateStoryline(null,'static',undefined),/STORYLINE_INVALID/);
});
