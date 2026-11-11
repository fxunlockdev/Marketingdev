import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guidedBrief,nextDirectionVersion,requireGuidedRevision} from '../../dist/guided-campaign-contracts.js';
import {analysisRequest,validateAnalysis,recoverAnalysis} from '../../dist/brand-analysis.js';
const brief={offering:'Cafe',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Recommend a direction',must_follow:'No invented prices'};
const input={guided_brief:brief,chunks:[{id:'source1',source_id:'source1',text:'A family cafe in Mumbai',page:1,website_url:null}],reviewed:[]};
const direction={summary:'A family cafe in Mumbai',rationale:'Proposed warm, welcoming photography',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Warm and welcoming',imagery:'Natural daylight and real food',pillars:['Meet the cafe','Everyday rituals'],essential_questions:[],evidence_ids:['source1']};
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
 let queries=0;
 const service=new GuidedBusiness({resolve:async()=>({organization_id:'org'}),database:{transaction:async(user,org,write,fn,brand)=>{
  assert.equal(user,'user');assert.equal(org,'org');assert.equal(brand,'brand');assert.equal(write,false);
  return fn({query:async()=>{queries++;return {rows:[saved]};}});
 }}},null);
 assert.deepEqual(await service.read('user','brand'),saved);
 assert.equal(queries,1,'Existing drafts do not read or merge approved defaults');
});
