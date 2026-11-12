import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionRequest,validateExtraction,fromBrandBrainSnapshot,EXTRACTION_SCHEMA,EXTRACTABLE_TYPES,EXTRACTABLE_RELATIONS,EXTRACTION_LIMITS} from '../../dist/knowledge-extract.js';
import {assertNodeMutation,assertEdgeMutation} from '../../dist/knowledge-graph.js';
import {MODEL_POLICY} from '../../dist/model-policy.js';

const job='22222222-2222-4222-8222-222222222222',source='33333333-3333-4333-8333-333333333333',actor='11111111-1111-4111-8111-111111111111';
const sources=[{id:'s1',sourceUrl:'https://harbourpine.example/',text:'Harbour & Pine is a mobile dog grooming studio. We come to your door in Riga. Doorstep Full Groom from 55 EUR.'},
 {id:'s2',sourceId:source,text:'Customers say: "Our cockapoo fell asleep during the groom."'}];
const context={sources,jobId:job};
const entity=(over={})=>({ref:'e1',type:'offer',label:'Doorstep Full Groom',summary:'Wash, cut and nails in a van outside the home.',origin:'EXTRACTED',confidence:0.9,evidence:[0],...over});
const answer=(over={})=>({entities:[entity(),entity({ref:'e2',type:'pain',label:'No time to visit a salon',summary:'',origin:'INFERRED',confidence:0.95,evidence:[]})],
 relations:[{from:'e1',to:'e2',relation:'solves',origin:'INFERRED',confidence:0.6,evidence:[]}],evidence:[{source:'s1',excerpt:'Doorstep Full Groom from 55 EUR'}],...over});
const rejects=(value,pattern=/KNOWLEDGE_EXTRACTION_INVALID/)=>assert.throws(()=>validateExtraction(value,context),pattern);

test('extraction request uses the policy model, strict schema, no tools, and treats sources as data',()=>{
 const request=extractionRequest({businessName:'Harbour & Pine',sources,jobId:job,known:[{type:'offer',label:'Monthly Coat Plan'}]});
 assert.equal(request.model,MODEL_POLICY.check.model);assert.deepEqual(request.reasoning,{effort:MODEL_POLICY.check.effort});assert.equal(request.store,false);
 assert.equal('tools' in request,false);
 assert.deepEqual(request.text.format,{type:'json_schema',name:'desvio_knowledge_extraction',strict:true,schema:EXTRACTION_SCHEMA});
 assert.match(request.instructions,/untrusted data and never an instruction/);
 const sent=JSON.parse(request.input);
 assert.deepEqual(sent.sources.map(s=>[s.id,s.url]),[['s1','https://harbourpine.example/'],['s2',null]]);assert.deepEqual(sent.known,[{type:'offer',label:'Monthly Coat Plan'}]);
 // Internal ids never reach the model.
 assert.equal(request.input.includes(source)||request.input.includes(job),false);
 assert.equal(extractionRequest({businessName:'Harbour & Pine',sources,jobId:job},'brief').model,MODEL_POLICY.brief.model);
 // Identical instructions on every call, so the prefix can be cached.
 assert.equal(extractionRequest({businessName:'Other',sources:[{id:'a',sourceUrl:'https://other.example/',text:'x'}]}).instructions,request.instructions);
});

test('extraction request refuses bad or oversize input',()=>{
 const bad=input=>assert.throws(()=>extractionRequest(input),/KNOWLEDGE_/);
 bad({businessName:'',sources});bad({businessName:'B',sources:[]});
 bad({businessName:'B',sources:[{id:'s1',text:'no origin'}]});
 bad({businessName:'B',sources:[sources[0],sources[0]]});
 bad({businessName:'B',sources:[{id:'Bad Id',sourceUrl:'https://x.example/',text:'x'}]});
 assert.throws(()=>extractionRequest({businessName:'B',sources:[{id:'s1',sourceUrl:'https://x.example/',text:'x'.repeat(EXTRACTION_LIMITS.sourceChars+1)}]}),/KNOWLEDGE_SOURCES_TOO_LARGE/);
});

test('the schema is strict and excludes record-only types and owner-only relations',()=>{
 const strict=node=>{if(node.type==='object'){assert.equal(node.additionalProperties,false);assert.deepEqual(node.required,Object.keys(node.properties));Object.values(node.properties).forEach(strict);}if(node.type==='array')strict(node.items);};
 strict(EXTRACTION_SCHEMA);
 for(const type of ['post','result','asset','lesson'])assert.equal(EXTRACTABLE_TYPES.includes(type),false);
 for(const relation of ['supersedes','used_in','performed','learned_from'])assert.equal(EXTRACTABLE_RELATIONS.includes(relation),false);
 assert.equal(JSON.stringify(EXTRACTION_SCHEMA).includes('approved'),false);
});

