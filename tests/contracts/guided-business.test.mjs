import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidedBrief,nextDirectionVersion,requireGuidedRevision} from '../../dist/guided-campaign-contracts.js';
import {analysisRequest,validateAnalysis,recoverAnalysis} from '../../dist/brand-analysis.js';
const brief={offering:'Cafe',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Recommend a direction',must_follow:'No invented prices'};
const input={guided_brief:brief,chunks:[{id:'source1',source_id:'source1',text:'A family cafe in Mumbai',page:1,website_url:null}],reviewed:[]};
const direction={summary:'A family cafe in Mumbai',rationale:'Proposed warm, welcoming photography',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Warm and welcoming',imagery:'Natural daylight and real food',pillars:['Meet the cafe','Everyday rituals'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Three scenes: arrival, a coffee close-up, and a shared table.'}],essential_questions:[],evidence_ids:['source1']};
const result={findings:[],recommendation:null,missing:[],business_direction:direction};
test('guided brief validates required answers and stale revisions',()=>{
 assert.deepEqual(guidedBrief(brief,true),brief);
 assert.throws(()=>guidedBrief({...brief,audience:''},true));
 assert.throws(()=>guidedBrief({...brief,secret:'x'}));
 assert.throws(()=>requireGuidedRevision(2,1));
 assert.throws(()=>nextDirectionVersion([{ordinal:1,status:'ready'},{ordinal:2,status:'locked'}]));
 assert.equal(nextDirectionVersion([{ordinal:1,status:'failed'},{ordinal:2,status:'ready'}]),3);
 assert.throws(()=>nextDirectionVersion([{ordinal:1,status:'unknown'}]));
});
test('dedicated research uses strict schema and data-only brief, preserves legacy contract',()=>{
 const request=analysisRequest(input,'configured-model');
 assert.equal(request.body.text.format.schema.properties.business_direction.type,'object');
 assert.deepEqual(JSON.parse(request.body.input).guided_brief,brief);
 assert.match(request.body.instructions,/untrusted context/);
 assert.deepEqual(validateAnalysis(result,input),result);
 const legacy={...input};delete legacy.guided_brief;
 assert.equal(analysisRequest(legacy,'configured-model').body.text.format.schema.properties.business_direction,undefined);
 assert.throws(()=>validateAnalysis(result,legacy));
});
test('unsupported fonts, citations, excess questions and invalid direction fail closed during repair',()=>{
 for(const patch of [{heading_font:'Unavailable font'},{evidence_ids:['invented']},{essential_questions:['one','two','three']},{palette:[{role:'primary',hex:'red'}]}]){
  const bad={...result,business_direction:{...direction,...patch}};
  assert.throws(()=>validateAnalysis(bad,input));assert.throws(()=>recoverAnalysis(bad,input));
 }
 const badFinding={field:'offering',value:'Made up',chunk_id:'source1',quote:'not in the source'};
 const recovered=recoverAnalysis({...result,findings:[badFinding]},input);
 assert.deepEqual(recovered.findings,[]);assert.deepEqual(recovered.business_direction,direction);
});

const details={business_name:'Courtyard',website:'https://example.com',business_type:'services',industry:'local',cta:'Visit us',differentiator:'Neighbourhood service',timing:'',competitors:[],priority_offers:'',folder_url:'',guidelines:'Keep our approved logo',references:['groomday-01','style-cinematic']};
test('extended onboarding preserves ranked references and rejects unknown selections and unsafe links',()=>{
 assert.deepEqual(guidedBrief({...brief,details}).details.references,details.references);
 assert.throws(()=>guidedBrief({...brief,details:{...details,references:['invented']}}));
 assert.throws(()=>guidedBrief({...brief,details:{...details,references:['groomday-01','groomday-01']}}));
 assert.throws(()=>guidedBrief({...brief,details:{...details,website:'javascript:alert(1)'}}));
 assert.throws(()=>guidedBrief({...brief,details:{...details,competitors:['a','b','c','d']}}));
 assert.equal(guidedBrief({...brief,details:{...details,website:''}}).details.website,'');
 const request=analysisRequest({...input,guided_brief:{...brief,details}});
 assert.match(JSON.stringify(request),/Friendly, candid photography/);
});


