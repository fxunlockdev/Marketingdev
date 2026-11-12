import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learnedPreferences,slotFormat,slotSources,planPostMutations,PLANNER_PREFERENCES} from '../../dist/planning-knowledge.js';
import {planningContext} from '../../dist/planning-contracts.js';
import {strategySnapshot} from '../../dist/strategy-contracts.js';
import {generatedStrategy} from '../fixtures/strategy.mjs';

const statement=(kind,text)=>({kind,statement:text,count:2,of:3,recent:1,last_seen:'2026-11-01T00:00:00.000Z'});

test('preference signals become soft prefer/avoid constraints the planner contract accepts',()=>{
 const out=learnedPreferences([statement('rejection_reason','Rejection reasons mention stock imagery: 2 of 3'),statement('decision','Rejects carousel posts: 3 of 4'),statement('decision','Approves "Tips" posts: 4 of 5'),statement('edit','Shortens headlines when editing: 2 of 2'),statement('regeneration','Asks for a new version instead of approving: 2 of 5'),statement('stock','Swaps the suggested stock photo: 2 of 2')]);
 assert.deepEqual(out.map(p=>p.kind),['avoid','avoid','prefer','prefer','avoid','avoid']);
 assert.deepEqual(planningContext({preferences_learned:out}).preferences_learned,out);
 assert.equal(learnedPreferences(Array(30).fill(statement('edit','x'))).length,PLANNER_PREFERENCES);
});

test('a planned slot links to the strategy items and format it was planned from, by the keys the strategy was stored under',()=>{
 const input={brand:{facts:[{id:'f'}]}},strategy=generatedStrategy(input),snapshot=strategySnapshot({id:'00000000-0000-4000-8000-000000000001',version:1,sha256:'0'.repeat(64),strategy});
 const angle=snapshot.angles[0],slot={id:'00000000-0000-4000-8000-0000000000aa',hook:'TEST hook',format:'static',pillar:snapshot.pillars[0].name.toUpperCase(),creative_spec:null,strategy_ref:{persona_id:angle.persona_id,pain_id:angle.pain_id,angle_id:angle.id}};
 assert.equal(slotFormat({format:'video'}),'reel');assert.equal(slotFormat({format:'static',creative_spec:{placement:'story'}}),'story');assert.equal(slotFormat({format:'carousel'}),'carousel');
 const sources=slotSources(slot,snapshot).map(r=>`${r.type}:${r.key}`);
 assert.deepEqual(sources,['format:static','persona:test-careful-busy-owner-1','pain:test-pain-1-of-persona-1','angle:test-angle-1-for-persona-1','pillar:test-pillar-1']);
 assert.deepEqual(slotSources({...slot,strategy_ref:null,pillar:'other'}).map(r=>r.type),['format']);
 const m=planPostMutations('00000000-0000-4000-8000-0000000000ff',[slot,{...slot,id:'00000000-0000-4000-8000-0000000000bb',hook:''}],snapshot,new Set(['format:static','angle:test-angle-1-for-persona-1']));
 assert.equal(m.nodes.length,2);assert.ok(m.nodes.every(n=>n.type==='post'&&n.status==='suggested'&&n.evidence[0].jobId==='00000000-0000-4000-8000-0000000000ff'));
 assert.equal(m.nodes[1].label,'Planned post');
 assert.deepEqual(m.edges.map(e=>`${e.from.type}>${e.relation}>${e.to.type}`),['format>used_in>post','angle>used_in>post','format>used_in>post','angle>used_in>post'],'only nodes that exist are linked');
});
