import test from 'node:test';import assert from 'node:assert/strict';
import {researchRequest,researchPages,RESEARCH_MODEL} from '../../dist/openai-website-research.js';
const text='Acme makes scheduling tools for dental practices. [Source](https://example.org/about)';
const response=()=>({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text,annotations:[{type:'url_citation',url:'https://example.org/about',start_index:49,end_index:text.length}]}]}]});
test('GPT research is domain-restricted, capped and uses the pinned economical model',()=>{
 const r=researchRequest('https://www.example.org/');assert.equal(r.model,RESEARCH_MODEL);assert.equal(r.max_tool_calls,3);assert.equal(r.max_output_tokens,4000);assert.equal(r.store,false);assert.equal(r.tool_choice,'required');assert.deepEqual(r.tools[0].filters.allowed_domains,['example.org']);assert.equal(r.reasoning.effort,'low');
 for(const u of ['http://127.0.0.1','https://metadata.internal','https://user:pass@example.org'])assert.throws(()=>researchRequest(u));
});
test('research notes retain citation provenance without pretending to be raw website excerpts',()=>{
 const pages=researchPages(response(),'https://example.org');assert.equal(pages.length,1);assert.equal(pages[0].url,'https://example.org/about');assert.equal(pages[0].coverage,'ai_web_research');assert.match(pages[0].chunks[0].text,/not a verbatim website excerpt/);
});
test('no search, unfinished results, missing citations and foreign sources fail closed',()=>{
 for(const mutate of [r=>r.output.shift(),r=>r.status='incomplete',r=>r.output[1].content[0].annotations=[],r=>r.output[1].content[0].annotations[0].url='https://example.org.evil.test/',r=>r.output[1].content[0].annotations[0].url='http://127.0.0.1/',r=>r.output[1].content[0].annotations[0].end_index=text.length+1]){
  const r=response();mutate(r);assert.throws(()=>researchPages(r,'https://example.org'),/AI_/);
 }
});
test('uncited paragraphs are never presented as sourced research',()=>{
 const r=response();r.output[1].content[0].text+='\n\nUnsupported claim about market leadership.';
 const pages=researchPages(r,'https://example.org');assert.equal(pages.length,1);assert.doesNotMatch(pages[0].chunks[0].text,/market leadership/);
});

 test('research errors distinguish access, quota and rate limits without exposing provider payloads',async()=>{
 const {default:OpenAI}=await import('openai');const {researchFailure}=await import('../../dist/openai-website-research.js');
 for(const [status,providerCode,expected] of [[401,null,'AI_PROVIDER_AUTH_FAILED'],[403,null,'AI_PROVIDER_ACCESS_DENIED'],[404,null,'AI_MODEL_UNAVAILABLE'],[429,'insufficient_quota','AI_PROVIDER_QUOTA_EXHAUSTED'],[429,'rate_limit_exceeded','AI_PROVIDER_RATE_LIMITED'],[400,null,'AI_RESEARCH_REQUEST_REJECTED'],[500,null,'AI_RESEARCH_SUBMISSION_UNKNOWN']]){
  const e=OpenAI.APIError.generate(status,{error:{code:providerCode,message:'SECRET provider payload'}},'SECRET',new Headers());
  const result=researchFailure(e);assert.equal(result.code,expected);assert.equal(result.known,status<500);assert.ok(!JSON.stringify(result).includes('SECRET'));
 }
 assert.equal(researchFailure(new Error('timeout')).known,false);
 });

// One website page may support several separately cited research paragraphs.
test('repeated page citations retain distinct paragraphs without exhausting the source cap',()=>{
 const r=response();const paragraphs=Array.from({length:15},(_,i)=>`Supported detail ${i}. Source`);
 const combined=paragraphs.join('\n\n');let offset=0;
 r.output[1].content[0]={type:'output_text',text:combined,annotations:paragraphs.map((p,i)=>{const start=offset;offset+=p.length+2;return {type:'url_citation',url:'https://example.org/about',start_index:start+p.indexOf('Source'),end_index:start+p.length};})};
 const pages=researchPages(r,'https://example.org');assert.equal(pages.length,1);assert.equal(pages[0].chunks.length,15);assert.match(pages[0].chunks[14].text,/detail 14/);
 const duplicate=structuredClone(r.output[1]);r.output.push(duplicate);assert.deepEqual(researchPages(r,'https://example.org'),pages);
 r.output[1].content[0].text=combined.replace('detail 14','detail 99');r.output.pop();assert.notEqual(researchPages(r,'https://example.org')[0].sha256,pages[0].sha256);
});

test('completed research without citations falls back once and persists reusable direct evidence',async()=>{
 const {OpenAIWebsiteResearch}=await import('../../dist/openai-website-research.js');let saved=null,paid=0,direct=0;
 const db={query:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM app.analysis_calls'))return {rows:saved?[{status:'succeeded',result:saved}]:[]};
  if(sql.includes('website_capture_calls'))return {rowCount:0,rows:[]};
  if(sql.includes('analysis_grants'))return {rows:[{budget_micros:6000000}]};
  if(sql.includes('sum(reserved_micros)'))return {rows:[{used:0}]};
  if(sql.includes("SET status='succeeded'")){saved=JSON.parse(args[2]);return {rows:[]};}
  return {rows:[{revision:1}],rowCount:1};
 }};
 const jobs={transaction:async(_,fn)=>fn(db,{id:'job',kind:'website.extract',organization_id:'org',brand_id:'brand'}),permitted:async()=>true};
 const pages=[{url:'https://example.org/',coverage:'server_html_only',chunks:[{text:'Actual page text',anchor:'html:1'}],sha256:'1',parserVersion:'website-text-v1',links:[],truncated:false}];
 const provider=new OpenAIWebsiteResearch(undefined,{responses:{create:async()=>{paid++;return {id:'response',status:'completed',output:[{type:'web_search_call',status:'completed'}],usage:{input_tokens:100}};}}},undefined,{capture:async()=>{direct++;return pages;}});
 const first=await provider.capture(jobs,{},'https://example.org/');assert.deepEqual(first.pages,pages);assert.equal(first.coverage.method,'direct_website_text');
 const second=await provider.capture(jobs,{},'https://example.org/');assert.deepEqual(second.pages,pages);assert.equal(paid,1);assert.equal(direct,1);
});
