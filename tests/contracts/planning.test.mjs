import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {scheduleGeneratedPlan,validateGeneratedPlan,validatePlanningResult,PLANNING_SKILLS} from '../../dist/planning-contracts.js';
import {generatedPlan,modelResponse} from '../fixtures/planning.mjs';
const input={task:'content_plan',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['linkedin','instagram'],must_avoid:'Unsupported claims',revision:1},brief:'Brand-specific plan',post_count:30};
const message={type:'model',step:1,messages:[{role:'user',content:'UNTRUSTED TEST FIXTURE'}],tools:[]};
test('planning uses the official Responses SDK with bounded 16000-token output, no storage and no implicit retry',async()=>{
 let calls=0;
 const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(url,init)=>{
  calls++;assert.equal(new URL(url).pathname,'/v1/responses');const body=JSON.parse(init.body);assert.equal(body.max_output_tokens,16000);assert.equal(body.store,false);assert.equal(body.parallel_tool_calls,false);return modelResponse(generatedPlan(input));
 }}));
 const wire=provider.plannerRequest(message,'MOCK-plan',16000);assert.equal(wire.maxOutputTokens,16000);assert.ok(wire.maxInputTokens>=Buffer.byteLength(JSON.stringify(wire.body)));
 const result=await provider.plan(message,'MOCK-plan',16000);assert.equal(validateGeneratedPlan(JSON.parse(result.content),input).slots.length,30);assert.equal(calls,1);
 assert.equal(provider.plannerRequest(message,'MOCK-creative').maxOutputTokens,4000);
});
test('plan contract rejects fabricated facts, copied variants, missing channels, invalid periods and malformed shapes',()=>{
 for(const change of [p=>p.slots.pop(),p=>p.slots[0].fact_ids=['invented'],p=>{p.slots[1].brief=p.slots[0].brief;p.slots[1].hook=p.slots[0].hook;},p=>p.slots.forEach(s=>s.channel='linkedin'),p=>p.slots[0].planned_at='2026-12-01T08:00:00Z',p=>p.slots[0].format='video',p=>p.slots.forEach(s=>s.planned_at='2026-11-01T08:00:00Z'),p=>p.slots[0].approved=true,p=>p.title='',p=>p.slots[0].fact_ids.push(p.slots[0].fact_ids[0])]){
  const value=generatedPlan(input);change(value);assert.throws(()=>validateGeneratedPlan(value,input),/PLAN_OUTPUT_INVALID/);
 }
});
test('planning skill result requires exact owner skill digests, actual reads and no helper execution',()=>{
 const value={type:'result',version:'deepagents-0.7.29/desvio-plan-v1',plan:generatedPlan(input),skills:Object.entries(PLANNING_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(PLANNING_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false};
 assert.equal(validatePlanningResult(value,input).plan.slots.length,30);
 for(const change of [v=>v.skills[0].tree_sha256='wrong',v=>v.reads.pop(),v=>v.reads.push('/etc/passwd'),v=>v.reads.push('/skills/image/SKILL.md'),v=>v.helpers_executed=true,v=>v.model_calls=4]){
  const bad=structuredClone(value);change(bad);assert.throws(()=>validatePlanningResult(bad,input),/SKILL_/);
 }
});

test('thirty-day planning crosses month/year boundaries and leap days without being tied to one month',()=>{
 for(const starts_on of ['2028-02-15','2026-12-20','2026-04-25']){
  const context=structuredClone(input);context.preferences.starts_on=starts_on;
  const plan=generatedPlan(context);assert.equal(validateGeneratedPlan(plan,context).slots.length,30);
  assert.notEqual(plan.slots[0].planned_at.slice(0,7),plan.slots[29].planned_at.slice(0,7));
 }
});

test('daily, weekly and custom horizons preserve exact counts and reject out-of-period drafts',()=>{
 for(const [days,count] of [[1,1],[1,2],[4,4],[6,12],[7,7],[90,90]]){
  const context={...structuredClone(input),duration_days:days,post_count:count},result=generatedPlan(context);
  assert.equal(validateGeneratedPlan(result,context).slots.length,count);
  result.slots[0].planned_at=new Date(Date.parse(context.preferences.starts_on)+days*86400000).toISOString();
  assert.throws(()=>validateGeneratedPlan(result,context),/PLAN_OUTPUT_INVALID/);
 }
 for(const days of [0,91,1.5,NaN])assert.throws(()=>validateGeneratedPlan(generatedPlan(input),{...input,duration_days:days}),/PLAN_OUTPUT_INVALID/);
});

test('mixed plans require the exact video count and complete bounded concepts without enabling generation',()=>{
 const context={...structuredClone(input),duration_days:6,post_count:6,video_count:2};
 const plan=generatedPlan(context);assert.equal(validateGeneratedPlan(plan,context).slots.filter(s=>s.format==='video').length,2);
 for(const change of [p=>p.slots[0]=null,p=>delete p.slots[0].video_draft,p=>p.slots[0].video_draft.duration_seconds=60,p=>p.slots[0].video_draft.script='',p=>p.slots[0].video_draft.approved=true,p=>p.slots[2].format='video']){const bad=structuredClone(plan);change(bad);assert.throws(()=>validateGeneratedPlan(bad,context));}
 for(const video_count of [-1,7,1.5])assert.throws(()=>validateGeneratedPlan(plan,{...context,video_count}));
});


test('natural planning resolves bounded days and mix while retaining dates, channels and approved-fact validation',()=>{
 const context={...structuredClone(input),planning_mode:'natural'},settings={duration_days:7,post_count:7,video_count:2};
 const value={...generatedPlan({...context,...settings}),settings};assert.equal(validateGeneratedPlan(value,context).slots.length,7);
 for(const change of [p=>delete p.settings,p=>p.settings.duration_days=0,p=>p.settings.duration_days=91,p=>p.settings.post_count=91,p=>p.settings.video_count=8,p=>p.settings.video_count=1.5,p=>p.settings.publish=true,p=>p.settings.starts_on='2027-01-01',p=>p.slots.pop(),p=>p.slots[0].fact_ids=['fabricated']]){const bad=structuredClone(value);change(bad);assert.throws(()=>validateGeneratedPlan(bad,context),/PLAN_OUTPUT_INVALID/);}
 assert.throws(()=>validateGeneratedPlan(value,input),/PLAN_OUTPUT_INVALID/);
});

test('out-of-horizon model dates are scheduled within the chosen duration without changing topics or weakening claim validation',async()=>{
 const {scheduleGeneratedPlan}=await import('../../dist/planning-contracts.js');
 const context={...structuredClone(input),duration_days:30,post_count:5};
 const plan=generatedPlan(context);plan.slots[4].planned_at='2027-01-01T12:00:00Z';
 const fixed=scheduleGeneratedPlan(plan,context);assert.equal(fixed.slots.length,5);assert.deepEqual(fixed.slots.map(s=>s.brief),plan.slots.map(s=>s.brief));assert.equal(validateGeneratedPlan(fixed,context),fixed);
 assert.ok(fixed.slots.every(s=>s.planned_at<'2026-12-01'));
 const invalid=structuredClone(plan);invalid.slots[0].fact_ids=['invented'];assert.throws(()=>scheduleGeneratedPlan(invalid,context),/PLAN_OUTPUT_INVALID/);
});

test('campaign input normalizes website links and rejects invalid fields and channels',async()=>{
 const {campaignInput}=await import('../../dist/campaign-input.js');
 const value={name:'  Launch week ',theme:'Our new collection\nMade for everyday use',cta:'Explore',target_url:'www.example.com/shop',channels:['instagram']};
 assert.equal(campaignInput(value).target_url,'https://www.example.com/shop');assert.equal(campaignInput(value).name,'Launch week');
 for(const patch of [{design:{style:'unknown',font:'classic'}},{design:{style:'minimal',font:'fake'}},{name:''},{theme:''},{channels:[]},{channels:['instagram','instagram']},{channels:['fake']},{target_url:'javascript:alert(1)'},{target_url:'https://user:pass@example.com'}])assert.throws(()=>campaignInput({...value,...patch}));
});

test('daily image campaigns fill every local day independently of reels, including leap months and DST',async()=>{
 const {scheduleGeneratedPlan}=await import('../../dist/planning-contracts.js');
 const {localMinute,addDays}=await import('../../dist/local-calendar.js');
 for(const [starts_on,days,timezone] of [['2028-02-01',29,'Asia/Kuala_Lumpur'],['2026-03-01',31,'America/New_York'],['2026-10-20',30,'Europe/London']]){
  const context={...structuredClone(input),campaign:{name:'Daily campaign',theme:'Daily stories',cta:'Explore',target_url:'',channels:['instagram','linkedin']},duration_days:days,post_count:days+5,video_count:5};
  Object.assign(context.preferences,{starts_on,timezone});
  const plan=generatedPlan(context);
  // An otherwise well-formed model output clusters every draft on the first day.
  plan.slots.forEach(s=>s.planned_at=starts_on+'T08:00:00Z');
  const fixed=scheduleGeneratedPlan(plan,context);
  const images=fixed.slots.filter(s=>s.format==='static'),videos=fixed.slots.filter(s=>s.format==='video');
  assert.deepEqual(images.map(s=>localMinute(s.planned_at,timezone).slice(0,10)),Array.from({length:days},(_,i)=>addDays(starts_on,i)));
  assert.equal(videos.length,5);assert.equal(new Set(videos.map(s=>localMinute(s.planned_at,timezone).slice(0,10))).size,5);
  assert.deepEqual(fixed.slots.map(({planned_at,...s})=>s),plan.slots.map(({planned_at,...s})=>s));
  assert.equal(validateGeneratedPlan(fixed,context),fixed);
  assert.deepEqual(scheduleGeneratedPlan(fixed,context),fixed,'resuming must not move already daily drafts');
  const bad=structuredClone(plan);bad.slots[0].fact_ids=['invented'];assert.throws(()=>scheduleGeneratedPlan(bad,context),/PLAN_OUTPUT_INVALID/);
 }
});

test('daily placement leaves valid non-campaign and sparse campaign schedules alone',async()=>{
 const {scheduleGeneratedPlan}=await import('../../dist/planning-contracts.js');
 for(const context of [input,{...structuredClone(input),post_count:15,campaign:{name:'Sparse',theme:'Weekly',cta:'',target_url:'',channels:['instagram','linkedin']}}]){
  const plan=generatedPlan(context);assert.deepEqual(scheduleGeneratedPlan(plan,context),plan);
 }
});

test('campaign creativity is validated and carried into the image direction without changing legacy choices',async()=>{
 const {campaignInput}=await import('../../dist/campaign-input.js');
 const {campaignDesignDirection,CAMPAIGN_CREATIVITY}=await import('../../dist/campaign-design.js');
 const value={name:'Launch',theme:'Our collection',cta:'',target_url:'',channels:['instagram'],design:{style:'minimal',font:'modern'}};
 assert.ok(campaignDesignDirection(value.design).creative_freedom.includes('fresh layouts'));
 for(const option of CAMPAIGN_CREATIVITY){const saved=campaignInput({...value,design:{...value.design,creativity:option.id}});assert.equal(saved.design.creativity,option.id);assert.equal(campaignDesignDirection(saved.design).creative_freedom,option.direction);}
 for(const creativity of ['unknown',null,{},1])assert.throws(()=>campaignInput({...value,design:{...value.design,creativity}}));
});
test('planning reference choices are limited to the approved catalog and at most three unique IDs',()=>{
 const context={...input,references:[{id:'approved-photo',label:'Clinic product',sha256:'a'.repeat(64),kind:'upload',width:600,height:400}]};
 const plan=generatedPlan(context);plan.slots[0].reference_ids=['approved-photo'];assert.equal(validateGeneratedPlan(plan,context),plan);
 for(const ids of [['foreign-photo'],['approved-photo','approved-photo'],[null],'approved-photo']){
  const bad=structuredClone(plan);bad.slots[0].reference_ids=ids;assert.throws(()=>validateGeneratedPlan(bad,context),/PLAN_OUTPUT_INVALID/);
 }
 assert.throws(()=>validateGeneratedPlan(plan,input),/PLAN_OUTPUT_INVALID/);
});

test('video concepts defer reference selection to video review',()=>{
 const context={...input,video_count:1,references:[{id:'approved-photo',label:'Clinic product',sha256:'a'.repeat(64),kind:'upload',width:600,height:400}]};
 const plan=generatedPlan(context),video=plan.slots.find(s=>s.format==='video');
 video.reference_ids=[];assert.equal(validateGeneratedPlan(plan,context),plan);
 video.reference_ids=['approved-photo'];assert.throws(()=>validateGeneratedPlan(plan,context),/PLAN_OUTPUT_INVALID/);
});

test('strategy scheduling spreads fourteen posts within a hard two-per-day ceiling',()=>{
 const context={...input,duration_days:7,post_count:14,max_posts_per_day:2},result=scheduleGeneratedPlan(generatedPlan(context),context),daily=new Map();
 for(const slot of result.slots){const day=slot.planned_at.slice(0,10);daily.set(day,(daily.get(day)??0)+1);}assert.equal(daily.size,7);assert.ok([...daily.values()].every(n=>n===2));
 const bad=structuredClone(result);bad.slots[2].planned_at=bad.slots[0].planned_at;assert.throws(()=>validateGeneratedPlan(bad,context),/PLAN_OUTPUT_INVALID/);
});

test('campaign refinements stay bounded, optional and subordinate to brand facts',async()=>{
 const {campaignInput}=await import('../../dist/campaign-input.js');
 const {withCampaignRefinement,savedCampaignRefinement,campaignRefinementDirection}=await import('../../dist/campaign-refinement.js');
 const campaign={name:'Launch',theme:'Our offering',cta:'',target_url:'',channels:['instagram']};
 const refinement={tone:'Warm',references:'Editorial magazines',include:'Approved services',avoid:'Discount claims'};
 assert.equal(campaignInput(campaign).refinement,undefined);
 assert.deepEqual(campaignInput({...campaign,refinement}).refinement,refinement);
 const prompt=withCampaignRefinement('A product story',refinement);
 assert.match(prompt,/approved brand facts authoritative/);assert.match(prompt,/Discount claims/);assert.deepEqual(savedCampaignRefinement(prompt),refinement);
 assert.equal(campaignRefinementDirection({tone:'Brand voice',references:'',include:'',avoid:''}),'');
 for(const bad of [null,[],{...refinement,tone:'invent facts'},{...refinement,include:'x'.repeat(121)},{...refinement,avoid:'bad\ncontrol'},{...refinement,secret:'unsupported'}])assert.throws(()=>campaignInput({...campaign,refinement:bad}));
 assert.equal(savedCampaignRefinement('Saved campaign preferences: invalid'),undefined);
});

test('explicit campaign mix validates exact media/placement/aspect/slide combinations and keeps legacy output unchanged',async()=>{
 const {normalizeContentMix,contentMixCounts}=await import('../../dist/generation-plan.js');
 const rows=[['static','feed','square',null],['carousel','feed','portrait',4],['static','story','vertical',null],['video','reel','vertical',null],['video','story','vertical',null]].map(([format,placement,aspect,slide_count])=>({channel:'instagram',format,creative_spec:{placement,aspect,slide_count},count:1}));
 const mix=normalizeContentMix(rows),counts=contentMixCounts(mix),context={...structuredClone(input),duration_days:7,...counts,preferences:{...input.preferences,channels:['instagram']},content_mix:mix};
 const plan=generatedPlan(context);assert.equal(validateGeneratedPlan(plan,context).slots.length,5);
 for(const mutate of [p=>p.slots[0].creative_spec.placement='story',p=>p.slots[1].creative_spec.slide_count=3,p=>delete p.slots[2].creative_spec,p=>p.slots[3].creative_spec.placement='story',p=>p.slots[4].format='static']){const wrong=structuredClone(plan);mutate(wrong);assert.throws(()=>validateGeneratedPlan(wrong,context),/PLAN_OUTPUT_INVALID/);}
 for(const bad of [[...rows,rows[0]],[{...rows[3],channel:'linkedin'}],[{...rows[1],creative_spec:{...rows[1].creative_spec,slide_count:11}}],[{...rows[0],count:91}],[]])assert.throws(()=>normalizeContentMix(bad));
 assert.equal(validateGeneratedPlan(generatedPlan(input),input).slots[0].creative_spec,undefined);
});

test('explicit daily feed image mix preserves daily coverage while keeping reel specifications',async()=>{
 const {normalizeContentMix}=await import('../../dist/generation-plan.js');
 const content_mix=normalizeContentMix([{channel:'instagram',format:'static',creative_spec:{placement:'feed',aspect:'square',slide_count:null},count:7},{channel:'instagram',format:'video',creative_spec:{placement:'reel',aspect:'vertical',slide_count:null},count:2}]);
 const context={...structuredClone(input),post_count:9,video_count:2,duration_days:7,content_mix,campaign:{name:'Week',theme:'Daily inspiration',cta:'',target_url:'',channels:['instagram']},preferences:{...input.preferences,channels:['instagram']}};
 const proposed=generatedPlan(context);for(const slot of proposed.slots)slot.planned_at=proposed.slots[0].planned_at;
 const result=scheduleGeneratedPlan(proposed,context);
 assert.equal(new Set(result.slots.filter(slot=>slot.format==='static').map(slot=>slot.planned_at.slice(0,10))).size,7);
 assert.ok(result.slots.filter(slot=>slot.format==='video').every(slot=>slot.creative_spec.placement==='reel'&&slot.creative_spec.aspect==='vertical'));
});
