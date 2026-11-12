import test from 'node:test';
import assert from 'node:assert/strict';
import {postformeObservations,matchFeedPost,normaliseProviderURL,postformePublishedSQL,postformeFeedsSQL} from '../../dist/learning-observations.js';
import * as insights from '../../dist/insights.js';
const {insightObservations}=insights;

const account='11111111-1111-4111-8111-111111111111';
const published=(over={})=>({publication_id:'22222222-2222-4222-8222-222222222222',caption:'Launch day',scheduled_at:'2026-11-01T09:00:00.000Z',release_url:'https://instagram.com/p/abc/',account_id:account,provider:'instagram',account_name:'Studio',slot_format:'static',carousel_version_id:null,video_version_id:null,placement:'feed',...over});
const feedPost=(over={})=>({id:'post-1',account_id:account,platform:'instagram',caption:'Launch day',posted_at:'2026-11-01T09:01:00.000Z',url:'https://instagram.com/p/abc',metrics:{likes:12,views:340},...over});
const feed=(posts,updated_at='2026-11-04T09:00:00.000Z')=>[{account_id:account,posts,updated_at}];

test('published Post for Me posts become observations with provider-reported lifetime totals only',()=>{
 const [o]=postformeObservations([published()],feed([feedPost()]));
 assert.equal(o.id,'22222222-2222-4222-8222-222222222222');assert.equal(o.publication_id,o.id);assert.equal(o.source,'postforme');
 assert.equal(o.semantics,'lifetime');assert.equal(o.provider,'instagram');assert.equal(o.format,'static');
 assert.deepEqual(o.metrics,{likes:12,views:340});
 assert.deepEqual(o.series,[{label:'likes',points:[{date:'2026-11-04',value:12}]},{label:'views',points:[{date:'2026-11-04',value:340}]}]);
 assert.equal(o.collected_at,'2026-11-04T09:00:00.000Z');assert.equal(o.hours_since_publish,72);
});

test('absent metrics are never turned into zeros and unmatched posts are never guessed',()=>{
 assert.deepEqual(postformeObservations([published()],feed([feedPost({metrics:{}})])),[]);
 assert.deepEqual(postformeObservations([published()],[]),[]);
 assert.deepEqual(postformeObservations([published()],feed([feedPost({url:'https://instagram.com/p/other',caption:'Another post'})])),[]);
 const [o]=postformeObservations([published()],feed([feedPost({metrics:{likes:0}})]));
 assert.deepEqual(o.metrics,{likes:0},'a provider-reported zero is an observation');
 assert.ok(!('views' in o.metrics));
});

test('matching uses the release link first, then only an unambiguous caption and time match on the same account',()=>{
 assert.equal(normaliseProviderURL('https://Instagram.com/p/abc/?igsh=1#x'),'https://instagram.com/p/abc');
 assert.equal(normaliseProviderURL('javascript:alert(1)'),null);
 const p=published({release_url:null});
 assert.equal(matchFeedPost(p,[feedPost({url:null})])?.id,'post-1');
 assert.equal(matchFeedPost(p,[feedPost({url:null}),feedPost({id:'post-2',url:null})]),null,'two candidates are ambiguous');
 assert.equal(matchFeedPost(p,[feedPost({url:null,posted_at:'2026-11-03T09:00:00.000Z'})]),null,'outside the publish window');
 assert.equal(matchFeedPost(p,[feedPost({url:null,account_id:'33333333-3333-4333-8333-333333333333'})]),null,'another account');
 assert.equal(matchFeedPost(published(),[feedPost({url:'https://instagram.com/p/zzz'})]),null,'a recorded link that differs is never overridden by caption');
});

test('format follows what was published: carousel, video, story or static',()=>{
 const f=over=>postformeObservations([published(over)],feed([feedPost()]))[0].format;
 assert.equal(f({carousel_version_id:'c'}),'carousel');assert.equal(f({video_version_id:'v'}),'video');assert.equal(f({placement:'story'}),'story');
 assert.equal(f({video_version_id:'v',placement:'reel'}),'video');assert.equal(f({}),'static');
});

