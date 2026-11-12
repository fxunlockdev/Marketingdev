import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STRATEGY_SKILLS,STRATEGY_VERSION,validateStrategyInput,validateStrategy,validateStrategyResult,strategySchema,strategySnapshot,validateStrategySnapshot} from '../../dist/strategy-contracts.js';
import {strategyToGraph} from '../../dist/strategy-graph.js';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {generatedStrategy} from '../fixtures/strategy.mjs';

const input={task:'strategy',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'},{id:'audience',field:'audience',value:'Clinic owners'}]},preferences:{goal:'awareness',channels:['instagram'],must_avoid:''},evidence:[{id:'ev_1',kind:'review',summary:'Owners say booking by phone eats their mornings.'}]};
const result=strategy=>({type:'result',version:STRATEGY_VERSION,strategy,skills:Object.entries(STRATEGY_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(STRATEGY_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false});

test('the strategy task pins the four strategy skills, Brand Engine and the production rules',()=>{
 assert.deepEqual(Object.keys(STRATEGY_SKILLS).sort(),['brand-engine','content-strategy','customer-research','desvio-production','marketing-psychology','product-marketing']);
 for(const pin of Object.values(STRATEGY_SKILLS)){assert.match(pin.skill_sha256,/^[a-f0-9]{64}$/);assert.match(pin.tree_sha256,/^[a-f0-9]{64}$/);}
});

test('strategy input is bounded and typed',()=>{
 assert.equal(validateStrategyInput(input),input);
 const {evidence,...bare}=input;assert.equal(validateStrategyInput(bare),bare);
 for(const patch of [{task:'content_plan'},{evidence:[{id:'ev_1',kind:'review',summary:'a'},{id:'ev_1',kind:'review',summary:'b'}]},{evidence:Array.from({length:61},(_,i)=>({id:`e${i}`,kind:'k',summary:'s'}))},{evidence:[{id:'e',kind:'k',summary:'x'.repeat(601)}]},{context_pack:'text'},{context_pack:{blob:'x'.repeat(60001)}},{market_research:['x'.repeat(801)]},{extra:1},{brand:{...input.brand,facts:[]}}])assert.throws(()=>validateStrategyInput({...input,...patch}),/STRATEGY_INPUT_INVALID/);
 assert.ok(validateStrategyInput({...input,context_pack:{nodes:[1]},market_research:['Local clinics compete on wait time.']}));
});

test('a strategy needs 3-4 personas, pains, angles by awareness level, a format matrix and pillars',()=>{
 const strategy=generatedStrategy(input);
 assert.equal(validateStrategy(strategy,input),strategy);
 const changes=[s=>s.personas.pop(),s=>s.personas.push({...s.personas[0],id:'persona_4'},{...s.personas[0],id:'persona_5'}),s=>s.personas[0].name='Unaware Owner',s=>s.personas[1].id='persona_1',
  s=>s.pains=s.pains.filter(p=>p.persona_id!=='persona_3'),s=>s.pains[0].persona_id='persona_9',s=>s.angles[0].pain_id='pain_3',s=>s.angles[0].awareness='curious',s=>s.angles[1].awareness=s.angles[0].awareness,
  s=>s.formats.pop(),s=>s.formats[0].format='billboard',s=>s.formats[1].angle_id=s.formats[0].angle_id,s=>s.pillars=s.pillars.slice(0,2),s=>s.pillars[0].persona_ids=['persona_9'],s=>s.summary='',s=>s.extra=true,s=>s.personas[0].id='p1'];
 for(const change of changes){const bad=structuredClone(strategy);change(bad);assert.throws(()=>validateStrategy(bad,input),/STRATEGY_OUTPUT_INVALID/);}
});

test('every item cites approved facts or research evidence, or is labelled unproven',()=>{
 const strategy=generatedStrategy(input);
 assert.ok(strategy.personas.some(p=>p.basis==='proven'&&p.evidence_ids[0]==='ev_1'));assert.ok(strategy.pains.some(p=>p.basis==='unproven'));
 const changes=[s=>s.personas[0].fact_ids=['invented'],s=>s.personas[0].evidence_ids=['ev_404'],s=>{s.pains[0].basis='proven';s.pains[0].fact_ids=[];s.pains[0].evidence_ids=[];},s=>delete s.angles[0].basis,s=>s.pillars[0].fact_ids.push(s.pillars[0].fact_ids[0])];
 for(const change of changes){const bad=structuredClone(strategy);change(bad);assert.throws(()=>validateStrategy(bad,input),/STRATEGY_OUTPUT_INVALID/);}
});

test('the sandbox result must carry the pinned skills and only permitted reads',()=>{
 const value=result(generatedStrategy(input));
 assert.equal(validateStrategyResult(value,input).strategy.personas.length,3);
 for(const change of [v=>v.skills[0].tree_sha256='wrong',v=>v.reads.pop(),v=>v.reads.push('/etc/passwd'),v=>v.reads.push('/skills/image/SKILL.md'),v=>v.helpers_executed=true,v=>v.model_calls=4,v=>v.version='deepagents-0.7.29/desvio-plan-v1']){const bad=structuredClone(value);change(bad);assert.throws(()=>validateStrategyResult(bad,input),/SKILL_/);}
});

test('the provider request constrains citations to supplied ids and uses strict JSON',()=>{
 const schema=strategySchema(input);
 assert.deepEqual(schema.$defs.factId.enum,['offering','audience']);assert.deepEqual(schema.$defs.evidenceId.enum,['ev_1']);
 assert.equal(schema.properties.personas.minItems,3);assert.equal(schema.properties.personas.maxItems,4);
 const wire=new CreativeProvider().plannerRequest({type:'model',step:1,messages:[{role:'user',content:'x'}],tools:[],content_plan_schema:schema},'gpt-6-astra',16000);
 assert.equal(wire.body.text.format.strict,true);assert.equal(wire.body.model,'gpt-6-astra');
 const {evidence,...bare}=input;assert.equal(strategySchema(bare).properties.personas.items.properties.evidence_ids.maxItems,0);
});

test('an approved strategy becomes a compact, checked snapshot for the planner',()=>{
 const strategy=generatedStrategy(input),snapshot=strategySnapshot({id:'5f0c8a0e-6c0f-4c7e-9a52-0d4f6a6f1b11',version:2,sha256:'a'.repeat(64),strategy});
 assert.equal(validateStrategySnapshot(snapshot),snapshot);assert.equal(snapshot.personas[0].name,strategy.personas[0].name);assert.equal(snapshot.angles[0].awareness,'problem_aware');
 assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<Buffer.byteLength(JSON.stringify(strategy)));
 for(const change of [s=>s.sha256='x',s=>s.personas=[],s=>s.angles[0].persona_id='persona_9',s=>s.extra=1,s=>s.pains[0].statement='x'.repeat(100000)]){const bad=structuredClone(snapshot);change(bad);assert.throws(()=>validateStrategySnapshot(bad),/STRATEGY_SNAPSHOT_INVALID/);}
});

test('strategyToGraph maps the strategy to plain nodes and edges without mutating it',()=>{
 const strategy=generatedStrategy(input),before=structuredClone(strategy),graph=strategyToGraph(strategy);
 assert.deepEqual(strategy,before);
 const types=type=>graph.nodes.filter(n=>n.type===type).length;
 assert.deepEqual([types('persona'),types('pain'),types('angle'),types('format'),types('pillar')],[3,6,6,6,3]);
 assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);
 const ids=new Set(graph.nodes.map(n=>n.id));
 assert.ok(graph.edges.filter(e=>e.type!=='supported_by').every(e=>ids.has(e.source)&&ids.has(e.target)));
 const has=(source,type,target)=>graph.edges.some(e=>e.source===source&&e.type===type&&e.target===target);
 assert.ok(has('persona_1','has_pain','pain_1'));assert.ok(has('pain_1','addressed_by','angle_1'));assert.ok(has('persona_1','targeted_by','angle_1'));assert.ok(has('angle_1','delivered_as','format_1'));assert.ok(has('pillar_1','serves','persona_1'));
 assert.ok(has('persona_1','supported_by','fact:offering'));assert.ok(has('persona_1','supported_by','evidence:ev_1'));
 assert.equal(graph.nodes.find(n=>n.id==='persona_1').confidence,'EXTRACTED');assert.equal(graph.nodes.find(n=>n.id==='persona_2').confidence,'INFERRED');
 assert.deepEqual(JSON.parse(JSON.stringify(graph)),graph,'plain data only');
});
