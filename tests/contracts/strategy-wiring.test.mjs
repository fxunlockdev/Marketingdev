import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchEvidence,marketNotes,evidenceOrigin,EVIDENCE_SHARE} from '../../dist/strategy-evidence.js';
import {validateStrategyInput} from '../../dist/strategy-contracts.js';

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