test('malformed stored feed rows are ignored rather than trusted',()=>{
 assert.deepEqual(postformeObservations([published()],[{account_id:account,posts:'nope',updated_at:'2026-11-04T09:00:00.000Z'}]),[]);
 const [o]=postformeObservations([published()],feed([null,{id:5},feedPost({metrics:{likes:3,bad:'9',neg:-1,inf:Infinity}})]));
 assert.deepEqual(o.metrics,{likes:3});
});

const db=results=>{const seen=[];return {seen,query:async sql=>{seen.push(sql);const hit=results.find(([needle])=>sql.includes(needle));return {rows:hit?hit[1]:[]};}};};
test('insights read Post for Me only; Postiz history is never read',async()=>{
 assert.equal('legacyPostizObservationsSQL' in insights,false);assert.equal('insightObservationsSQL' in insights,false);
 assert.match(postformePublishedSQL,/app\.postforme_publications/);assert.match(postformePublishedSQL,/observed_state='published'/);assert.match(postformeFeedsSQL,/app\.postforme_analytics/);
 const live=db([['postforme_publications',[published()]],['postforme_analytics',feed([feedPost()])],['post_analytics',[{id:'legacy'}]]]);
 const fromPostforme=await insightObservations(live);
 assert.equal(fromPostforme.source,'postforme');assert.equal(fromPostforme.observations.length,1);assert.ok(!live.seen.some(sql=>sql.includes('app.post_analytics')));
 const waiting=await insightObservations(db([['postforme_publications',[published()]],['post_analytics',[{id:'legacy'}]]]));
 assert.deepEqual(waiting,{source:'postforme',observations:[]},'a Post for Me business never falls back to stale Postiz data');
 const never=db([['post_analytics',[{id:'legacy'}]]]);
 assert.deepEqual(await insightObservations(never),{source:'postforme',observations:[]});assert.ok(!never.seen.some(sql=>sql.includes('app.post_analytics')));
});

import {attribution,postedLocal,layoutArchetype,stockUsed,ATTRIBUTION_DIMENSIONS} from '../../dist/learning-attribution.js';
import {validateInsights,validateInsightResult,INSIGHT_RESULT_V2} from '../../dist/insight-contracts.js';
import {INSIGHT_SKILLS} from '../../dist/insight-skill-pins.js';

const attributed=(over={})=>published({version_id:'44444444-4444-4444-8444-444444444444',channel:'instagram',pillar:'Education',hook:'Stop guessing your margins',cta:'Book a demo',timezone:'America/New_York',has_creative_version:true,manifest_references:[{kind:'stock_inspiration'}],imported_stock:false,brief:{art_direction:{layout_archetype:'split-hero'}},creative_spec:{placement:'feed',aspect:'square',slide_count:1},design:{},...over});
test('each observation carries what produced it, in the business timezone',()=>{
 const [o]=postformeObservations([attributed()],feed([feedPost({posted_at:'2026-11-01T03:30:00.000Z'})]));
 assert.deepEqual(o.attribution,{creative_version_id:'44444444-4444-4444-8444-444444444444',format:'static',channel:'instagram',pillar:'Education',hook:'Stop guessing your margins',cta:'Book a demo',layout_archetype:'split-hero',stock_used:true,posted_weekday:'Saturday',posted_hour:23,timezone:'America/New_York'});
 assert.deepEqual(Object.keys(o.attribution).filter(k=>!['creative_version_id','timezone'].includes(k)).sort(),[...ATTRIBUTION_DIMENSIONS].sort());
 for(const fragment of ['app.content_plans','app.creative_versions','app.creative_requests','app.creative_media','s.pillar','s.hook','s.cta','pl.timezone'])assert.ok(postformePublishedSQL.includes(fragment),fragment);
});
test('unknown attribution stays null instead of being guessed',()=>{
 const a=attribution({channel:'linkedin',pillar:'',hook:'  ',cta:null,timezone:'Not/AZone'},'carousel','2026-11-01T09:00:00Z');
 assert.deepEqual(a,{creative_version_id:null,format:'carousel',channel:'linkedin',pillar:null,hook:null,cta:null,layout_archetype:null,stock_used:null,posted_weekday:null,posted_hour:null,timezone:null});
 assert.equal(postedLocal('nope','UTC'),null);assert.deepEqual(postedLocal('2026-11-02T00:05:00Z','Europe/Riga'),{weekday:'Monday',hour:2});
 assert.equal(layoutArchetype(null,'x',{art_direction:'bad'},{art_direction:{layout:'grid'}}),'grid');assert.equal(layoutArchetype({layout_archetype:7}),null);
 assert.equal(stockUsed({has_creative_version:true,manifest_references:[{kind:'product'}]}),false);assert.equal(stockUsed({imported_stock:true}),true);assert.equal(stockUsed({manifest_references:'bad'}),null);
});