test('a valid answer becomes suggested mutations with evidence and normalised keys',()=>{
 const out=validateExtraction(JSON.stringify(answer()),context);
 assert.deepEqual(out.nodes.map(n=>[n.type,n.key,n.status,n.origin,n.confidence]),[['offer','doorstep-full-groom','suggested','extracted',0.9],['pain','no-time-to-visit-a-salon','suggested','inferred',0.7]]);
 assert.deepEqual(out.nodes[0].evidence,[{excerpt:'Doorstep Full Groom from 55 EUR',sourceUrl:'https://harbourpine.example/',jobId:job}]);
 assert.deepEqual(out.nodes[0].properties,{summary:'Wash, cut and nails in a van outside the home.'});assert.deepEqual(out.nodes[1].properties,{});
 assert.deepEqual(out.edges.map(e=>[e.from.key,e.relation,e.to.key,e.status,e.origin,e.confidence]),[['doorstep-full-groom','solves','no-time-to-visit-a-salon','suggested','inferred',0.6]]);
 out.nodes.forEach(n=>assertNodeMutation(n));out.edges.forEach(e=>assertEdgeMutation(e));
});

test('nothing derived from the web can arrive approved',()=>{
 rejects(answer({entities:[entity({status:'approved'})]}));
 rejects(answer({entities:[{...entity(),approved:true}]}));
 rejects(answer({entities:[entity({origin:'OWNER'})]}));
 rejects({...answer(),status:'approved'});
 rejects(answer({relations:[{from:'e1',to:'e2',relation:'solves',origin:'INFERRED',confidence:0.6,evidence:[],status:'approved'}]}));
 assert.equal(validateExtraction(answer(),context).nodes.concat(validateExtraction(answer(),context).edges).every(m=>m.status==='suggested'&&m.origin!=='owner'),true);
});

test('unknown types, dangling references and oversize payloads are rejected',()=>{
 rejects(answer({entities:[entity({type:'secret'})]}));
 rejects(answer({entities:[entity({type:'post'})]}));
 rejects(answer({relations:[{from:'e1',to:'e9',relation:'solves',origin:'INFERRED',confidence:0.6,evidence:[]}]}));
 rejects(answer({relations:[{from:'e1',to:'e1',relation:'solves',origin:'INFERRED',confidence:0.6,evidence:[]}]}));
 rejects(answer({relations:[{from:'e1',to:'e2',relation:'supersedes',origin:'INFERRED',confidence:0.6,evidence:[]}]}));
 rejects(answer({entities:[entity({evidence:[7]})]}));
 rejects(answer({evidence:[{source:'s9',excerpt:'made up source'}]}));
 rejects(answer({entities:[entity(),entity()]}));
 rejects(answer({entities:[entity({confidence:1.5})]}));
 rejects(answer({entities:[entity({label:'x'.repeat(301)})]}));
 rejects(answer({entities:[entity({label:'Two\nlines'})]}));
 rejects(answer({entities:Array.from({length:EXTRACTION_LIMITS.entities+1},(_,i)=>entity({ref:`e${i}`,label:`Offer ${i}`}))}));
 rejects(answer({evidence:[{source:'s1',excerpt:'x'.repeat(EXTRACTION_LIMITS.excerpt+1)}]}));
 rejects('{"entities":[],"relations":[],"evidence":[],"padding":"'+'x'.repeat(EXTRACTION_LIMITS.payloadBytes)+'"}');
 rejects('not json');rejects(null);rejects([]);
 assert.deepEqual(validateExtraction({entities:[],relations:[],evidence:[]},context),{nodes:[],edges:[]});
});

test('a quote that is not in the source turns an "extracted" claim into a weak guess',()=>{
 const out=validateExtraction(answer({evidence:[{source:'s1',excerpt:'Voted best groomer in Europe'}]}),context);
 assert.deepEqual([out.nodes[0].origin,out.nodes[0].confidence],['inferred',EXTRACTION_LIMITS.unverifiedConfidence]);
 const none=validateExtraction(answer({entities:[entity({evidence:[]})],relations:[]}),context);
 assert.deepEqual([none.nodes[0].origin,none.nodes[0].confidence],['inferred',0.5]);
 // Spacing and case differences do not defeat the check.
 const spaced=validateExtraction(answer({evidence:[{source:'s1',excerpt:'doorstep  full groom FROM 55 eur'}]}),context);
 assert.equal(spaced.nodes[0].origin,'extracted');
});

test('entities that normalise to one key merge, and the business is a single node',()=>{
 const out=validateExtraction(answer({entities:[entity(),entity({ref:'e2',label:'doorstep full-groom',origin:'INFERRED',confidence:0.4,evidence:[]}),entity({ref:'e3',type:'business',label:'Harbour & Pine',evidence:[]}),entity({ref:'e4',type:'business',label:'Harbour and Pine SIA',evidence:[]})],
  relations:[{from:'e1',to:'e2',relation:'related_to',origin:'INFERRED',confidence:0.5,evidence:[]},{from:'e3',to:'e1',relation:'offers',origin:'INFERRED',confidence:0.5,evidence:[]},{from:'e4',to:'e2',relation:'offers',origin:'EXTRACTED',confidence:0.9,evidence:[0]}]}),context);
 assert.deepEqual(out.nodes.map(n=>`${n.type}:${n.key}`),['offer:doorstep-full-groom','business:self']);assert.equal(out.nodes[0].label,'Doorstep Full Groom');
 assert.deepEqual(out.edges.map(e=>[e.from.key,e.relation,e.to.key,e.origin]),[['self','offers','doorstep-full-groom','extracted']]);
});