test('new questionnaires reuse only unambiguous approved facts within field limits',async()=>{
 const {initialGuidedBrief}=await import('../../dist/guided-business.js');
 const result=initialGuidedBrief({facts:[{field:'offering',value:'Family homes'},{field:'audience',value:'Young families'},{field:'prohibited_claims',value:'No promised returns'},{field:'voice',value:'Warm'}]});
 assert.equal(result.offering,'Family homes');assert.equal(result.audience,'Young families');
 assert.equal(result.must_follow,'No promised returns');assert.equal(result.visual_direction,'');
 assert.equal(initialGuidedBrief({facts:[{field:'offering',value:'A'},{field:'offering',value:'B'}]}).offering,'');
 assert.equal(initialGuidedBrief({facts:[{field:'audience',value:'x'.repeat(601)}]}).audience,'');
 assert.equal(initialGuidedBrief(null).offering,'');
});

test('reading saved questionnaire never replaces intentionally cleared answers',async()=>{
 const {GuidedBusiness}=await import('../../dist/guided-business.js');
 const saved={revision:3,step:2,brief:{...brief,offering:'',audience:''}};
 const queries=[];
 const service=new GuidedBusiness({resolve:async()=>({organization_id:'org'}),database:{transaction:async(user,org,write,fn,brand)=>{
  assert.equal(user,'user');assert.equal(org,'org');assert.equal(brand,'brand');assert.equal(write,false);
  return fn({query:async(sql)=>{queries.push(sql);return {rows:sql.includes('guided_business_briefs')?[saved]:[]};}});
 }}},null);
 // Researched suggestions are offered beside the answers; they never fill or change them.
 assert.deepEqual(await service.read('user','brand'),{...saved,suggestions:{audience:[],competitors:[]},onboarding:{social_profile_limit:1,channels:[]}});
 assert.equal(queries.filter(sql=>sql.includes('guided_business_briefs')).length,1);
 assert.ok(!queries.some(sql=>sql.includes('brand_brain_versions')),'Existing drafts do not read or merge approved defaults');
});


test('starter ideas require both preview formats and bounded text; saved legacy boards stay editable',async()=>{
 const {validateBusinessDirection,starterIdeaPrompt}=await import('../../dist/business-research-direction.js');
 const legacy={...direction};delete legacy.starter_ideas;
 assert.throws(()=>validateBusinessDirection(legacy,['source1']));
 assert.deepEqual(validateBusinessDirection(legacy,['source1'],true),legacy);
 assert.equal(starterIdeaPrompt(legacy,'static'),'');
 for(const starter_ideas of [[],[direction.starter_ideas[0]],Array(2).fill(direction.starter_ideas[0]),[{...direction.starter_ideas[0],title:'x'.repeat(101)},direction.starter_ideas[1]],[{...direction.starter_ideas[0],concept:'bad\ntext'},direction.starter_ideas[1]],[{...direction.starter_ideas[0],extra:'injected'},direction.starter_ideas[1]]]){
  assert.throws(()=>validateBusinessDirection({...direction,starter_ideas},['source1']));
  assert.throws(()=>validateBusinessDirection({...direction,starter_ideas},['source1'],true));
 }
 assert.match(starterIdeaPrompt(direction,'static'),/A place to meet/);
 assert.doesNotMatch(starterIdeaPrompt(direction,'static'),/An everyday ritual/);
 assert.match(starterIdeaPrompt(direction,'carousel'),/An everyday ritual/);
 assert.match(starterIdeaPrompt(direction,'carousel'),/revision feedback takes precedence/);
});

test('onboarding keeps one profile choice, rejects malformed input and preserves legacy briefs',()=>{
 const social_profile={platform:'instagram',handle:'@courtyard'};
 assert.deepEqual(guidedBrief({...brief,details:{...details,social_profile}}).details.social_profile,social_profile);
 assert.equal(guidedBrief({...brief,details}).details.social_profile,undefined);
 for(const social_profile of [{platform:'unknown',handle:''},{platform:'help',handle:'@someone'},[{platform:'instagram',handle:''}],{platform:'instagram',handle:'x'.repeat(201)},{platform:'instagram',handle:'',token:'secret'}])assert.throws(()=>guidedBrief({...brief,details:{...details,social_profile}}));
});

test('monthly plan rejects multiple platforms before planning or generation',async()=>{
 const {GuidedCampaigns}=await import('../../dist/guided-campaigns.js');
 const service=new GuidedCampaigns(null,null,['instagram','facebook']);
 assert.throws(()=>service.create('user','brand',{moodboard_id:'11111111-1111-4111-8111-111111111111',starts_on:'2026-12-01',duration:'month',channels:['instagram','facebook'],static_count:2,carousel_count:0,video_count:0,timezone:'UTC'},'profile-plan-test'),/Choose one available platform/);
});

