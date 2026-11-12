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

// ---- Market and competitor research: a second, separately recorded request ----
const marketBrief={offering:'Scheduling tools for dental practices',audience:'Practice managers',market:'Lisbon',goal:'leads',visual_direction:'',must_follow:'',details:{social_profile:{platform:'instagram',handle:'@acmedental'},business_name:'Acme',website:'https://example.org/',business_type:'services',industry:'professional',cta:'',differentiator:'',timing:'',competitors:['Rival One','https://rival-two.test'],priority_offers:'',folder_url:'',guidelines:'',references:[]}};
const marketOutput=()=>({notes:[
 {section:'market_language',subject:'',text:'Practices talk about "no-shows" and "chair time".',source_url:'https://trade.test/guide'},
 {section:'competitor_positioning',subject:'Rival One',text:'Positions itself as the all-in-one front desk.',source_url:'https://rival-one.test/'},
 {section:'audience_pain',subject:'',text:'"We lose two hours a day to phone tag."',source_url:'https://forum.test/thread?utm_source=openai'},
 {section:'content_gap',subject:'',text:'Nobody explains recall scheduling with real examples.',source_url:'https://trade.test/guide'},
 {section:'competitor_offers',subject:'Rival One',text:'Invented claim with a source that was never consulted.',source_url:'https://never-opened.test/'}],
 discovered_competitors:[{name:'Third Chair',url:'https://third-chair.test/',reason:'Sells reminders to the same practices.'},{name:'Self',url:'https://www.example.org/',reason:'The business itself.'},{name:'Ghost',url:'https://ghost.test/',reason:'Never consulted.'}]});