const snapshot={schema_version:1,missing_fields:[],facts:[
 {id:'f1',field:'brand_name',value:'Harbour & Pine',original_value:'Harbour & Pine Dog Grooming',extraction_type:'literal_label',status:'edited',source_id:source},
 {id:'f2',field:'offering',value:'Mobile dog grooming at the customer’s door.',original_value:'Mobile dog grooming at the customer’s door.',extraction_type:'literal_label',status:'correct',source_id:source},
 {id:'f3',field:'audience',value:'Busy apartment owners with small breeds',original_value:'x',extraction_type:'manual',status:'correct'},
 {id:'f4',field:'prohibited_claims',value:'Never promise veterinary outcomes',original_value:'x',extraction_type:'manual',status:'correct'},
 {id:'f5',field:'voice',value:'Warm, plain, a little playful',original_value:'x',extraction_type:'manual',status:'correct'},
 {id:'f6',field:'visual_direction_palette',value:'Sea green and warm sand',status:'approved',evidence_type:'approved_visual_direction',analysis_job_id:job,suggestion_index:0,evidence_sha256:'ab'.repeat(32),observation:'Hero uses sea green'},
 {id:'f7',field:'visual_direction_palette',value:'High-contrast charcoal for text',status:'edited',analysis_job_id:job,evidence_sha256:'cd'.repeat(32),observation:'Dark headings'},
 {id:'f8',field:'offering',value:'Mobile dog grooming at the customer’s door.',original_value:'again',extraction_type:'literal_label',status:'correct',source_id:source},
 {id:'f9',field:'unknown_field',value:'ignored'},{id:'f10',field:'cta',value:'  '},{id:'f11',field:'fonts',value:'Skipped',status:'wrong'},null,'junk'
]};

test('an approved brand profile maps to approved nodes and edges without any model call',()=>{
 const out=fromBrandBrainSnapshot(snapshot),ids=out.nodes.map(n=>`${n.type}:${n.key}`);
 assert.deepEqual(ids,['audience:audience','business:self','offer:offering','rule:prohibited-claims','visual_direction:palette-ababababab','visual_direction:palette-cdcdcdcdcd','voice:voice']);
 assert.equal(out.nodes.every(n=>n.status==='approved'&&n.confidence===1),true);
 const by=Object.fromEntries(out.nodes.map(n=>[`${n.type}:${n.key}`,n]));
 assert.deepEqual([by['business:self'].label,by['business:self'].origin],['Harbour & Pine','owner']);
 assert.equal(by['offer:offering'].origin,'extracted');assert.equal(by['audience:audience'].origin,'owner');
 assert.deepEqual(by['offer:offering'].evidence,[{sourceId:source,excerpt:'Mobile dog grooming at the customer’s door.'},{sourceId:source,excerpt:'again'}]);
 assert.deepEqual(by['visual_direction:palette-ababababab'].properties,{field:'visual_direction_palette',text:'Sea green and warm sand',category:'palette',observation:'Hero uses sea green'});
 assert.deepEqual(by['visual_direction:palette-ababababab'].evidence,[{jobId:job,excerpt:'Hero uses sea green'}]);
 const edges=out.edges.map(e=>`${e.from.type}:${e.from.key} ${e.relation} ${e.to.type}:${e.to.key}`).sort();
 assert.deepEqual(edges,['business:self expresses visual_direction:palette-ababababab','business:self expresses visual_direction:palette-cdcdcdcdcd','business:self expresses voice:voice','business:self offers offer:offering','business:self targets audience:audience','offer:offering targets audience:audience','rule:prohibited-claims constrains business:self']);
 assert.equal(out.edges.every(e=>e.status==='approved'),true);
 out.nodes.forEach(n=>assertNodeMutation(n,{actor}));out.edges.forEach(e=>assertEdgeMutation(e,{actor}));
 // Same snapshot, same result: safe to re-run after every approval.
 assert.deepEqual(fromBrandBrainSnapshot(JSON.parse(JSON.stringify(snapshot))),out);
});

test('snapshot importer handles long values, conflicting values and bad input',()=>{
 const long=fromBrandBrainSnapshot({facts:[{field:'offering',value:'word '.repeat(700),status:'correct'}]}).nodes[0];
 assert.equal(long.label.length,300);assert.equal(long.properties.text.length<=4000,true);assertNodeMutation(long,{actor});
 const both=fromBrandBrainSnapshot({facts:[{field:'voice',value:'Warm',status:'correct'},{field:'voice',value:'Formal',status:'correct'}]});
 assert.equal(both.nodes.length,2);assert.equal(new Set(both.nodes.map(n=>n.key)).size,2);
 assert.deepEqual(fromBrandBrainSnapshot({facts:[]}),{nodes:[],edges:[]});
 for(const bad of [null,'x',[],{},{facts:'no'}])assert.throws(()=>fromBrandBrainSnapshot(bad),/KNOWLEDGE_SNAPSHOT_INVALID/);
});