// ---- Research feeds the direction: audience suggestions and competitor gaps ----
test('the direction asks for evidence-grounded audience suggestions and competitor gaps',()=>{
 const schema=analysisRequest(input,'configured-model').body.text.format.schema.properties.business_direction;
 assert.equal(schema.properties.audience_suggestions.type,'array');assert.equal(schema.properties.competitor_gaps.type,'array');
 assert.ok(schema.required.includes('audience_suggestions')&&schema.required.includes('competitor_gaps'));
 assert.match(analysisRequest(input,'configured-model').body.instructions,/audience_suggestions/);
});
test('new direction fields are bounded while saved legacy directions stay valid',()=>{
 const full={...direction,audience_suggestions:['Parents near Bandra who want a relaxed weekend brunch','Remote workers looking for a calm table before noon','Families planning small birthday meals'],competitor_gaps:['No nearby cafe shows how its food is prepared']};
 assert.deepEqual(validateAnalysis({...result,business_direction:full},input).business_direction,full);
 // Results saved before this change have neither field.
 assert.deepEqual(validateAnalysis(result,input).business_direction,direction);
 assert.deepEqual(validateAnalysis({...result,business_direction:{...full,competitor_gaps:[]}},input).business_direction.competitor_gaps,[]);
 for(const patch of [{audience_suggestions:['a','b','c','d']},{audience_suggestions:['same','same']},{audience_suggestions:['x'.repeat(201)]},{audience_suggestions:'People'},{audience_suggestions:['']},{competitor_gaps:Array(6).fill(0).map((_,i)=>`gap ${i}`)},{competitor_gaps:['x'.repeat(301)]},{competitor_gaps:[7]}])
  assert.throws(()=>validateAnalysis({...result,business_direction:{...full,...patch}},input),/AI_OUTPUT_INVALID/,JSON.stringify(patch).slice(0,60));
});
test('market evidence informs the direction but can never become a brand fact suggestion',()=>{
 const market={id:'market1',source_id:'market-source',text:'AI market research note:\nCompetitor positioning · Rival\nRival calls itself the fastest cafe in Mumbai.',page:1,website_url:'https://rival.test/',origin:'market'};
 const mixed={...input,chunks:[...input.chunks,market]};
 const request=analysisRequest(mixed,'configured-model');
 assert.match(request.body.instructions,/origin "market"/);assert.doesNotMatch(analysisRequest(input,'configured-model').body.instructions,/origin "market"/);
 assert.equal(JSON.parse(request.body.input).chunks[1].origin,'market');
 const stolen={field:'positioning',value:'The fastest cafe in Mumbai',chunk_id:'market1',quote:'the fastest cafe in Mumbai'};
 assert.throws(()=>validateAnalysis({...result,findings:[stolen]},mixed),/AI_OUTPUT_INVALID/);
 // Recovery keeps the direction, drops the competitor claim and says so.
 const recovered=recoverAnalysis({...result,findings:[stolen]},mixed);assert.deepEqual(recovered.findings,[]);assert.equal(recovered.missing.length,1);
 // A proposal may still cite what the market research showed.
 const grounded={...direction,evidence_ids:['source1','market1'],competitor_gaps:['Rivals compete on speed; nobody talks about the family welcome']};
 assert.deepEqual(validateAnalysis({...result,business_direction:grounded},mixed).business_direction,grounded);
 // The business's own evidence is still accepted for facts.
 const own={field:'offering',value:'A family cafe',chunk_id:'source1',quote:'A family cafe in Mumbai'};
 assert.equal(validateAnalysis({...result,findings:[own]},mixed).findings.length,1);
});
test('questionnaire suggestions are read back as bounded, untrusted display data',async()=>{
 const {researchSuggestions}=await import('../../dist/guided-campaign-contracts.js');
 assert.deepEqual(researchSuggestions(undefined,undefined),{audience:[],competitors:[]});
 assert.deepEqual(researchSuggestions('People',{name:'x'}),{audience:[],competitors:[]});
 const result=researchSuggestions([' Parents near Bandra ','Parents near Bandra',7,'','x'.repeat(201),'bad\u0000text','Remote workers','Families','A fourth'],
  [{name:'Third Chair',url:'https://third-chair.test/'},{name:'Third Chair again',url:'https://third-chair.test/'},{name:'Script',url:'javascript:alert(1)'},{name:'Creds',url:'https://user:pass@x.test/'},{name:'',url:'https://y.test/'},null,{name:'B',url:'https://b.test/'},{name:'C',url:'https://c.test/'},{name:'D',url:'https://d.test/'}]);
 assert.deepEqual(result.audience,['Parents near Bandra','Remote workers','Families']);
 assert.deepEqual(result.competitors,[{name:'Third Chair',url:'https://third-chair.test/'},{name:'B',url:'https://b.test/'},{name:'C',url:'https://c.test/'}]);
});
