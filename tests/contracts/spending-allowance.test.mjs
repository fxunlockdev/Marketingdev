import test from 'node:test';
import assert from 'node:assert/strict';
import {exceedsAllowance} from '../../dist/spending-allowance.js';
import {configurationManifest} from '../../scripts/configure-providers.mjs';
import {randomUUID} from 'node:crypto';
test('explicit uncapped allowance retains arithmetic integrity and fails closed for omitted or malformed caps',()=>{
 assert.equal(exceedsAllowance(2_000_000_000,null),false);
 for(const budget of [undefined,NaN,Infinity,0,-1,'','Infinity','100x',{},false])assert.equal(exceedsAllowance(1,budget),true);
 for(const total of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1])assert.equal(exceedsAllowance(total,null),true);
 assert.equal(exceedsAllowance(100,'100'),false);assert.equal(exceedsAllowance(101,'100'),true);
});
test('uncapped manifest is explicit, audited input and still validates per-call pricing',()=>{
 const m={version:1,change_id:randomUUID(),organization_id:randomUUID(),business_id:randomUUID(),operator_reference:'Owner explicitly chose uncapped',grants:[{kind:'video',enabled:true,expires_at:new Date(Date.now()+86400000).toISOString(),budget_micros:null,models:['kling-video/v3.0/std/image-to-video'],max_create_micros:1000,max_edit_micros:1000}]};
 assert.equal(configurationManifest(m).grants[0].budget_micros,null);
 const missing=structuredClone(m);delete missing.grants[0].budget_micros;assert.throws(()=>configurationManifest(missing));
 m.grants[0].max_create_micros=null;assert.throws(()=>configurationManifest(m));
});

test('uncapped creative calls still reserve usage, replay once and respect later finite caps',async()=>{
 const {CreativeJobs}=await import('../../dist/creative-jobs.js');
 let cap=null,record=null,submissions=0,reservations=0;
 const db={query:async(sql,args)=>{
  if(sql.includes('SELECT * FROM app.creative_calls'))return {rows:record?[record]:[]};
  if(sql.includes('sum(reserved_micros)'))return {rows:[{n:'2000000000'}]};
  if(sql.startsWith('INSERT INTO app.creative_calls')){reservations++;record={provider:'openai',model:'test-image',input_sha256:'hash',status:'submitted'};}
  if(sql.includes("SET status='succeeded'")){record.status='succeeded';record.result=JSON.parse(args[2]);}
  return {rows:[],rowCount:0};
 }};
 const jobs={permitted:async()=>true,transaction:async(_scope,fn)=>fn(db,{id:'job',kind:'creative.generate'})};
 const worker=new CreativeJobs(jobs,{},{});worker.plannerGrant=async()=>({image_model:'test-image',budget_micros:cap});
 const run=()=>worker.call({},'image','test-image','hash',()=>10,async()=>{submissions++;return {saved:'MOCK image'};});
 assert.deepEqual(await run(),{saved:'MOCK image'});assert.deepEqual(await run(),{saved:'MOCK image'});
 assert.equal(submissions,1);assert.equal(reservations,1);
 record=null;cap=100;
 await assert.rejects(run(),e=>e.code==='CREATIVE_BUDGET_EXHAUSTED');assert.equal(submissions,1);
 cap=undefined;await assert.rejects(run(),e=>e.code==='CREATIVE_BUDGET_EXHAUSTED');assert.equal(submissions,1);
});
