import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblePack,rankNodes,relevance,tokens,CONTEXT_LIMITS,PACK_NOTICE,TASK_WEIGHTS,CONTEXT_TASKS} from '../../dist/knowledge-context.js';

let n=0;
const node=(type,label,over={})=>({id:`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,type,key:label.toLowerCase().replace(/\W+/g,'-'),label,summary:'',status:'approved',confidence:1,...over});
const edge=(from,relation,to,over={})=>({id:`e-${from.label}-${relation}-${to.label}`,from_node:from.id,to_node:to.id,relation,status:'approved',...over});
const rule=node('rule','Never promise veterinary outcomes'),offer=node('offer','Doorstep Full Groom',{summary:'Wash, cut and nails in a van outside the home'}),puppy=node('offer','Puppy First Groom',{summary:'Gentle introduction for puppies'}),
 persona=node('persona','Anxious first-time owner'),pain=node('pain','Fear of the first groom'),angle=node('angle','A first groom built for puppies',{status:'suggested',confidence:0.8}),
 weak=node('angle','Dogs love vans',{status:'suggested',confidence:0.3}),rejected=node('competitor','Not a competitor',{status:'rejected'}),palette=node('visual_direction','Sea green and warm sand'),
 post=node('post','Post 12'),result=node('result','4200 reach on post 12'),lesson=node('lesson','Carousels about puppies get saved');
const all=[weak,palette,angle,pain,persona,puppy,offer,rule,rejected,post,result,lesson];
const edges=[edge(puppy,'solves',pain),edge(persona,'has_pain',pain),edge(angle,'solves',pain,{status:'suggested'}),edge(offer,'differentiates_from',rejected),edge(puppy,'targets',persona,{status:'rejected'})];
const ledger=[{node_id:angle.id,type:'angle',label:angle.label,uses:2,last_used:'2026-11-01T00:00:00.000Z'}];
const labels=pack=>pack.items.map(i=>i.label);

test('tokens drop filler, case, accents and plurals',()=>{
 assert.deepEqual(tokens('The Puppies and their FIRST grooms in Rīga'),['puppy','first','groom','riga']);
 assert.deepEqual(tokens(''),[]);
 assert.equal(relevance(new Set(tokens('puppy first groom')),{label:'Puppy First Groom',summary:'Gentle first visit for a puppy'}),6);
 assert.equal(relevance(new Set(tokens('puppy')),{label:'Doorstep groom',summary:'Great for a puppy'}),1);
 assert.equal(relevance(new Set(tokens('puppies')),{label:'Puppy plan',summary:''}),2);
});

test('approved rules lead, approved knowledge precedes suggestions, weak and rejected items never appear',()=>{
 const ranked=rankNodes(all,{kind:'plan',input:'first groom for a new puppy'}).map(c=>c.label);
 assert.equal(ranked[0],rule.label);
 assert.equal(ranked.at(-1),angle.label);
 assert.equal(ranked.includes(weak.label)||ranked.includes(rejected.label),false);
 // Among approved offers the one matching the task comes first.
 assert.equal(ranked.indexOf(puppy.label)<ranked.indexOf(offer.label),true);
 // Posts and results are for the insights task only.
 assert.equal(ranked.includes(post.label)||ranked.includes(result.label),false);
 assert.equal(rankNodes(all,{kind:'insights',input:''}).some(c=>c.type==='result'),true);
 assert.equal(rankNodes(all,{kind:'insights',input:''}).some(c=>c.type==='visual_direction'),false);
 assert.equal(rankNodes(all,{kind:'creative',input:''}).some(c=>c.type==='visual_direction'),true);
});

test('pack labels suggestions unproven, carries relations, the ledger and provenance',()=>{
 const pack=assemblePack({kind:'plan',input:'first groom for a new puppy'},all,edges,ledger);
 assert.equal(pack.task,'plan');assert.equal(pack.notice,PACK_NOTICE);assert.equal(pack.truncated,false);
 const by=Object.fromEntries(pack.items.map(i=>[i.label,i]));
 assert.equal(by[angle.label].standing,'unproven');assert.equal(by[puppy.label].standing,'approved');
 assert.deepEqual(by[puppy.label].relations,[{relation:'solves',to:pain.label,to_type:'pain',standing:'approved'}]);
 // An approved edge from an unproven node, or an unreviewed edge, is still unproven. Rejected edges and nodes vanish.
 assert.deepEqual(by[angle.label].relations,[{relation:'solves',to:pain.label,to_type:'pain',standing:'unproven'}]);
 assert.deepEqual(by[offer.label].relations,[]);
 assert.deepEqual(pack.ledger,ledger);
 assert.deepEqual(pack.used_node_ids,pack.items.map(i=>i.id));
 assert.deepEqual([...pack.used_edge_ids].sort(),[edges[0].id,edges[1].id,edges[2].id].sort());
 assert.equal(pack.bytes,Buffer.byteLength(JSON.stringify({notice:pack.notice,items:pack.items,ledger:pack.ledger})));
 assert.equal(pack.bytes<=pack.budget_bytes,true);
});

test('the same graph and task give the same pack whatever order rows arrive in',()=>{
 const task={kind:'creative',input:'puppy carousel'};
 const a=assemblePack(task,all,edges,ledger),b=assemblePack(task,[...all].reverse(),[...edges].reverse(),ledger);
 assert.deepEqual(a,b);
 const frozen=JSON.stringify(all);assemblePack(task,all,edges,ledger);assert.equal(JSON.stringify(all),frozen);
});

test('the byte budget is never exceeded and what is cut is the lowest ranked',()=>{
 const many=[rule,...Array.from({length:200},(_,i)=>node('offer',`Offer number ${i}`,{summary:'Detail '.repeat(40),confidence:1-i/1000}))];
 const links=many.slice(1,60).map((o,i)=>edge(o,'related_to',many[i+2]));
 for(const budgetBytes of [CONTEXT_LIMITS.minBudgetBytes,1500,6000,32000]){
  const pack=assemblePack({kind:'plan',input:'',budgetBytes},many,links,Array.from({length:20},(_,i)=>({node_id:many[i+1].id,type:'offer',label:many[i+1].label,uses:1,last_used:'2026-11-01T00:00:00.000Z'})));
  assert.equal(pack.bytes<=budgetBytes,true,`budget ${budgetBytes} gave ${pack.bytes}`);assert.equal(pack.truncated,true);
  assert.equal(pack.ledger.length<=CONTEXT_LIMITS.ledgerEntries,true);
  if(pack.items.length){assert.equal(pack.items[0].label,rule.label);assert.deepEqual(labels(pack).slice(1),many.slice(1,pack.items.length).map(o=>o.label));}
 }
 const small=assemblePack({kind:'plan',input:'',budgetBytes:1500},many,links,[]),large=assemblePack({kind:'plan',input:'',budgetBytes:6000},many,links,[]);
 assert.equal(small.items.length>0&&small.items.length<large.items.length,true);
 assert.equal(large.items.every(i=>i.summary.length<=CONTEXT_LIMITS.summaryChars),true);
});

test('invalid tasks are refused and every task has weights',()=>{
 for(const task of [{kind:'email',input:''},{kind:'plan',input:5},{kind:'plan',input:'',budgetBytes:10},{kind:'plan',input:'',budgetBytes:1e9},{kind:'plan',input:'',budgetBytes:1000.5}])
  assert.throws(()=>assemblePack(task,all,edges,ledger),/KNOWLEDGE_CONTEXT_INVALID/);
 for(const kind of CONTEXT_TASKS)assert.equal(Object.keys(TASK_WEIGHTS[kind]).length>0,true);
 assert.deepEqual(assemblePack({kind:'video',input:'anything'},[],[],[]).items,[]);
});
