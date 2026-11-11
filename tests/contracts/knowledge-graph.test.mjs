import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKey,mergeNode,mergeEdge,boundedProperties,assertNodeMutation,assertEdgeMutation,assertEvidence,stableJSON,KNOWLEDGE_LIMITS,NODE_TYPES,RELATIONS} from '../../dist/knowledge-graph.js';

const actor='11111111-1111-4111-8111-111111111111';
const node=(over={})=>({type:'offer',key:'doorstep-groom',label:'Doorstep groom',properties:{summary:'Van at the door'},status:'suggested',origin:'extracted',confidence:0.7,evidence:[],...over});
const stored=(over={})=>({label:'Doorstep groom',properties:{summary:'Van at the door'},status:'suggested',origin:'extracted',confidence:0.7,version:1,...over});
const edge=(over={})=>({from:{type:'offer',key:'a'},to:{type:'pain',key:'b'},relation:'solves',properties:{},status:'suggested',origin:'extracted',confidence:0.6,evidence:[],...over});

test('keys ignore case, accents, punctuation and spacing, and stay bounded',()=>{
 assert.equal(normalizeKey('  Doorstep   Full-Groom! '),'doorstep-full-groom');
 assert.equal(normalizeKey('Café Rīga'),normalizeKey('cafe riga'));
 assert.equal(normalizeKey('Suņu frizētava'),'sunu-frizetava');
 assert.equal(normalizeKey('Собачий салон'),'собачий-салон');
 assert.throws(()=>normalizeKey(' !!! '),/KNOWLEDGE_KEY_EMPTY/);
 const long=normalizeKey('word '.repeat(60)),other=normalizeKey('word '.repeat(60)+'different ending');
 assert.equal(long.length<=KNOWLEDGE_LIMITS.key,true);assert.notEqual(long,other);
 assert.equal(normalizeKey('word '.repeat(60)),long);
 assert.equal(/\s/.test(long)||long!==long.toLowerCase(),false);
});

test('a new finding is inserted and an identical one only refreshes last seen',()=>{
 assert.deepEqual(mergeNode(null,node()),{action:'insert'});
 assert.deepEqual(mergeNode(stored(),node()),{action:'touch'});
});

test('a changed suggestion bumps the version and merges properties; confidence alone does not',()=>{
 const changed=mergeNode(stored(),node({label:'Doorstep full groom',properties:{price:'55 EUR'},confidence:0.5}));
 assert.deepEqual(changed,{action:'update',label:'Doorstep full groom',properties:{summary:'Van at the door',price:'55 EUR'},status:'suggested',origin:'extracted',confidence:0.7,version:2});
 const surer=mergeNode(stored(),node({confidence:0.9}));
 assert.equal(surer.action,'update');assert.equal(surer.version,1);assert.equal(surer.confidence,0.9);
});

test('a guess never rewrites a quote, and a quote upgrades a guess',()=>{
 assert.deepEqual(mergeNode(stored(),node({origin:'inferred',label:'Something else',confidence:0.99})),{action:'touch'});
 const upgraded=mergeNode(stored({origin:'inferred',confidence:0.9}),node({confidence:0.6}));
 assert.equal(upgraded.action,'update');assert.equal(upgraded.origin,'extracted');assert.equal(upgraded.confidence,0.6);assert.equal(upgraded.version,2);
});

test('reviewed knowledge is never overwritten by a suggestion; a differing one is flagged',()=>{
 for(const status of ['approved','rejected']){
  assert.deepEqual(mergeNode(stored({status}),node()),{action:'keep',conflict:false});
  assert.deepEqual(mergeNode(stored({status}),node({label:'Cheaper groom'})),{action:'keep',conflict:true});
 }
});

test('a reviewer statement replaces stored content, including an earlier rejection',()=>{
 const revived=mergeNode(stored({status:'rejected'}),node({status:'approved',origin:'owner',confidence:1,properties:{summary:'Owner wording'}}));
 assert.deepEqual(revived,{action:'update',label:'Doorstep groom',properties:{summary:'Owner wording'},status:'approved',origin:'owner',confidence:1,version:2});
 assert.deepEqual(mergeNode(stored({status:'approved',origin:'owner',confidence:1}),node({status:'approved',origin:'owner',confidence:1})),{action:'touch'});
});