const insightInput=()=>({task:'performance_analysis',brand:{id:'b',sha256:'a'.repeat(64),facts:[]},observations:postformeObservations([attributed()],feed([feedPost()]))});
const insight=(over={})=>({title:'Carousel hooks',summary:'One post reported likes.',hypothesis:'Unproven: education posts may earn more saves.',next_test:'Compare two pillars over the same window.',evidence_ids:['22222222-2222-4222-8222-222222222222'],limitations:['One post.'],...over});
const analysis=i=>({insights:[i],limitations:['Small sample.']});
test('insights that name attribution must quote values carried by the posts they cite',()=>{
 const input=insightInput();
 assert.ok(validateInsights(analysis(insight()),input),'the saved v1 shape stays valid');
 assert.ok(validateInsights(analysis(insight({attribution:[{dimension:'pillar',value:'Education'},{dimension:'stock_used',value:'true'},{dimension:'posted_hour',value:'4'}]})),input,true));
 for(const bad of [[{dimension:'pillar',value:'Sales'}],[{dimension:'mood',value:'x'}],[],[{dimension:'pillar',value:'Education'},{dimension:'pillar',value:'Education'}],[{dimension:'pillar',value:'Education',extra:1}],'pillar'])
  assert.throws(()=>validateInsights(analysis(insight({attribution:bad})),input),e=>e.code==='INSIGHT_OUTPUT_INVALID');
 assert.throws(()=>validateInsights(analysis(insight()),input,true),e=>e.code==='INSIGHT_OUTPUT_INVALID','v2 requires a reference when cited posts are attributed');
 const legacy={...input,observations:[{id:'22222222-2222-4222-8222-222222222222'}]};
 assert.ok(validateInsights(analysis(insight()),legacy,true),'legacy Postiz observations carry no attribution to reference');
});
test('the v2 result version turns the attribution requirement on',()=>{
 const input=insightInput(),skills=Object.entries(INSIGHT_SKILLS).map(([name,pin])=>({name,...pin})),reads=skills.map(s=>`/skills/${s.name}/SKILL.md`);
 const result=(version,i)=>({type:'result',version,analysis:analysis(i),skills,reads,model_calls:1,helpers_executed:false});
 assert.ok(validateInsightResult(result('deepagents-0.7.29/desvio-insight-v1',insight()),input),'v1 results stay valid');
 assert.throws(()=>validateInsightResult(result(INSIGHT_RESULT_V2,insight()),input),e=>e.code==='INSIGHT_OUTPUT_INVALID');
 assert.ok(validateInsightResult(result(INSIGHT_RESULT_V2,insight({attribution:[{dimension:'format',value:'static'}]})),input));
});