const marketResponse=(value=marketOutput())=>({id:'resp_market',status:'completed',usage:{input_tokens:10},output:[
 {type:'web_search_call',status:'completed',action:{type:'search',query:'dental scheduling',sources:[{type:'url',url:'https://trade.test/guide'},{type:'url',url:'https://rival-one.test'},{type:'url',url:'https://third-chair.test/pricing'}]}},
 {type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://forum.test/thread'}},
 {type:'message',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}]});
test('market research is a separate, unrestricted, capped request built only from the saved brief',async()=>{
 const {marketResearchRequest,MARKET_RESEARCH_RESERVATION_MICROS,RESEARCH_RESERVATION_MICROS}=await import('../../dist/openai-website-research.js');
 const {reservationRates}=await import('../../dist/model-policy.js');
 const r=marketResearchRequest('https://www.example.org/',marketBrief);
 assert.equal(r.model,RESEARCH_MODEL);assert.equal(r.store,false);assert.equal(r.max_tool_calls,8);assert.equal(r.max_output_tokens,8000);assert.equal(r.tool_choice,'required');
 assert.equal(r.tools.length,1);assert.equal(r.tools[0].type,'web_search');assert.equal(r.tools[0].filters,undefined);
 assert.equal(r.text.format.type,'json_schema');assert.equal(r.text.format.strict,true);
 const input=JSON.parse(r.input);assert.equal(input.business.name,'Acme');assert.equal(input.business.market,'Lisbon');assert.equal(input.business.industry,'professional');
 assert.deepEqual(input.named_competitors,['Rival One','https://rival-two.test']);assert.deepEqual(input.social_profile,{platform:'instagram',handle:'@acmedental'});
 assert.match(r.instructions,/untrusted/i);assert.match(r.instructions,/never cop/i);
 // The customer's answers travel as data, never inside the instructions.
 assert.ok(!r.instructions.includes('Rival One')&&!r.instructions.includes('Acme'));
 const rates=reservationRates('research');
 assert.ok(MARKET_RESEARCH_RESERVATION_MICROS>=8000*rates.output_micros_per_token+200000*rates.input_micros_per_token);
 assert.ok(MARKET_RESEARCH_RESERVATION_MICROS>RESEARCH_RESERVATION_MICROS&&Number.isSafeInteger(MARKET_RESEARCH_RESERVATION_MICROS));
 assert.throws(()=>marketResearchRequest('http://127.0.0.1',marketBrief));
 // A brief without the optional details still produces a bounded request.
 const {details,...plain}=marketBrief;const bare=JSON.parse(marketResearchRequest('https://example.org/',plain).input);
 assert.equal(bare.business.name,'example.org');assert.deepEqual(bare.named_competitors,[]);assert.equal(bare.social_profile,null);
});
test('market notes keep their own source, are tagged apart from own-site research and drop unconsulted sources',async()=>{
 const {marketResearchPages,MARKET_RESEARCH_VERSION}=await import('../../dist/openai-website-research.js');
 const {pages,discovered}=marketResearchPages(marketResponse(),'https://example.org/');
 assert.deepEqual(pages.map(p=>p.url).sort(),['https://forum.test/thread','https://rival-one.test/','https://trade.test/guide']);
 assert.ok(pages.every(p=>p.coverage==='ai_market_research'&&p.parserVersion===MARKET_RESEARCH_VERSION&&/^[a-f0-9]{64}$/.test(p.sha256)));
 const trade=pages.find(p=>p.url==='https://trade.test/guide');assert.equal(trade.chunks.length,2);
 assert.ok(pages.flatMap(p=>p.chunks).every(c=>/analysis only/.test(c.text)&&/never an approved brand fact/.test(c.text)&&c.anchor.startsWith('ai-market:')&&c.anchor.length<=200));
 assert.match(pages.find(p=>p.url==='https://rival-one.test/').chunks[0].text,/Competitor positioning · Rival One/);
 assert.ok(!JSON.stringify(pages).includes('Invented claim'));
 assert.deepEqual(discovered,[{name:'Third Chair',url:'https://third-chair.test/'}]);
});
test('market research fails closed on unfinished, refused, unsearched, malformed or wholly unsourced output',async()=>{
 const {marketResearchPages}=await import('../../dist/openai-website-research.js');
 for(const mutate of [r=>r.status='incomplete',r=>r.output.splice(0,2),r=>r.output[2].content[0].text='not json',r=>r.output[2].content=[{type:'refusal',refusal:'no'}],
  r=>r.output[2].content[0].text=JSON.stringify({notes:[{section:'content_gap',subject:'',text:'x',source_url:'https://never-opened.test/'}],discovered_competitors:[]}),
  r=>r.output[2].content[0].text=JSON.stringify({notes:[{section:'content_gap',subject:'',text:'x',source_url:'http://127.0.0.1/'}],discovered_competitors:[]}),
  r=>{for(let i=0;i<8;i++)r.output.unshift({type:'web_search_call',status:'completed',action:{type:'search'}});}]){
  const r=marketResponse();mutate(r);assert.throws(()=>marketResearchPages(r,'https://example.org/'),/AI_/);
 }
 const oversized=marketOutput();oversized.notes[0].text='x'.repeat(1201);oversized.notes[1].section='brand_fact';
 const {pages}=marketResearchPages(marketResponse(oversized),'https://example.org/');assert.ok(!JSON.stringify(pages).includes('xxxx')&&!pages.some(p=>p.url==='https://rival-one.test/'));
});
const marketLedger=({budget=100000000,used=0,monthly=false}={})=>{
 const state={row:null,inserts:0};
 const db={query:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM app.market_research_calls'))return {rows:state.row?[state.row]:[]};
  if(sql.includes('analysis_grants'))return {rows:budget===null?[]:[{budget_micros:budget}]};
  if(sql.includes('sum(reserved_micros)'))return {rows:[{used}]};
  if(sql.startsWith('INSERT INTO app.market_research_calls')){if(monthly)throw Object.assign(new Error('MONTHLY_GENERATION_BUDGET_EXHAUSTED'),{code:'P0001'});state.inserts++;state.row={status:'submitted',reserved_micros:args[4]};return {rows:[]};}
  if(sql.startsWith('UPDATE app.market_research_calls')){state.row={...state.row,status:sql.includes("'succeeded'")?'succeeded':args[1],result:JSON.parse(sql.includes("'succeeded'")?args[2]:args[2])};return {rows:[]};}
  return {rows:[{revision:1}],rowCount:1};
 }};
 return {state,jobs:{transaction:async(_,fn)=>fn(db,{id:'job',kind:'website.extract',organization_id:'org',brand_id:'brand'}),permitted:async()=>true}};
};
test('the market step reserves once, replays its saved result and never pays twice',async()=>{
 const {OpenAIWebsiteResearch,MARKET_RESEARCH_RESERVATION_MICROS}=await import('../../dist/openai-website-research.js');let paid=0;
 const {state,jobs}=marketLedger();
 const provider=new OpenAIWebsiteResearch(undefined,{responses:{create:async(body)=>{paid++;assert.equal(body.max_tool_calls,8);return marketResponse();}}});
 const first=await provider.market(jobs,{},'https://example.org/',marketBrief);
 assert.equal(first.pages.length,3);assert.equal(first.summary.status,'completed');assert.equal(first.summary.notes,4);assert.deepEqual(first.summary.discovered_competitors,[{name:'Third Chair',url:'https://third-chair.test/'}]);
 assert.equal(state.row.reserved_micros,MARKET_RESEARCH_RESERVATION_MICROS);
 const second=await provider.market(jobs,{},'https://example.org/',marketBrief);assert.deepEqual(second,first);assert.equal(paid,1);assert.equal(state.inserts,1);
});
test('a failed or uncertain market step never fails own-site research and is never retried',async()=>{
 const {OpenAIWebsiteResearch}=await import('../../dist/openai-website-research.js');
 for(const [failure,status,code] of [[new Error('socket hang up'),'unknown','AI_RESEARCH_SUBMISSION_UNKNOWN'],[null,'rejected','AI_RESEARCH_NO_SOURCES']]){
  let paid=0;const {state,jobs}=marketLedger();
  const provider=new OpenAIWebsiteResearch(undefined,{responses:{create:async()=>{paid++;if(failure)throw failure;const r=marketResponse();r.output.splice(0,2);return r;}}});
  const first=await provider.market(jobs,{},'https://example.org/',marketBrief);
  assert.deepEqual(first.pages,[]);assert.equal(first.summary.status,'unavailable');assert.equal(first.summary.code,code);assert.equal(state.row.status,status);
  const replay=await provider.market(jobs,{},'https://example.org/',marketBrief);assert.equal(replay.summary.code,code);assert.equal(paid,1);
 }
});
test('the market step is skipped without spending when there is no brief, grant, budget or key',async()=>{
 const {OpenAIWebsiteResearch}=await import('../../dist/openai-website-research.js');let paid=0;const sdk={responses:{create:async()=>{paid++;return marketResponse();}}};
 for(const [ledger,client,brief,code] of [[marketLedger(),sdk,null,'NO_GUIDED_BRIEF'],[marketLedger({budget:null}),sdk,marketBrief,'AI_STAGING_APPROVAL_REQUIRED'],[marketLedger({budget:1000}),sdk,marketBrief,'AI_BUDGET_EXHAUSTED'],[marketLedger({monthly:true}),sdk,marketBrief,'MONTHLY_GENERATION_BUDGET_EXHAUSTED'],[marketLedger(),undefined,marketBrief,'AI_NOT_CONFIGURED']]){
  const result=await new OpenAIWebsiteResearch(undefined,client).market(ledger.jobs,{},'https://example.org/',brief);
  assert.equal(result.summary.status,'skipped');assert.equal(result.summary.code,code);assert.deepEqual(result.pages,[]);assert.equal(ledger.state.inserts,0);
 }
 assert.equal(paid,0);
 const revoked=marketLedger();revoked.jobs.permitted=async()=>false;
 await assert.rejects(new OpenAIWebsiteResearch(undefined,sdk).market(revoked.jobs,{},'https://example.org/',marketBrief),/ACCESS_REVOKED_OR_CANCELED/);
});

