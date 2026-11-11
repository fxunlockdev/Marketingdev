import test from 'node:test';
import assert from 'node:assert/strict';
import {postformeObservations,matchFeedPost,normaliseProviderURL,postformePublishedSQL,postformeFeedsSQL} from '../../dist/learning-observations.js';
import {insightObservations,insightObservationsSQL,legacyPostizObservationsSQL} from '../../dist/insights.js';

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
test('insights read Post for Me and use the Postiz reader only for a business with no Post for Me posts',async()=>{
 assert.equal(legacyPostizObservationsSQL,insightObservationsSQL);assert.match(legacyPostizObservationsSQL,/app\.post_analytics/);
 assert.match(postformePublishedSQL,/app\.postforme_publications/);assert.match(postformePublishedSQL,/observed_state='published'/);assert.match(postformeFeedsSQL,/app\.postforme_analytics/);
 const live=db([['postforme_publications',[published()]],['postforme_analytics',feed([feedPost()])],['post_analytics',[{id:'legacy'}]]]);
 const fromPostforme=await insightObservations(live);
 assert.equal(fromPostforme.source,'postforme');assert.equal(fromPostforme.observations.length,1);assert.ok(!live.seen.some(sql=>sql.includes('app.post_analytics')));
 const waiting=await insightObservations(db([['postforme_publications',[published()]],['post_analytics',[{id:'legacy'}]]]));
 assert.deepEqual(waiting,{source:'postforme',observations:[]},'a Post for Me business never falls back to stale Postiz data');
 const legacy=await insightObservations(db([['post_analytics',[{id:'legacy'}]]]));
 assert.deepEqual(legacy,{source:'postiz_legacy',observations:[{id:'legacy'}]});
});
