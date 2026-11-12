import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TenantDatabase} from '../../dist/database.js';
import {AssetJobs} from '../../dist/jobs.js';
import {applyMutations,upsertNodes,upsertEdges,attachEvidence,reviewNode,reviewEdge,supersedeNode,neighbourhood} from '../../dist/knowledge-graph.js';
import {fromBrandBrainSnapshot} from '../../dist/knowledge-extract.js';
import {buildContextPack} from '../../dist/knowledge-context.js';

const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
const admin=new Pool({connectionString:process.env.DESVIO_TEST_ADMIN_URL}),worker=new Pool({connectionString:config.jobs.workerDatabaseUrl}),app=new Pool({connectionString:config.appDatabaseUrl});
after(async()=>{await Promise.all([admin.end(),worker.end(),app.end()]);});
const tenants=new TenantDatabase(app),jobs=new AssetJobs(worker,{},{});

async function member(org,role){
 const user=randomUUID();
 await admin.query(`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Knowledge user',$2,true,now(),now())`,[user,`${user}@example.test`]);
 if(org)await admin.query('INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[org,user,role]);
 return user;
}
async function fixture(){
 const owner=await member(null),org=randomUUID(),brand=randomUUID();
 await admin.query(`INSERT INTO app.organizations(id,name,created_by) VALUES($1,'Knowledge fixture',$2)`,[org,owner]);
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[org,owner]);
 await admin.query(`INSERT INTO app.brands(id,organization_id,name) VALUES($1,$2,'Knowledge fixture')`,[brand,org]);
 const scope={organizationId:org,brandId:brand};
 const job=async(kind='brand.analyze')=>{const id=randomUUID();await admin.query('INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,$5)',[id,org,brand,owner,kind]);return {...scope,jobId:id};};
 const as=(user,write,action)=>tenants.transaction(user,org,write,action,brand);
 return {org,brand,owner,scope,job,as};
}
const suggestion=(type,key,label,over={})=>({type,key,label,properties:{},status:'suggested',origin:'extracted',confidence:0.8,evidence:[],...over});
const link=(from,relation,to,over={})=>({from,to,relation,properties:{},status:'suggested',origin:'extracted',confidence:0.8,evidence:[],...over});
const ref=(type,key)=>({type,key});