// ---- Source fallback: search-call sources and output-text citations both count ----
const citedResponse=({sources,annotations})=>{
 const value={notes:[{section:'market_language',subject:'',text:'Buyers say "chair time".',source_url:'https://trade.test/guide'},{section:'audience_pain',subject:'',text:'Phone tag wastes mornings.',source_url:'https://forum.test/thread'}],discovered_competitors:[{name:'Third Chair',url:'https://third-chair.test/',reason:'Same buyers.'}],audience_suggestions:[]};
 const text=JSON.stringify(value);
 return {id:'resp',status:'completed',output:[
  {type:'web_search_call',status:'completed',action:{type:'search',query:'dental',...(sources?{sources:[{type:'url',url:'https://trade.test/guide'},{type:'url',url:'https://forum.test/thread#top'},{type:'url',url:'https://third-chair.test/about'}]}:{})}},
  {type:'message',content:[{type:'output_text',text,annotations:annotations?[{type:'url_citation',url:'https://trade.test/guide?utm_source=openai',start_index:0,end_index:5},{type:'url_citation',url:'https://forum.test/thread',start_index:5,end_index:9},{type:'url_citation',url:'https://third-chair.test/',start_index:9,end_index:12},{type:'url_citation',url:'javascript:alert(1)',start_index:0,end_index:1}]:[]}]}]};
};
for(const [name,sources,annotations] of [['search sources only',true,false],['citation annotations only',false,true],['both, deduplicated',true,true]])test(`market notes keep a source found in ${name}`,async()=>{
 const {marketResearchPages}=await import('../../dist/openai-website-research.js');
 const {pages,discovered}=marketResearchPages(citedResponse({sources,annotations}),'https://example.org/');
 assert.deepEqual(pages.map(p=>p.url).sort(),['https://forum.test/thread','https://trade.test/guide']);
 assert.ok(pages.every(p=>p.chunks.length===1));
 assert.deepEqual(discovered,[{name:'Third Chair',url:'https://third-chair.test/'}]);
});
test('market notes with no source in either place are dropped, and the step fails closed',async()=>{
 const {marketResearchPages}=await import('../../dist/openai-website-research.js');
 assert.throws(()=>marketResearchPages(citedResponse({sources:false,annotations:false}),'https://example.org/'),/AI_RESEARCH_NO_SOURCES/);
});
test('consulted sources are bounded and only http(s)',async()=>{
 const {consultedSources}=await import('../../dist/openai-website-research.js');
 const many=Array.from({length:500},(_,i)=>({type:'url',url:`https://site${i}.test/`}));
 const r={output:[{type:'web_search_call',status:'completed',action:{sources:[{type:'url',url:'ftp://x.test/'},{type:'url',url:'http://127.0.0.1/'},...many]}},{type:'message',content:[{type:'output_text',text:'x',annotations:[{type:'url_citation',url:'https://cited.test/'}]}]}]};
 const consulted=consultedSources(r);
 assert.ok(consulted.size<=200);assert.ok(![...consulted.keys()].some(u=>!u.startsWith('http')||u.includes('127.0.0.1')));
 // Citations are never crowded out by a long list of search results.
 assert.ok(consulted.has('https://cited.test/'));
});
