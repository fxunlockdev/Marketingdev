import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyReview,proposeChanges,localMonth,monthPublishedSQL} from '../../dist/learning-review.js';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now=new Date('2026-11-12T12:00:00.000Z');
const pub=(n,day,over={})=>({publication_id:uuid(n),caption:'c'+n,scheduled_at:`2026-10-${day}T09:00:00.000Z`,release_url:`https://instagram.com/p/${n}`,account_id:'acc',provider:'instagram',account_name:'a',slot_format:'static',carousel_version_id:n>3?uuid(100+n):null,channel:'instagram',timezone:'UTC',pillar:n>3?'Education':'Offers',...over});
const rows=[pub(1,'02'),pub(2,'05'),pub(3,'09'),pub(8,'12'),pub(9,'15'),pub(20,'20'),pub(30,'31',{scheduled_at:'2026-10-31T23:30:00.000Z',timezone:'Europe/Riga'})];
const feed=[{account_id:'acc',updated_at:'2026-11-05T09:00:00.000Z',posts:[1,2,3,8,9].map(n=>({id:'f'+n,account_id:'acc',caption:'c'+n,posted_at:null,url:`https://instagram.com/p/${n}`,metrics:{likes:n}}))}];
const signals=['No people','No faces'].map(reason=>({kind:'rejected',reason,diff:{},context:{},created_at:'2026-10-20T00:00:00.000Z'}));
const db=()=>{const seen=[];return {seen,query:async(sql,params)=>{seen.push([sql,params]);return {rows:sql===monthPublishedSQL?rows:sql.includes('postforme_analytics')?feed:sql.includes('creative_signals')?signals:[]};}};};
test('the monthly review reports what was published, what sat above or below the own median, signals and 3-5 proposals',async()=>{
 const d=db(),r=await monthlyReview(d,{timezone:'UTC'},'2026-10',{now});
 assert.equal(r.month,'2026-10');assert.equal(r.published.length,6,'a post on 1 November local time belongs to November');
 assert.deepEqual(r.performance.groups,[{provider:'instagram',metric:'likes',median:3,sample_size:5}]);
 assert.deepEqual(r.performance.above,[uuid(8),uuid(9)]);assert.deepEqual(r.performance.below,[uuid(1),uuid(2)]);
 assert.equal(r.performance.compared,5);assert.equal(r.performance.not_compared,1);assert.equal(r.performance.label,'unproven, small sample');
 assert.equal(r.published.find(p=>p.publication_id===uuid(20)).metrics,null,'a post without a reading has no metrics, not zeros');
 assert.equal(r.published.find(p=>p.publication_id===uuid(20)).relative,'not_compared');
 assert.deepEqual(r.signals.map(s=>s.statement),['Rejection reasons mention people: 2 of 2 rejections with a reason']);
 assert.ok(r.proposed_changes.length>=3&&r.proposed_changes.length<=5);
 assert.ok(r.proposed_changes.some(c=>c.action==='do_more'&&c.text.includes('carousel')&&c.sample_size===2&&c.label==='unproven, small sample'));
 assert.ok(r.proposed_changes.some(c=>c.action==='do_less'&&c.text.includes('static')));assert.ok(r.proposed_changes.some(c=>c.action==='respect_preference'));
 assert.equal(r.summary,null);assert.deepEqual(d.seen[0][1],['2026-09-30T00:00:00.000Z','2026-11-02T00:00:00.000Z']);
 assert.deepEqual(await monthlyReview(db(),{timezone:'UTC'},'2026-10',{now}),r,'deterministic');
});
test('an empty month still yields three honest proposals; invalid months are refused',async()=>{
 const empty={query:async()=>({rows:[]})},r=await monthlyReview(empty,{},'2026-09',{now});
 assert.deepEqual(r.published,[]);assert.equal(r.proposed_changes.length,3);assert.ok(r.proposed_changes.every(c=>c.action==='collect_more'));
 for(const bad of ['2026-13','26-10','2026-1',''])await assert.rejects(monthlyReview(empty,{},bad),e=>e.code==='REVIEW_MONTH_INVALID');
 assert.equal(localMonth('2026-10-31T23:30:00.000Z','Europe/Riga'),'2026-11');
 assert.equal(proposeChanges({top:[],bottom:[]},[],{published:4,compared:0,unmeasured:4})[0].text.includes('4 published'),true);
});
test('the optional model-written summary is bounded and never blocks the deterministic review',async()=>{
 let given;const ok=await monthlyReview(db(),{},'2026-10',{now,summarise:async review=>{given=review;return '  October favoured carousels (small sample).  '+'x'.repeat(3000);}});
 assert.equal(ok.summary.length,2000);assert.ok(ok.summary.startsWith('October'));assert.equal(given.month,'2026-10');assert.ok(!('summary' in given));
 const failed=await monthlyReview(db(),{},'2026-10',{now,summarise:async()=>{throw new Error('model down');}});
 assert.equal(failed.summary,null);assert.equal(failed.performance.compared,5);
});
