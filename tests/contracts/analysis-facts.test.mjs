import {test} from 'node:test';
import assert from 'node:assert/strict';
import {factValue,polishAnalysis,analysisRequest,BrandAnalyzer} from '../../dist/brand-analysis.js';

const details={social_profile:{platform:'help',handle:''},business_name:'Runwal Enterprises',website:'https://runwal.test/',business_type:'both',industry:'property',cta:'Book a visit',differentiator:'Integrated townships',timing:'',competitors:['Lodha'],priority_offers:'3 BHK',folder_url:'',guidelines:'',references:[]};
const brief={offering:'Residential apartments',audience:'Families buying a first home',market:'Mumbai',goal:'leads',visual_direction:'',must_follow:'No price promises',details};

test('finding values state the fact, never narrate the research (live dev2 defect)',()=>{
 assert.equal(factValue('The supplied research describes residential properties, integrated townships and commercial spaces'),'Residential properties, integrated townships and commercial spaces');
 assert.equal(factValue('Research notes identify homebuyers, residents and families across Mumbai'),'Homebuyers, residents and families across Mumbai');
 assert.equal(factValue('The research suggests a premium community-living position built on townships'),'A premium community-living position built on townships');
 assert.equal(factValue('According to the website, apartments in Mumbai and Pune'),'Apartments in Mumbai and Pune');
 assert.equal(factValue('The evidence shows that families visit on weekends'),'Families visit on weekends');
 assert.equal(factValue('Residential apartments and integrated townships in Mumbai and Pune'),'Residential apartments and integrated townships in Mumbai and Pune');
 assert.equal(factValue('Websites for local shops'),'Websites for local shops');
 assert.equal(factValue('The research suggests '),null);
});

const answers=JSON.stringify({brand_name:'ts',...brief,details:{...details,business_name:'ts'}});
const input={guided_brief:{...brief,details:{...details,business_name:'ts'}},reviewed:[],chunks:[
 {id:'site',source_id:'s1',text:'Runwal Enterprises builds homes in Mumbai and Pune.',page:1,website_url:'https://runwal.test/'},
 {id:'answers',source_id:'s2',text:answers,page:1,website_url:null},
]};
const base={findings:[],recommendation:null,missing:[]};

test('polished analysis strips meta openings and drops findings with no fact left',()=>{
 const out=polishAnalysis({...base,findings:[
  {field:'offering',value:'The supplied research describes residential apartments',chunk_id:'site',quote:'builds homes'},
  {field:'audience',value:'Research notes identify ',chunk_id:'site',quote:'Mumbai'},
 ],recommendation:{goal:'leads',audience:'Research notes identify families',channels:[],cadence:3,reason:'Families buy homes',chunk_ids:['site']}},{...input,guided_brief:undefined});
 assert.deepEqual(out.findings.map(f=>[f.field,f.value]),[['offering','Residential apartments']]);
 assert.equal(out.recommendation.audience,'Families');
});

test('a typed name that differs from the website name becomes a conflicting brand_name suggestion (live dev2 defect)',()=>{
 const out=polishAnalysis({...base,findings:[{field:'brand_name',value:'Runwal Enterprises',chunk_id:'site',quote:'Runwal Enterprises'}]},input);
 assert.deepEqual(out.findings.map(f=>[f.field,f.value,f.chunk_id]),[['brand_name','Runwal Enterprises','site'],['brand_name','ts','answers']]);
 const typed=out.findings[1];assert.ok(input.chunks[1].text.includes(typed.quote));
 assert.match(out.missing.at(-1),/"ts".*"Runwal Enterprises"/);
 // The same name, written differently, is not a conflict.
 const same=polishAnalysis({...base,findings:[{field:'brand_name',value:'TS',chunk_id:'site',quote:'Runwal'}]},input);
 assert.equal(same.findings.length,1);assert.equal(same.missing.length,0);
 // Without a typed name or a website name there is nothing to compare.
 assert.equal(polishAnalysis(base,input).findings.length,0);
});

test('analysis instructions ask for facts in the business terms and the website brand name',()=>{
 const {body}=analysisRequest(input,'MOCK-model');
 assert.match(body.instructions,/Never narrate the research/);
 assert.match(body.instructions,/even when it differs from the name the owner typed/);
});

test('the analyzer returns polished findings from a MOCK provider answer',async()=>{
 const plain={guided_brief:undefined,reviewed:[],chunks:[input.chunks[0]]};
 const answer={findings:[{field:'offering',value:'The supplied research describes homes in Mumbai and Pune',chunk_id:'site',quote:'builds homes in Mumbai and Pune'}],recommendation:null,missing:[]};
 const sdk={responses:{create:async()=>({id:'resp_mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}],output_text:JSON.stringify(answer),usage:{input_tokens:1,output_tokens:1}})}};
 const {result}=await new BrandAnalyzer(undefined,sdk).analyze(plain,'MOCK-model');
 assert.deepEqual(result.findings.map(f=>f.value),['Homes in Mumbai and Pune']);
});
