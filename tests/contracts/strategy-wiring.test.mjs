import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchEvidence,marketNotes,evidenceOrigin,EVIDENCE_SHARE} from '../../dist/strategy-evidence.js';
import {strategyMutations,strategyNodeRef} from '../../dist/strategy-graph.js';
import {validateStrategyInput} from '../../dist/strategy-contracts.js';
import {generatedStrategy} from '../fixtures/strategy.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const job=uuid(999);
const research={sources:[
 {id:uuid(1),market:false,url:'https://clinic.example/about',text:'TEST FIXTURE: We book\nappointments\tonline.'},
 {id:uuid(2),market:true,url:'https://review.example/x',text:'TEST FIXTURE: Patients complain about phone queues.'},
 {id:uuid(3),market:false,url:null,text:'   '},
 {id:'not-a-uuid',market:false,url:null,text:'TEST FIXTURE: dropped'},
],direction:{job_id:job,audience_suggestions:['TEST FIXTURE: Busy clinic managers'],competitor_gaps:['TEST FIXTURE: Nobody shows wait times']}};

test('saved research becomes bounded, labelled strategy evidence that passes the strategy input contract',()=>{
 const evidence=researchEvidence(research);
 assert.deepEqual(evidence.map(e=>[e.id,e.kind]),[[uuid(1),'own_site'],[uuid(2),'market_research'],[`analysis:${job}:audience:1`,'audience_suggestion'],[`analysis:${job}:gap:1`,'competitor_gap']]);
 assert.equal(evidence[0].summary,'https://clinic.example/about: TEST FIXTURE: We book appointments online.');
 const input={task:'strategy',brand:{id:'b',sha256:'0'.repeat(64),facts:[{id:'f',field:'offering',value:'x'}]},preferences:{},evidence};
 assert.equal(validateStrategyInput(input),input);
 // Shares: own-site evidence cannot crowd out market notes and analysis suggestions.
 const many={sources:[...Array.from({length:80},(_,i)=>({id:uuid(100+i),market:false,url:null,text:'o'.repeat(900)})),...Array.from({length:40},(_,i)=>({id:uuid(300+i),market:true,url:null,text:'m'}))],direction:{job_id:job,audience_suggestions:Array(20).fill('a'),competitor_gaps:[]}};
 const bounded=researchEvidence(many);
 assert.equal(bounded.length,60);assert.equal(bounded.filter(e=>e.kind==='own_site').length,EVIDENCE_SHARE.own);assert.equal(bounded.filter(e=>e.kind==='market_research').length,EVIDENCE_SHARE.market);
 assert.ok(bounded.every(e=>e.summary.length<=600));
 assert.deepEqual(researchEvidence({sources:[]}),[]);
});

test('market notes are labelled third-party and bounded; evidence ids map back to sources or the analysis job',()=>{
 const notes=marketNotes(research);
 assert.equal(notes.length,2);assert.match(notes[0],/^Market research \(third-party, not a brand fact\): https:\/\/review\.example/);assert.match(notes[1],/unproven/);
 assert.ok(marketNotes({sources:Array.from({length:30},(_,i)=>({id:uuid(i),market:true,url:null,text:'x'.repeat(2000)}))}).every(n=>n.length<=800));
 assert.equal(marketNotes({sources:Array.from({length:30},(_,i)=>({id:uuid(i),market:true,url:null,text:'x'}))},50).length,20);
 assert.deepEqual(evidenceOrigin(uuid(2)),{sourceId:uuid(2)});
 assert.deepEqual(evidenceOrigin(`analysis:${job}:gap:1`),{jobId:job});
 assert.equal(evidenceOrigin('ev_1'),undefined);
});

test('an approved strategy maps to graph mutations: proven items approved, unproven suggested, citations resolved or skipped',()=>{
 const input={task:'strategy',brand:{id:'b',sha256:'0'.repeat(64),facts:[{id:'fact-offer',field:'offering',value:'x'}]},preferences:{},evidence:[{id:uuid(2),kind:'market_research',summary:'s'}]};
 const strategy=generatedStrategy(input);
 const offer={type:'offer',key:'offering'};
 const m=strategyMutations(strategy,{facts:new Map([['fact-offer',offer]]),evidence:new Map([[uuid(2),{sourceId:uuid(2),excerpt:'s'}]])});
 const persona=m.nodes.find(n=>n.type==='persona'&&n.label==='TEST Careful Busy Owner 1');
 assert.equal(persona.status,'approved');assert.equal(persona.origin,'extracted');assert.deepEqual(persona.evidence,[{sourceId:uuid(2),excerpt:'s'}]);assert.equal(persona.key,'test-careful-busy-owner-1');
 assert.equal(m.nodes.find(n=>n.label==='TEST Careful Busy Owner 2').status,'suggested');
 assert.ok(m.nodes.filter(n=>n.status==='suggested').every(n=>n.confidence===0.7&&n.origin==='inferred'));
 assert.equal(new Set(m.nodes.map(n=>n.type)).size,5);
 // Strategy relations use the graph's own vocabulary and direction.
 const rel=new Set(m.edges.map(e=>e.relation));for(const r of rel)assert.ok(['has_pain','solves','targets','related_to','proves'].includes(r),r);
 const solves=m.edges.find(e=>e.relation==='solves');assert.equal(solves.from.type,'angle');assert.equal(solves.to.type,'pain');
 const proves=m.edges.filter(e=>e.relation==='proves');assert.ok(proves.length>0&&proves.every(e=>e.from===offer));
 // A citation without a target is skipped, never left dangling.
 const bare=strategyMutations(strategy,{facts:new Map(),evidence:new Map()});
 assert.equal(bare.edges.filter(e=>e.relation==='proves').length,0);assert.ok(bare.nodes.every(n=>n.evidence.length===0));
 const known=new Set(bare.nodes.map(n=>`${n.type}:${n.key}`));assert.ok(bare.edges.every(e=>known.has(`${e.from.type}:${e.from.key}`)&&known.has(`${e.to.type}:${e.to.key}`)));
 assert.equal(strategyNodeRef('persona','!!!'),undefined);
 assert.deepEqual(strategyNodeRef('format','carousel'),{type:'format',key:'carousel'});
});
