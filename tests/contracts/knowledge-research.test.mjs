import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeMarketEvidence,extractionSources,extractionReservation,RESEARCH_EXTRACTION_LIMITS,MARKET_NOTE} from '../../dist/knowledge-research.js';
import {extractionRequest} from '../../dist/knowledge-extract.js';
import {reservationRates} from '../../dist/model-policy.js';

const own='11111111-1111-4111-8111-111111111111',market='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333';
const node=(type,key,evidence,over={})=>({type,key,label:key,properties:{summary:`${key} summary`},status:'suggested',origin:'extracted',confidence:0.9,evidence,...over});
const edge=(from,relation,to,evidence,over={})=>({from,to,relation,properties:{},status:'suggested',origin:'extracted',confidence:0.9,evidence,...over});
const ownRef={sourceId:own,jobId:job,excerpt:'From our own site'},marketRef={sourceId:market,jobId:job,excerpt:'From a rival site'};
const ref=(type,key)=>({type,key});

test('market-only claims about offers or proof are dropped; market audiences, pains and competitors are tagged',()=>{
 const scoped=scopeMarketEvidence({nodes:[
   node('business','self',[ownRef]),
   node('offer','own-groom',[ownRef,marketRef]),
   node('offer','rival-spa-day',[marketRef]),
   node('proof_point','rival-award',[marketRef]),
   node('competitor','paws-co',[marketRef]),
   node('pain','no-car',[marketRef],{confidence:0.95}),
   node('angle','guess',[],{origin:'inferred',confidence:0.4}),
  ],edges:[
   edge(ref('business','self'),'offers',ref('offer','own-groom'),[ownRef]),
   edge(ref('business','self'),'offers',ref('offer','rival-spa-day'),[marketRef]),
   edge(ref('business','self'),'differentiates_from',ref('competitor','paws-co'),[marketRef]),
   edge(ref('offer','own-groom'),'solves',ref('pain','no-car'),[marketRef]),
  ]},new Set([market]));
 assert.deepEqual(scoped.nodes.map(n=>`${n.type}:${n.key}`),['business:self','offer:own-groom','competitor:paws-co','pain:no-car','angle:guess']);
 // A business fact keeps only the business's own evidence; rival pages never prove it.
 assert.deepEqual(scoped.nodes[1].evidence,[ownRef]);assert.equal(scoped.nodes[1].properties.scope,undefined);
 const competitor=scoped.nodes[2],pain=scoped.nodes[3];
 for(const tagged of [competitor,pain]){assert.equal(tagged.properties.scope,'market');assert.ok(tagged.properties.summary.startsWith(MARKET_NOTE));assert.equal(tagged.status,'suggested');}
 // Market insight is a hypothesis about the market, not a stated fact about this business.
 assert.deepEqual([pain.origin,pain.confidence],['inferred',0.7]);
 assert.deepEqual(scoped.edges.map(e=>`${e.from.key}>${e.relation}>${e.to.key}`),['self>offers>own-groom','self>differentiates_from>paws-co']);
 assert.equal(scoped.edges[1].properties.scope,'market');
 // Nothing is approved, nothing is the owner's.
 assert.ok([...scoped.nodes,...scoped.edges].every(m=>m.status==='suggested'&&m.origin!=='owner'));
});

test('without market sources the extraction passes through unchanged',()=>{
 const mutations={nodes:[node('offer','groom',[ownRef])],edges:[]};
 assert.deepEqual(scopeMarketEvidence(mutations,new Set()),mutations);
});

test('sources put the business first, bound market text, and give the model short ids only',()=>{
 const rows=[
  ...Array.from({length:3},(_,i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,url:`https://rival${i}.example/`,market:true,text:'m'.repeat(RESEARCH_EXTRACTION_LIMITS.sourceChars+50)})),
  {id:own,url:'https://own.example/',market:false,text:'Own words'},
  {id:'44444444-4444-4444-8444-444444444444',url:null,market:false,text:'   '},
 ];
 const built=extractionSources(rows);
 assert.equal(built.sources[0].id,'s1');assert.equal(built.sources[0].sourceId,own);assert.equal(built.sources[0].text,'Own words');
 assert.ok(built.sources.slice(1).every(s=>s.id.startsWith('m')&&s.text.length<=RESEARCH_EXTRACTION_LIMITS.sourceChars));
 assert.ok(built.sources.filter(s=>s.id.startsWith('m')).reduce((n,s)=>n+s.text.length,0)<=RESEARCH_EXTRACTION_LIMITS.marketChars);
 assert.equal(built.sources.some(s=>s.sourceId==='44444444-4444-4444-8444-444444444444'),false,'empty sources are not sent');
 assert.deepEqual([...built.market].sort(),built.sources.filter(s=>s.id.startsWith('m')).map(s=>s.sourceId).sort());
 assert.deepEqual(built.sourceIds,built.sources.map(s=>s.sourceId));
 assert.ok(built.sources.length<=RESEARCH_EXTRACTION_LIMITS.sources);
 assert.deepEqual(extractionSources([]).sources,[]);
});

test('a reservation covers the whole prompt and the full output at the check model rates',()=>{
 const request=extractionRequest({businessName:'Harbour & Pine',sources:[{id:'s1',sourceId:own,text:'Doorstep grooming in Riga.'}],jobId:job});
 const r=extractionReservation(request),rates=reservationRates('check');
 assert.ok(r.maxInputTokens>Buffer.byteLength(request.instructions)+Buffer.byteLength(request.input));
 assert.equal(r.maxOutputTokens,request.max_output_tokens);
 assert.equal(r.micros,Math.ceil(r.maxInputTokens*rates.input_micros_per_token+r.maxOutputTokens*rates.output_micros_per_token));
 assert.ok(Number.isSafeInteger(r.micros)&&r.micros>0);
});
