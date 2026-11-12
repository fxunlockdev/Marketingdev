import test from 'node:test';
import assert from 'node:assert/strict';
import {validLearning,approvedLearning,assertLearningCurrent,planningLearning,refreshLearning,learningSections,LEARNING_LIMITS} from '../../dist/learning-context.js';
import {compareToOwnMedian,performancePatterns,median,daypart,UNPROVEN_SMALL,UNPROVEN_OBSERVED} from '../../dist/learning-patterns.js';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const obs=(n,over={},attribution={})=>({id:uuid(n),publication_id:uuid(n),source:'postforme',caption:'c',scheduled_at:'2026-10-01T09:00:00.000Z',posted_at:null,provider:'instagram',account_name:'a',format:'static',semantics:'lifetime',metrics:{likes:n},series:[],collected_at:'2026-10-10T09:00:00.000Z',hours_since_publish:216,
 attribution:{creative_version_id:null,format:'static',channel:'instagram',pillar:null,hook:null,cta:null,layout_archetype:null,stock_used:null,posted_weekday:null,posted_hour:null,timezone:null,...attribution},...over});

test('posts are compared only with settled posts on the same provider and metric',()=>{
 assert.equal(median([5,1,3]),3);assert.equal(median([4,1,3,2]),2.5);assert.equal(daypart(9),'morning');assert.equal(daypart(23),'night');assert.equal(daypart(null),null);
 const c=compareToOwnMedian([obs(1),obs(2),obs(3),obs(50,{hours_since_publish:10}),obs(60,{hours_since_publish:null}),obs(7,{provider:'linkedin',metrics:{impressions:900}}),obs(8,{provider:'linkedin',metrics:{impressions:100}})]);
 assert.deepEqual(c.groups,[{provider:'instagram',metric:'likes',median:2,sample_size:3}]);
 assert.deepEqual(c.results.map(r=>r.relative),['below','at_median','above']);
 assert.deepEqual(c.excluded,{too_early:2,too_few_comparable:2},'two LinkedIn posts are too few and are never ranked against Instagram');
});
test('a post missing the compared metric is left out rather than counted as zero',()=>{
 const c=compareToOwnMedian([obs(1),obs(2),obs(3),obs(4,{metrics:{views:999}})]);
 assert.equal(c.groups[0].metric,'likes');assert.equal(c.results.length,3);assert.equal(c.excluded.too_few_comparable,1);
});
test('patterns report top and bottom attributed choices with sample sizes and an unproven label',()=>{
 const rows=[obs(1,{},{format:'static',pillar:'Offers',posted_hour:9}),obs(2,{},{format:'static',pillar:'Offers',posted_hour:10}),obs(3,{},{format:'static',pillar:'Education',posted_hour:19}),obs(8,{},{format:'carousel',pillar:'Education',posted_hour:19}),obs(9,{},{format:'carousel',pillar:'Education',posted_hour:20})];
 const {top,bottom}=performancePatterns(rows);
 assert.deepEqual(top[0],{direction:'top',dimension:'format',value:'carousel',metric:'likes',sample_size:2,above_median:2,below_median:0,label:UNPROVEN_SMALL});
 assert.ok(top.some(p=>p.dimension==='posted_daypart'&&p.value==='evening'&&p.sample_size===3));
 assert.deepEqual(bottom[0],{direction:'bottom',dimension:'pillar',value:'Offers',metric:'likes',sample_size:2,above_median:0,below_median:2,label:UNPROVEN_SMALL});
 assert.ok(![...top,...bottom].some(p=>p.dimension==='channel'),'a value shared by every compared post offers no contrast');
 assert.ok(top.length<=3&&bottom.length<=3);const flipped=performancePatterns([...rows].reverse());assert.deepEqual([flipped.top,flipped.bottom],[top,bottom]);
 assert.deepEqual(performancePatterns([obs(1),obs(2)]).top,[]);
 const many=Array.from({length:24},(_,i)=>obs(i+1,{},{format:i<12?'static':'carousel'}));
 assert.equal(performancePatterns(many).top[0].label,UNPROVEN_OBSERVED);
});

