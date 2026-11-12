import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGeneratedPlan,scheduleGeneratedPlan,planningContext,repeatedAngleFormats} from '../../dist/planning-contracts.js';
import {planningSchema} from '../../dist/planning-schema.js';
import {strategySnapshot} from '../../dist/strategy-contracts.js';
import {generatedPlan} from '../fixtures/planning.mjs';
import {generatedStrategy} from '../fixtures/strategy.mjs';

const brand={id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]};
const strategy=strategySnapshot({id:'5f0c8a0e-6c0f-4c7e-9a52-0d4f6a6f1b11',version:1,sha256:'a'.repeat(64),strategy:generatedStrategy({brand})});
const base={task:'content_plan',brand,preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['linkedin','instagram'],must_avoid:'',revision:1},brief:'Plan',post_count:6,duration_days:30,storylines:true};
const input={...base,strategy,context_pack:{nodes:[{id:'n1',label:'Morning phone queue'}]},market_research:['Local clinics compete on wait time.'],preferences_learned:[{kind:'avoid',statement:'Stock-photo handshakes were rejected twice.'},{kind:'prefer',statement:'Approved posts lead with a question.'}]};

test('optional planner context is type- and size-checked; nothing supplied changes nothing',()=>{
 assert.deepEqual(planningContext({}),{});assert.deepEqual(planningContext(undefined),{});
 const {context_pack,market_research,preferences_learned}=input;
 assert.deepEqual(planningContext({context_pack,market_research,preferences_learned}),{context_pack,market_research,preferences_learned});
 for(const bad of [{context_pack:[1]},{context_pack:'x'},{context_pack:{blob:'x'.repeat(60001)}},{market_research:'note'},{market_research:Array(21).fill('note')},{market_research:['x'.repeat(801)]},{preferences_learned:['prefer questions']},{preferences_learned:[{kind:'always',statement:'x'}]},{preferences_learned:[{kind:'avoid',statement:'x'.repeat(501)}]},{preferences_learned:Array(21).fill({kind:'avoid',statement:'x'})},{unknown:1}])assert.throws(()=>planningContext(bad),/PLAN_CONTEXT_INVALID/);
 const legacy=generatedPlan(base);assert.equal(legacy.slots[0].strategy_ref,undefined);assert.equal(validateGeneratedPlan(scheduleGeneratedPlan(legacy,base),base).slots.length,6);
});

test('with an approved strategy every slot names the persona, pain and angle it serves',()=>{
 const plan=scheduleGeneratedPlan(generatedPlan(input),input);
 assert.ok(plan.slots.every(s=>strategy.angles.some(a=>a.id===s.strategy_ref.angle_id&&a.persona_id===s.strategy_ref.persona_id&&a.pain_id===s.strategy_ref.pain_id)));
 for(const change of [p=>delete p.slots[0].strategy_ref,p=>p.slots[0].strategy_ref.angle_id='angle_99',p=>p.slots[0].strategy_ref.persona_id='persona_3',p=>p.slots[0].strategy_ref.pain_id='pain_6',p=>p.slots[0].strategy_ref.note='x']){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateGeneratedPlan(bad,input),/PLAN_OUTPUT_INVALID/);}
 assert.throws(()=>validateGeneratedPlan(plan,base),/PLAN_OUTPUT_INVALID/,'a strategy reference needs a supplied strategy');
 for(const patch of [{strategy:{...strategy,sha256:'bad'}},{context_pack:'x'},{preferences_learned:[1]}])assert.throws(()=>validateGeneratedPlan(plan,{...input,...patch}),/PLAN_OUTPUT_INVALID/);
});

test('the provider schema limits strategy references to the approved ids',()=>{
 const slot=planningSchema(input).properties.slots.items.anyOf[0];
 assert.deepEqual(slot.properties.strategy_ref.properties.angle_id.enum,strategy.angles.map(a=>a.id));
 assert.deepEqual(slot.properties.strategy_ref.properties.persona_id.enum,strategy.personas.map(p=>p.id));
 assert.ok(slot.required.includes('strategy_ref'));
 assert.equal(planningSchema(base).properties.slots.items.anyOf[0].properties.strategy_ref,undefined);
});

test('a repeated angle and format is reported to the customer, not silently accepted',()=>{
 const varied=generatedPlan(input);assert.deepEqual(repeatedAngleFormats(varied,input),[]);
 const repeated=structuredClone(varied);for(const slot of repeated.slots)slot.strategy_ref={...repeated.slots[0].strategy_ref};
 assert.ok(repeatedAngleFormats(repeated,input).length>0);
 const scheduled=scheduleGeneratedPlan(repeated,input);
 assert.ok(scheduled.warnings.some(w=>/same angle/.test(w)));assert.equal(scheduled.slots.length,6);
 assert.ok(!scheduleGeneratedPlan(varied,input).warnings.some(w=>/same angle/.test(w)));
 // More posts than angles: repeats are unavoidable and only excess repetition is reported.
 const many={...input,post_count:30};assert.deepEqual(repeatedAngleFormats(generatedPlan(many),many),[]);
});