test('merging does not mutate its inputs',()=>{
 const before=stored(),incoming=node({properties:{price:'55 EUR'}}),a=stableJSON(before),b=stableJSON(incoming);
 mergeNode(before,incoming);assert.equal(stableJSON(before),a);assert.equal(stableJSON(incoming),b);
});

test('edges follow the same review rules',()=>{
 assert.deepEqual(mergeEdge(null,edge()),{action:'insert'});
 assert.deepEqual(mergeEdge({properties:{},status:'approved',origin:'owner',confidence:1},edge()),{action:'keep'});
 assert.deepEqual(mergeEdge({properties:{},status:'suggested',origin:'extracted',confidence:0.6},edge({origin:'inferred'})),{action:'touch'});
 assert.deepEqual(mergeEdge({properties:{},status:'suggested',origin:'inferred',confidence:0.4},edge()),{action:'update',properties:{},status:'suggested',origin:'extracted',confidence:0.6});
});

test('mutations are validated before any write',()=>{
 assert.doesNotThrow(()=>assertNodeMutation(node()));
 assert.throws(()=>assertNodeMutation(node({type:'secret'})),/KNOWLEDGE_TYPE_UNKNOWN/);
 assert.throws(()=>assertNodeMutation(node({key:'Has Space'})),/KNOWLEDGE_KEY_INVALID/);
 assert.throws(()=>assertNodeMutation(node({label:'x'.repeat(301)})),/KNOWLEDGE_LABEL_INVALID/);
 assert.throws(()=>assertNodeMutation(node({confidence:1.2})),/KNOWLEDGE_CONFIDENCE_INVALID/);
 assert.throws(()=>assertNodeMutation(node({properties:{blob:'x'.repeat(9000)}})),/KNOWLEDGE_PROPERTIES_TOO_LARGE/);
 assert.throws(()=>assertNodeMutation(node({properties:[]})),/KNOWLEDGE_PROPERTIES_INVALID/);
 assert.throws(()=>assertNodeMutation(node({status:'rejected'})),/KNOWLEDGE_STATUS_INVALID/);
 assert.throws(()=>assertNodeMutation(node({status:'approved'})),/KNOWLEDGE_REVIEWER_REQUIRED/);
 assert.doesNotThrow(()=>assertNodeMutation(node({status:'approved'}),{actor}));
 assert.throws(()=>assertEdgeMutation(edge({relation:'owns'})),/KNOWLEDGE_RELATION_UNKNOWN/);
 assert.throws(()=>assertEdgeMutation(edge({to:{type:'offer',key:'a'}})),/KNOWLEDGE_EDGE_SELF/);
});

test('evidence must name a source and stay bounded',()=>{
 assert.doesNotThrow(()=>assertEvidence({sourceUrl:'https://example.com/about',excerpt:'We groom dogs'}));
 assert.doesNotThrow(()=>assertEvidence({jobId:actor,excerpt:''}));
 assert.throws(()=>assertEvidence({excerpt:'floating claim'}),/KNOWLEDGE_EVIDENCE_UNSOURCED/);
 assert.throws(()=>assertEvidence({sourceUrl:'javascript:alert(1)',excerpt:''}),/KNOWLEDGE_EVIDENCE_INVALID/);
 assert.throws(()=>assertEvidence({sourceId:'not-a-uuid',excerpt:''}),/KNOWLEDGE_EVIDENCE_INVALID/);
 assert.throws(()=>assertEvidence({jobId:actor,excerpt:'x'.repeat(1001)}),/KNOWLEDGE_EVIDENCE_INVALID/);
});

test('properties are canonical and the vocabularies match the database lists',()=>{
 assert.deepEqual(boundedProperties({b:1,a:{d:1,c:2}},100),{a:{c:2,d:1},b:1});
 assert.equal(stableJSON({b:1,a:2}),'{"a":2,"b":1}');
 assert.equal(NODE_TYPES.length,19);assert.equal(RELATIONS.length,15);
});
