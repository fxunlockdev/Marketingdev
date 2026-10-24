import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeTextProvider} from '../../dist/creative-planning.js';
import {CreativeJobs} from '../../dist/creative-jobs.js';
import {Planning} from '../../dist/planning.js';

test('new creative and mixed-calendar submissions accept only OpenAI',()=>{
 assert.equal(creativeTextProvider(undefined),'openai');assert.equal(creativeTextProvider('openai'),'openai');
 const planning=new Planning({scope:()=>{throw Error('must not reach storage');}});
 for(const provider of ['gemini','claude','',null]){
  assert.throws(()=>creativeTextProvider(provider),/GPT only/);
  if(provider!==null)assert.throws(()=>planning.submit('user','brand',{starts_on:'2026-11-01',provider},'request-key'),/GPT only/);
 }
});

test('legacy Gemini work cannot reserve or submit a fresh call, but cached paid output is preserved',async()=>{
 let cached=false,sent=0;
 const db={query:async sql=>{
  if(sql.includes('SELECT text_provider'))return {rows:[{text_provider:'gemini',selected_text_model:'legacy-model'}]};
  if(sql.includes('SELECT * FROM app.creative_calls'))return {rows:cached?[{provider:'gemini',model:'legacy-model',input_sha256:'hash',status:'succeeded',result:{content:'saved paid output'}}]:[]};
  if(sql.includes('INSERT'))throw Error('must not reserve');
  return {rows:[]};
 }};
 const jobs={permitted:async()=>true,transaction:async(_scope,fn)=>fn(db,{id:'job',kind:'creative.generate'})};
 const worker=new CreativeJobs(jobs,{},{});
 const call=()=>worker.call({},'plan:1','legacy-model','hash',()=>1,async()=>{sent++;return {};},'gemini');
 await assert.rejects(call(),e=>e.code==='CREATIVE_GPT_REQUIRED');assert.equal(sent,0);
 cached=true;assert.deepEqual(await call(),{content:'saved paid output'});assert.equal(sent,0);
});
