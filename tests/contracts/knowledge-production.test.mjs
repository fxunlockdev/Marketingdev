import test from 'node:test';
import assert from 'node:assert/strict';
import {productionMutations,insightMutations,storedFromPack,PRODUCTION_TYPES} from '../../dist/knowledge-production.js';
import {knowledgeListQuery,KNOWLEDGE_PAGE} from '../../dist/knowledge-review.js';

const job='11111111-1111-4111-8111-111111111111';
test('a post records used_in edges only from production knowledge, once each, as suggestions citing the job',()=>{
 const used=[{type:'angle',key:'door'},{type:'rule',key:'no-vet'},{type:'format',key:'reel'},{type:'angle',key:'door'},{type:'voice',key:'voice'}];
 const m=productionMutations({key:`creative ${job}`,label:'  A   reel\nabout doors ',jobId:job},used);
 assert.equal(m.nodes.length,1);assert.equal(m.nodes[0].type,'post');assert.equal(m.nodes[0].label,'A reel about doors');
 assert.equal(m.nodes[0].status,'suggested');assert.deepEqual(m.nodes[0].evidence,[{jobId:job,excerpt:''}]);
 assert.deepEqual(m.edges.map(e=>[e.from.type,e.relation,e.to.type,e.status]),[['angle','used_in','post','suggested'],['format','used_in','post','suggested']]);
 assert.ok(!PRODUCTION_TYPES.includes('rule'));
 assert.equal(productionMutations({key:'x',label:'y'.repeat(500),jobId:job},[]).nodes[0].label.length,300);
});
test('insights become one result and bounded suggested lessons learned from it',()=>{
 const m=insightMutations({jobId:job,label:'Review'},[{title:'Reels beat stills',detail:'d'.repeat(900)},{title:'  '},...Array(30).fill({title:'More'})]);
 assert.equal(m.nodes[0].type,'result');assert.ok(m.nodes.slice(1).every(n=>n.type==='lesson'&&n.status==='suggested'&&n.origin==='inferred'));
 assert.ok(m.nodes.length<=20);assert.ok(m.nodes[1].properties.summary.length<=400);
 assert.ok(m.edges.every(e=>e.relation==='learned_from'&&e.to.type==='result'));
});
test('the stored pack separates prompt data from provenance',()=>{
 const stored=storedFromPack({task:'creative',budget_bytes:6000,bytes:120,truncated:false,notice:'n',items:[],ledger:[],used_node_ids:['a'],used_edge_ids:['b']});
 assert.deepEqual(stored,{status:'ready',prompt:{task:'creative',notice:'n',items:[],ledger:[],truncated:false},used_node_ids:['a'],used_edge_ids:['b'],bytes:120});
});
test('knowledge list query is validated and bounded',()=>{
 assert.deepEqual(knowledgeListQuery({}),{status:null,type:null,cursor:null,limit:KNOWLEDGE_PAGE.defaultLimit});
 assert.deepEqual(knowledgeListQuery({status:'suggested',type:'angle',limit:'5',cursor:job}),{status:'suggested',type:'angle',cursor:job,limit:5});
 for(const bad of [{status:'maybe'},{type:'secret'},{limit:'0'},{limit:'101'},{limit:'1.5'},{cursor:'nope'}])assert.throws(()=>knowledgeListQuery(bad));
});
test('an empty pack adds nothing to a prompt',async()=>{
 const {promptKnowledge}=await import('../../dist/knowledge-production.js');
 const empty={status:'ready',prompt:{task:'creative',notice:'n',items:[],ledger:[],truncated:false},used_node_ids:[],used_edge_ids:[],bytes:10};
 assert.equal(promptKnowledge(empty),undefined);
 assert.equal(promptKnowledge({status:'unavailable',reason:'X'}),undefined);
 const full={...empty,prompt:{...empty.prompt,items:[{id:'a'}]}};
 assert.equal(promptKnowledge(full),full.prompt);
});
