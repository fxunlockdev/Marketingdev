import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseSignal,recordSignal,summariseSignals,signalSummary,signalDiff,SignalError,recentSignalsSQL} from '../../dist/learning-signals.js';

const slot='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-11-12T12:00:00.000Z'),daysAgo=d=>new Date(now.getTime()-d*86400000).toISOString();
const row=(kind,over={},days=1)=>({kind,reason:'',diff:{},context:{},created_at:daysAgo(days),...over});

test('signals are validated and bounded before they are stored',()=>{
 const s=normaliseSignal({kind:'edited',slot_id:slot.toUpperCase(),creative_version_id:version,reason:'  too\u0000 long '+'x'.repeat(2000),diff:{headline:{before:'A very long headline',after:'Short'},caption:{before:'same',after:'same'},secret:{before:'a',after:'b'},cta:{before:'y'.repeat(900),after:''}},context:{format:'carousel',stock_used:true,junk:'x',pillar:7}});
 assert.equal(s.slot_id,slot);assert.equal(s.version_kind,'creative');assert.equal(s.reason.length,1000);assert.ok(!s.reason.includes('\u0000'));
 assert.deepEqual(Object.keys(s.diff),['headline','cta']);assert.equal(s.diff.cta.before.length,500);assert.deepEqual(s.context,{format:'carousel',stock_used:true});
 for(const bad of [{kind:'liked',slot_id:slot},{kind:'approved'},{kind:'approved',slot_id:'nope'},{kind:'approved',creative_version_id:version,version_kind:'pdf'},null])assert.throws(()=>normaliseSignal(bad),SignalError);
 assert.deepEqual(signalDiff('garbage'),{});
});
test('recordSignal appends one row for the acting user in the given business',async()=>{
 const calls=[],db={query:async(sql,params)=>{calls.push([sql,params]);return {rows:[]};}};
 const {id}=await recordSignal(db,{organizationId:'org',brandId:'brand',actorId:'user'},{kind:'rejected',slot_id:slot,reason:'No people please',context:{format:'static'}});
 assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(calls.length,1);assert.match(calls[0][0],/^INSERT INTO app\.creative_signals/);
 assert.deepEqual(calls[0][1].slice(1),['org','brand',slot,null,null,'rejected','No people please','{}','{"format":"static"}','user',null,null]);
 await assert.rejects(recordSignal(db,{organizationId:'org',brandId:'brand',actorId:'user'},{kind:'rejected'}),SignalError);assert.equal(calls.length,1);
});
test('rejection reasons become counted preference statements',()=>{
 const rows=[row('rejected',{reason:'Too many people in the shot'}),row('rejected',{reason:'No faces please'},3),row('rejected',{reason:'I do not want a person here'},40),row('rejected',{reason:'The model looks staged'},50),row('rejected',{reason:'Wrong colour'},60),row('rejected',{},2)];
 const out=summariseSignals(rows,now),people=out.find(s=>s.statement.startsWith('Rejection reasons mention people'));
 assert.deepEqual(people,{kind:'rejection_reason',statement:'Rejection reasons mention people: 4 of 5 rejections with a reason',count:4,of:5,recent:2,last_seen:daysAgo(1)});
 assert.ok(!out.some(s=>s.statement.includes('colour')),'a single mention is not a preference');
});
test('edits show direction: shortens headlines when editing',()=>{
 const edit=(before,after,days)=>row('edited',{diff:{headline:{before,after}}},days);
 const out=summariseSignals([edit('A long winded headline about things','Short one',1),edit('Another long headline here','Tight',2),edit('Third headline that rambles','Crisp',3),edit('Tiny','A somewhat longer headline',4)],now);
 assert.deepEqual(out.map(s=>s.statement),['Shortens headlines when editing: 3 of 4 headline edits']);
});
test('decisions are summarised by what the creative was, with thresholds against tiny samples',()=>{
 const d=(kind,context,days=1)=>row(kind,{context},days);
 const out=summariseSignals([d('rejected',{stock_used:true}),d('rejected',{stock_used:true}),d('rejected',{stock_used:true}),d('approved',{stock_used:true}),d('approved',{format:'carousel'}),d('approved',{format:'carousel'}),d('approved',{format:'carousel'}),d('rejected',{format:'video'}),d('rejected',{format:'video'})],now).map(s=>s.statement);
 assert.deepEqual(out,['Approves carousel posts: 3 of 3 decisions','Rejects posts using stock photos: 3 of 4 decisions']);
});
test('regenerations and stock swaps are counted; output is deterministic, windowed and bounded',()=>{
 const rows=[row('regenerated'),row('regenerated',{},2),row('approved',{context:{stock_used:true}}),row('stock_swapped'),row('stock_swapped',{},5),row('regenerated',{},400),row('bogus'),row('approved',{created_at:'not a date'})];
 const out=summariseSignals(rows,now);
 assert.deepEqual(out.map(s=>s.statement),['Asks for a new version instead of approving: 2 of 3 regenerations and approvals','Swaps the suggested stock photo: 2 of 3 stock photo decisions']);
 assert.deepEqual(summariseSignals([...rows].reverse(),now),out);assert.deepEqual(summariseSignals([],now),[]);
 const many=['people','stock','headline','colour','logo','salesy','wordy','cluttered','people'].flatMap(w=>[row('rejected',{reason:w}),row('rejected',{reason:w})]);
 assert.ok(summariseSignals(many,now).length<=8);
});
test('signalSummary reads a bounded recent window',async()=>{
 let seen;const db={query:async(sql,params)=>{seen=[sql,params];return {rows:[row('regenerated'),row('regenerated')]};}};
 const out=await signalSummary(db,now);assert.equal(out.length,1);assert.equal(seen[0],recentSignalsSQL);assert.deepEqual(seen[1],[now.toISOString()]);assert.match(recentSignalsSQL,/LIMIT 500/);
});

test('mood board and plan signals name their subject; change requests and retries are their own kinds',()=>{
 const board='33333333-3333-4333-8333-333333333333';
 const s=normaliseSignal({kind:'changes_requested',subject_kind:'moodboard',subject_id:board,reason:'Warmer light'});
 assert.equal(s.subject_kind,'moodboard');assert.equal(s.subject_id,board);assert.equal(s.slot_id,null);assert.equal(s.kind,'changes_requested');
 assert.equal(normaliseSignal({kind:'retried',subject_kind:'plan',subject_id:board}).kind,'retried');
 for(const bad of [{kind:'approved',subject_kind:'moodboard'},{kind:'approved',subject_id:board},{kind:'approved',subject_kind:'campaign',subject_id:board}])assert.throws(()=>normaliseSignal(bad),SignalError);
});
test('topic, brief and storyline diffs stay under the stored byte limit even with wide characters',()=>{
 const wide='\u{1F600}'.repeat(600),diff=signalDiff({brief:{before:wide,after:'b'+wide},pillar:{before:wide,after:'p'},hook:{before:wide,after:'h'},cta:{before:wide,after:'c'},storyline:{before:wide,after:'s'+wide},headline:{before:wide,after:'x'}});
 assert.deepEqual(Object.keys(diff).sort(),['brief','cta','headline','hook','pillar','storyline']);
 assert.ok(Buffer.byteLength(JSON.stringify(diff))<=7000,'fits the 8000-byte column check');
 assert.deepEqual(signalDiff({storyline:{before:'Open on the shop',after:'Open on the owner'}}),{storyline:{before:'Open on the shop',after:'Open on the owner'}});
});