const hypothesis=(n,over={})=>({id:uuid(n),revision:2,kind:'unproven_hypothesis',hypothesis:'Unproven: carousels may help.',next_test:'Compare formats.',applicability:'Instagram only',...over});
const preference={kind:'customer_preference',statement:'Rejection reasons mention people: 4 of 5 rejections with a reason',count:4,of:5,last_seen:'2026-11-10T00:00:00.000Z'};
const pattern={kind:'performance_pattern',direction:'top',dimension:'format',value:'carousel',metric:'likes',sample_size:2,above_median:2,below_median:0,label:UNPROVEN_SMALL};
test('saved v1 contexts stay valid and v2 entries are strictly shaped and bounded',()=>{
 assert.ok(validLearning([]));assert.ok(validLearning([hypothesis(1),hypothesis(2)]));assert.ok(validLearning([hypothesis(1),preference,pattern]));
 for(const bad of [[hypothesis(1),hypothesis(1)],[{...hypothesis(1),extra:1}],[{...preference,count:6}],[{...preference,statement:''}],[{...preference,note:'x'}],[{...pattern,label:'proven'}],[{...pattern,dimension:'mood'}],[{...pattern,sample_size:1}],[{kind:'other'}],[null],'x',
  Array.from({length:11},(_,i)=>hypothesis(i)),Array.from({length:LEARNING_LIMITS.preferences+1},()=>preference),Array.from({length:LEARNING_LIMITS.patterns+1},()=>pattern)])
  assert.equal(validLearning(bad),false,JSON.stringify(bad).slice(0,80));
 assert.deepEqual(Object.values(learningSections([hypothesis(1),preference,pattern])).map(s=>s.length),[1,1,1]);
});
const lesson=n=>({id:uuid(n),revision:2,content:{hypothesis:'Unproven: carousels may help.',next_test:'Compare formats.'},applicability:'Instagram only'});
const lessonDb=rows=>({query:async(sql,params)=>({rows:sql.includes('ANY($1')?rows.filter(r=>params[0].includes(r.id)):rows})});
test('assertLearningCurrent still passes for old contexts and checks only hypotheses in new ones',async()=>{
 const db=lessonDb([lesson(1)]);
 await assertLearningCurrent(db,undefined);await assertLearningCurrent(db,[]);await assertLearningCurrent(db,[hypothesis(1)]);
 await assertLearningCurrent(db,[hypothesis(1),preference,pattern]);
 await assertLearningCurrent({query:async()=>{throw new Error('no query needed');}},[preference,pattern]);
 await assert.rejects(assertLearningCurrent(db,[hypothesis(1,{revision:3}),preference]),e=>e.code==='MEMORY_CONTEXT_CHANGED');
 await assert.rejects(assertLearningCurrent(db,[hypothesis(2)]),e=>e.code==='MEMORY_CONTEXT_CHANGED');
 await assert.rejects(assertLearningCurrent(db,[{...preference,count:9}]),e=>e.code==='MEMORY_CONTEXT_INVALID');
 assert.deepEqual(await approvedLearning(db),[hypothesis(1)]);
});
test('planners receive hypotheses, the preference summary and labelled patterns, within bounds',async()=>{
 const now=new Date('2026-11-12T12:00:00.000Z'),published=[1,2,3,8,9].map(n=>({publication_id:uuid(n),caption:'c'+n,scheduled_at:'2026-10-01T09:00:00.000Z',release_url:`https://instagram.com/p/${n}`,account_id:'acc',provider:'instagram',account_name:'a',slot_format:'static',carousel_version_id:n>3?uuid(100+n):null,channel:'instagram',timezone:'UTC'}));
 const feed=[{account_id:'acc',updated_at:'2026-10-10T09:00:00.000Z',posts:published.map((p,i)=>({id:'f'+i,account_id:'acc',caption:p.caption,posted_at:p.scheduled_at,url:p.release_url,metrics:{likes:[1,2,3,8,9][i]}}))}];
 const signals=['No people','Fewer faces please'].map(reason=>({kind:'rejected',reason,diff:{},context:{},created_at:'2026-11-11T00:00:00.000Z'}));
 const db={query:async sql=>({rows:sql.includes('memory_lessons')?[lesson(1)]:sql.includes('creative_signals')?signals:sql.includes('postforme_publications')?published:sql.includes('postforme_analytics')?feed:[]})};
 const context=await planningLearning(db,now);
 assert.ok(validLearning(context));const {hypotheses,preferences,patterns}=learningSections(context);
 assert.deepEqual(hypotheses,[hypothesis(1)]);
 assert.deepEqual(preferences,[{kind:'customer_preference',statement:'Rejection reasons mention people: 2 of 2 rejections with a reason',count:2,of:2,last_seen:'2026-11-11T00:00:00.000Z'}]);
 assert.ok(patterns.some(p=>p.direction==='top'&&p.dimension==='format'&&p.value==='carousel'&&p.sample_size===2&&p.label===UNPROVEN_SMALL));
 assert.ok(patterns.every(p=>p.label.startsWith('unproven')));assert.ok(Buffer.byteLength(JSON.stringify(context))<60000);
 const refreshed=await refreshLearning(lessonDb([lesson(1),lesson(2)]),[hypothesis(1),...preferences,...patterns]);
 assert.equal(learningSections(refreshed).hypotheses.length,2);assert.deepEqual(learningSections(refreshed).patterns,patterns);
 await assert.rejects(refreshLearning(lessonDb([]),[{kind:'x'}]),e=>e.code==='MEMORY_CONTEXT_INVALID');
});