test('knowledge tables force row-level security and deny other tenants',async()=>{
 const a=await fixture(),b=await fixture();
 const tables=await admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND relname LIKE 'knowledge_%' AND relkind='r' ORDER BY relname`);
 assert.deepEqual(tables.rows.map(t=>t.relname),['knowledge_edges','knowledge_evidence','knowledge_nodes']);
 assert.ok(tables.rows.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
 const written=await a.as(a.owner,true,db=>applyMutations(db,a.scope,{nodes:[suggestion('offer','groom','Doorstep groom',{evidence:[{sourceUrl:'https://example.com/',excerpt:'We come to you'}]}),suggestion('pain','no-car','No car')],edges:[link(ref('offer','groom'),'solves',ref('pain','no-car'))]}));
 assert.deepEqual(written.nodes.map(n=>n.outcome),['inserted','inserted']);assert.equal(written.evidence,1);
 // No tenant context: nothing is visible. Another tenant: nothing is visible and nothing can be written into A.
 for(const table of ['knowledge_nodes','knowledge_edges','knowledge_evidence'])assert.equal((await app.query(`SELECT * FROM app.${table}`)).rowCount,0);
 await b.as(b.owner,true,async db=>{
  for(const table of ['knowledge_nodes','knowledge_edges','knowledge_evidence'])assert.equal((await db.query(`SELECT * FROM app.${table}`)).rowCount,0);
  assert.equal((await db.query("UPDATE app.knowledge_nodes SET label='taken' WHERE id=$1",[written.nodes[0].id])).rowCount,0);
  assert.deepEqual(await neighbourhood(db,a.scope,{seeds:[written.nodes[0].id],depth:2,includeSuggested:true}),{nodes:[],edges:[]});
  assert.deepEqual((await buildContextPack(db,a.scope,{kind:'plan',input:'groom'})).used_node_ids,[]);
 });
 await assert.rejects(b.as(b.owner,true,db=>upsertNodes(db,a.scope,[suggestion('offer','planted','Planted')])),{code:'42501'});
 await assert.rejects(b.as(b.owner,true,db=>attachEvidence(db,a.scope,{nodeId:written.nodes[0].id},[{sourceUrl:'https://example.com/x',excerpt:''}])),{code:'42501'});
 // The composite keys stop an edge or evidence row joining two businesses even for a privileged writer.
 const foreign=await b.as(b.owner,true,db=>upsertNodes(db,b.scope,[suggestion('pain','other','Other')]));
 await assert.rejects(admin.query("INSERT INTO app.knowledge_edges(id,organization_id,brand_id,from_node,to_node,relation,origin,confidence) VALUES($1,$2,$3,$4,$5,'solves','extracted',0.5)",[randomUUID(),a.org,a.brand,written.nodes[0].id,foreign[0].id]),{code:'23503'});
 // A viewer reads but cannot write; a stranger is refused outright.
 const viewer=await member(a.org,'viewer'),stranger=await member(null);
 assert.equal((await a.as(viewer,false,db=>db.query('SELECT * FROM app.knowledge_nodes'))).rowCount,2);
 await assert.rejects(admin.connect().then(async db=>{try{await db.query('BEGIN');await db.query('SET LOCAL ROLE desvio_app');await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true),set_config('app.brand_id',$3,true)",[viewer,a.org,a.brand]);await db.query("INSERT INTO app.knowledge_nodes(id,organization_id,brand_id,type,key,label,origin,confidence) VALUES($1,$2,$3,'offer','viewer','Viewer','extracted',0.5)",[randomUUID(),a.org,a.brand]);}finally{await db.query('ROLLBACK');db.release();}}),{code:'42501'});
 await assert.rejects(a.as(stranger,false,db=>db.query('SELECT 1')),/Account not found/);
});

test('repeated findings merge by type and key, evidence is stored once, review decisions stick',async()=>{
 const a=await fixture(),editor=await member(a.org,'editor');
 const first=await a.as(editor,true,db=>applyMutations(db,a.scope,{nodes:[suggestion('offer','groom','Doorstep groom',{properties:{summary:'Van at the door'},evidence:[{sourceUrl:'https://example.com/',excerpt:'We come to you'}]})],edges:[]}));
 const again=await a.as(editor,true,db=>applyMutations(db,a.scope,{nodes:[
  suggestion('offer','groom','Doorstep full groom',{properties:{price:'55 EUR'},evidence:[{sourceUrl:'https://example.com/',excerpt:'We come to you'},{sourceUrl:'https://example.com/prices',excerpt:'From 55 EUR'}]}),
  suggestion('offer','groom','Doorstep full groom',{properties:{price:'55 EUR'}})],edges:[]}));
 assert.equal(again.nodes[0].id,first.nodes[0].id);assert.deepEqual(again.nodes.map(n=>[n.outcome,n.version]),[['updated',2],['touched',2]]);assert.equal(again.evidence,1);
 const row=(await admin.query('SELECT label,properties,version,status FROM app.knowledge_nodes WHERE id=$1',[first.nodes[0].id])).rows[0];
 assert.deepEqual(row,{label:'Doorstep full groom',properties:{summary:'Van at the door',price:'55 EUR'},version:2,status:'suggested'});
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.knowledge_evidence WHERE node_id=$1',[first.nodes[0].id])).rows[0].n,2);
 // An editor may refine suggestions but cannot approve, reject or write approved knowledge.
 await assert.rejects(a.as(editor,true,db=>reviewNode(db,a.scope,{id:first.nodes[0].id,decision:'approve',actor:editor})),{code:'42501'});
 await assert.rejects(a.as(editor,true,db=>upsertNodes(db,a.scope,[suggestion('rule','no-medical','No medical claims',{status:'approved',origin:'owner',confidence:1})],{actor:editor})),{code:'42501'});
 // The owner approves with a correction; a reviewer cannot record someone else as the reviewer.
 await assert.rejects(a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:first.nodes[0].id,decision:'approve',actor:editor})),{code:'42501'});
 const approved=await a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:first.nodes[0].id,decision:'approve',actor:a.owner,label:'Doorstep Full Groom'}));
 assert.deepEqual([approved.status,approved.origin,approved.version,approved.label,approved.confidence],['approved','owner',3,'Doorstep Full Groom',1]);
 const later=await a.as(editor,true,db=>upsertNodes(db,a.scope,[suggestion('offer','groom','Cheap groom')]));
 assert.deepEqual([later[0].outcome,later[0].conflict,later[0].version],['kept',true,3]);
 // A rejected node stays rejected, and edges to it are not recorded.
 const junk=await a.as(editor,true,db=>upsertNodes(db,a.scope,[suggestion('competitor','not-a-competitor','Not a competitor')]));
 await a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:junk[0].id,decision:'reject',actor:a.owner}));
 const retry=await a.as(editor,true,db=>applyMutations(db,a.scope,{nodes:[suggestion('competitor','not-a-competitor','Not a competitor')],edges:[link(ref('offer','groom'),'differentiates_from',ref('competitor','not-a-competitor'))]}));
 assert.equal(retry.nodes[0].outcome,'kept');assert.deepEqual(retry.edges.map(e=>[e.outcome,e.id]),[['skipped',null]]);
 await assert.rejects(a.as(editor,true,db=>upsertEdges(db,a.scope,[link(ref('offer','groom'),'solves',ref('pain','missing'))])),/KNOWLEDGE_EDGE_DANGLING/);
 await assert.rejects(a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:randomUUID(),decision:'approve',actor:a.owner})),/KNOWLEDGE_NOT_FOUND/);
});

test('worker jobs suggest within their own business and can never approve',async()=>{
 const a=await fixture(),b=await fixture(),research=await a.job('brand.analyze'),other=await a.job('website.extract'),unrelated=await a.job('creative.export'),foreign=await b.job('brand.analyze');
 const result=await jobs.transaction(research,db=>applyMutations(db,research,{nodes:[suggestion('persona','anxious-owner','Anxious first-time owner',{evidence:[{jobId:research.jobId,excerpt:'worried about clippers'}]}),suggestion('pain','fear','Fear of the first groom',{origin:'inferred',confidence:0.5})],edges:[link(ref('persona','anxious-owner'),'has_pain',ref('pain','fear'),{origin:'inferred',confidence:0.5})]}));
 assert.deepEqual(result.nodes.map(n=>n.outcome),['inserted','inserted']);assert.equal(result.evidence,1);
 const actor=a.owner;
 await assert.rejects(jobs.transaction(research,db=>upsertNodes(db,research,[suggestion('rule','claim','Approved by a job',{status:'approved'})],{actor})),{code:'42501'});
 await assert.rejects(jobs.transaction(research,db=>upsertNodes(db,research,[suggestion('rule','owner-said','Owner statement',{origin:'owner'})])),{code:'42501'});
 await assert.rejects(jobs.transaction(research,db=>reviewNode(db,research,{id:result.nodes[0].id,decision:'approve',actor})),{code:'42501'});
 await assert.rejects(jobs.transaction(research,db=>db.query('UPDATE app.knowledge_nodes SET superseded_by=$2 WHERE id=$1',[result.nodes[0].id,result.nodes[1].id])),{code:'42501'});
 await assert.rejects(jobs.transaction(research,db=>db.query('DELETE FROM app.knowledge_nodes')),{code:'42501'});
 // Evidence may only cite the job that is running.
 await assert.rejects(jobs.transaction(research,db=>attachEvidence(db,research,{nodeId:result.nodes[0].id},[{jobId:other.jobId,excerpt:''}])),{code:'42501'});
 // Once the owner has approved a node, a later job leaves it untouched but may add evidence.
 await a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:result.nodes[0].id,decision:'approve',actor:a.owner}));
 const rerun=await jobs.transaction(other,db=>applyMutations(db,other,{nodes:[suggestion('persona','anxious-owner','Nervous owner',{evidence:[{jobId:other.jobId,excerpt:'second sighting'}]})],edges:[]}));
 assert.deepEqual([rerun.nodes[0].outcome,rerun.nodes[0].conflict,rerun.evidence],['kept',true,1]);
 assert.equal((await admin.query('SELECT label FROM app.knowledge_nodes WHERE id=$1',[result.nodes[0].id])).rows[0].label,'Anxious first-time owner');
 assert.equal((await jobs.transaction(research,db=>db.query("UPDATE app.knowledge_nodes SET label='Rewritten' WHERE id=$1",[result.nodes[0].id]))).rowCount,0);
 // Jobs of another business, or of a kind with no business in the graph, see and write nothing.
 await jobs.transaction(foreign,async db=>{for(const table of ['knowledge_nodes','knowledge_edges','knowledge_evidence'])assert.equal((await db.query(`SELECT * FROM app.${table}`)).rowCount,0);});
 await jobs.transaction(unrelated,async db=>assert.equal((await db.query('SELECT * FROM app.knowledge_nodes')).rowCount,0));
 await assert.rejects(jobs.transaction(unrelated,db=>upsertNodes(db,unrelated,[suggestion('offer','x','X')])),{code:'42501'});
 await assert.rejects(jobs.transaction(foreign,db=>upsertNodes(db,research,[suggestion('offer','planted','Planted')])),{code:'42501'});
 await assert.rejects(worker.query('SELECT * FROM app.knowledge_nodes').then(r=>assert.equal(r.rowCount,0)).then(()=>worker.query("INSERT INTO app.knowledge_nodes(id,organization_id,brand_id,type,key,label,origin,confidence) VALUES($1,$2,$3,'offer','nojob','No job','extracted',0.5)",[randomUUID(),a.org,a.brand])),{code:'42501'});
});

test('supersede and neighbourhood queries respect depth, status and history',async()=>{
 const a=await fixture(),approved={status:'approved',origin:'owner',confidence:1},ctx={actor:a.owner};
 const written=await a.as(a.owner,true,db=>applyMutations(db,a.scope,{nodes:[
  suggestion('business','self','Harbour & Pine',approved),suggestion('offer','groom','Doorstep groom',approved),suggestion('pain','no-car','No car',approved),
  suggestion('persona','owner','Anxious owner',approved),suggestion('angle','door','The salon comes to your door'),suggestion('offer','old-groom','Salon groom',approved)],edges:[
  link(ref('business','self'),'offers',ref('offer','groom'),approved),link(ref('offer','groom'),'solves',ref('pain','no-car'),approved),
  link(ref('persona','owner'),'has_pain',ref('pain','no-car'),approved),link(ref('angle','door'),'solves',ref('pain','no-car'))]},ctx));
 const id=Object.fromEntries(written.nodes.map(n=>[`${n.ref.type}:${n.ref.key}`,n.id])),labels=g=>g.nodes.map(n=>`${n.depth}:${n.label}`);
 const near=await a.as(a.owner,false,db=>neighbourhood(db,a.scope,{seeds:[id['business:self']],depth:1}));
 assert.deepEqual(labels(near),['0:Harbour & Pine','1:Doorstep groom']);assert.deepEqual(near.edges.map(e=>e.relation),['offers']);
 const wide=await a.as(a.owner,false,db=>neighbourhood(db,a.scope,{seeds:[id['business:self']],depth:99}));
 assert.deepEqual(labels(wide),['0:Harbour & Pine','1:Doorstep groom','2:No car','3:Anxious owner']);
 const unproven=await a.as(a.owner,false,db=>neighbourhood(db,a.scope,{seeds:[id['pain:no-car']],depth:1,includeSuggested:true}));
 assert.deepEqual(unproven.nodes.map(n=>n.label).sort(),['Anxious owner','Doorstep groom','No car','The salon comes to your door']);
 await assert.rejects(a.as(a.owner,false,db=>neighbourhood(db,a.scope,{seeds:['nope']})),/KNOWLEDGE_QUERY_INVALID/);
 // The replaced offer keeps its row and gains a link, but no longer appears when walking the graph.
 await a.as(a.owner,true,db=>upsertEdges(db,a.scope,[link(ref('business','self'),'offers',ref('offer','old-groom'),approved)],ctx));
 const replaced=await a.as(a.owner,true,db=>supersedeNode(db,a.scope,{oldId:id['offer:old-groom'],newId:id['offer:groom'],actor:a.owner}));
 assert.equal(replaced.superseded_by,id['offer:groom']);
 const after=await a.as(a.owner,false,db=>neighbourhood(db,a.scope,{seeds:[id['business:self']],depth:1}));
 assert.deepEqual(labels(after),['0:Harbour & Pine','1:Doorstep groom']);
 assert.equal((await admin.query("SELECT status FROM app.knowledge_edges WHERE relation='supersedes' AND from_node=$1 AND to_node=$2",[id['offer:groom'],id['offer:old-groom']])).rows[0].status,'approved');
 await assert.rejects(a.as(a.owner,true,db=>supersedeNode(db,a.scope,{oldId:id['offer:groom'],newId:id['offer:old-groom'],actor:a.owner})),/KNOWLEDGE_SUPERSEDE_INVALID/);
 await assert.rejects(a.as(a.owner,true,db=>supersedeNode(db,a.scope,{oldId:id['offer:groom'],newId:id['pain:no-car'],actor:a.owner})),/KNOWLEDGE_SUPERSEDE_INVALID/);
 const edge=(await admin.query("SELECT id FROM app.knowledge_edges WHERE relation='solves' AND from_node=$1",[id['angle:door']])).rows[0].id;
 assert.equal((await a.as(a.owner,true,db=>reviewEdge(db,a.scope,{id:edge,decision:'approve',actor:a.owner}))).status,'approved');
});

test('an approved brand profile becomes a graph and feeds task context packs with a production ledger',async()=>{
 const a=await fixture(),b=await fixture(),editor=await member(a.org,'editor'),analysis=await a.job('brand.analyze');
 const snapshot={schema_version:1,missing_fields:[],facts:[
  {field:'brand_name',value:'Harbour & Pine',extraction_type:'manual',status:'correct'},
  {field:'offering',value:'Mobile dog grooming at the customer’s door, including a gentle first groom for puppies.',extraction_type:'manual',status:'correct'},
  {field:'audience',value:'Busy apartment owners with small breeds',extraction_type:'manual',status:'correct'},
  {field:'prohibited_claims',value:'Never promise veterinary outcomes',extraction_type:'manual',status:'correct'},
  {field:'visual_direction_palette',value:'Sea green and warm sand',status:'approved',analysis_job_id:analysis.jobId,evidence_sha256:'ab'.repeat(32),observation:'Hero uses sea green'}]};
 const graph=fromBrandBrainSnapshot(snapshot);
 // Approved knowledge needs a reviewer: an editor cannot import it, and neither can a job.
 await assert.rejects(a.as(editor,true,db=>applyMutations(db,a.scope,graph,{actor:editor})),{code:'42501'});
 await assert.rejects(jobs.transaction(analysis,db=>applyMutations(db,analysis,graph,{actor:a.owner})),{code:'42501'});
 const imported=await a.as(a.owner,true,db=>applyMutations(db,a.scope,graph,{actor:a.owner}));
 assert.equal(imported.nodes.every(n=>n.outcome==='inserted'),true);assert.equal(imported.edges.every(e=>e.outcome==='inserted'),true);assert.equal(imported.evidence,1);
 const repeat=await a.as(a.owner,true,db=>applyMutations(db,a.scope,graph,{actor:a.owner}));
 assert.equal(repeat.nodes.every(n=>n.outcome==='touched'&&n.version===1),true);assert.equal(repeat.evidence,0);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.knowledge_nodes WHERE brand_id=$1 AND status='approved' AND reviewed_by=$2",[a.brand,a.owner])).rows[0].n,5);

 // Research suggests angles; generation records which angle and format a post used.
 const plan=await a.job('plan.generate'),creative=await a.job('creative.generate'),theirs=await b.job('plan.generate');
 await jobs.transaction(plan,db=>applyMutations(db,plan,{nodes:[
  suggestion('angle','first-groom','A first groom built for puppies',{properties:{summary:'Calm introduction so puppies are not frightened'},evidence:[{jobId:plan.jobId,excerpt:''}]}),
  suggestion('angle','vans','Dogs love vans',{origin:'inferred',confidence:0.3}),
  suggestion('pain','fear','Fear that the first groom frightens the puppy',{origin:'inferred',confidence:0.65})],
  edges:[link(ref('angle','first-groom'),'solves',ref('pain','fear'),{origin:'inferred',confidence:0.65}),link(ref('angle','first-groom'),'targets',ref('audience','audience'))]}));
 await jobs.transaction(creative,db=>applyMutations(db,creative,{nodes:[suggestion('post','post-1','Puppy carousel, week 1',{confidence:1}),suggestion('format','carousel','Carousel',{confidence:1})],
  edges:[link(ref('angle','first-groom'),'used_in',ref('post','post-1'),{confidence:1}),link(ref('format','carousel'),'used_in',ref('post','post-1'),{confidence:1})]}));

 const task={kind:'plan',input:'Ideas for the first groom of a new puppy'};
 const pack=await jobs.transaction(plan,db=>buildContextPack(db,plan,task));
 const items=pack.items.map(i=>[i.type,i.standing]);
 assert.deepEqual(items.slice(0,4).map(i=>i[1]),['approved','approved','approved','approved']);assert.equal(pack.items[0].type,'rule');
 assert.deepEqual(items.filter(i=>i[1]==='unproven').map(i=>i[0]).sort(),['angle','format','pain']);
 assert.equal(items.findIndex(i=>i[1]==='unproven')>items.map(i=>i[1]).lastIndexOf('approved'),true);
 assert.equal(pack.items.some(i=>i.label==='Dogs love vans'||i.type==='post'),false);
 const angle=pack.items.find(i=>i.label==='A first groom built for puppies');
 assert.deepEqual(angle.relations,[{relation:'solves',to:'Fear that the first groom frightens the puppy',to_type:'pain',standing:'unproven'},{relation:'targets',to:'Busy apartment owners with small breeds',to_type:'audience',standing:'unproven'}]);
 assert.deepEqual(pack.ledger.map(l=>[l.type,l.label,l.uses]).sort(),[['angle','A first groom built for puppies',1],['format','Carousel',1]]);
 assert.equal(pack.bytes<=pack.budget_bytes,true);assert.equal(pack.truncated,false);
 const known=(await admin.query('SELECT id FROM app.knowledge_nodes WHERE brand_id=$1',[a.brand])).rows.map(r=>r.id);
 assert.equal(pack.used_node_ids.length,pack.items.length);assert.equal(pack.used_node_ids.every(id=>known.includes(id)),true);assert.equal(pack.used_edge_ids.length>0,true);
 // Deterministic: the app role sees the same pack as the job, and a second call matches the first.
 assert.deepEqual(await a.as(a.owner,false,db=>buildContextPack(db,a.scope,task)),pack);
 // A creative pack brings the visual direction; outside the ledger window nothing is reported as recent.
 const visual=await a.as(a.owner,false,db=>buildContextPack(db,a.scope,{kind:'creative',input:'puppy carousel',now:new Date(Date.now()+90*86400000)}));
 assert.equal(visual.items.some(i=>i.type==='visual_direction'&&i.standing==='approved'),true);assert.deepEqual(visual.ledger,[]);
 // Rejecting the suggestion removes it from the next pack; another business's job sees none of this.
 await a.as(a.owner,true,db=>reviewNode(db,a.scope,{id:angle.id,decision:'reject',actor:a.owner}));
 const next=await a.as(a.owner,false,db=>buildContextPack(db,a.scope,task));
 assert.equal(next.items.some(i=>i.id===angle.id),false);assert.equal(next.ledger.some(l=>l.node_id===angle.id),false);
 const foreign=await jobs.transaction(theirs,db=>buildContextPack(db,a.scope,task));
 assert.deepEqual([foreign.items,foreign.ledger,foreign.used_node_ids],[[],[],[]]);
 await assert.rejects(a.as(a.owner,false,db=>buildContextPack(db,a.scope,{kind:'plan',input:'x',ledgerDays:0})),/KNOWLEDGE_CONTEXT_INVALID/);
});
