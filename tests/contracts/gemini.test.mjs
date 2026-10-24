import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleGenAI,ApiError} from '@google/genai';
import {GeminiPlanner} from '../../dist/gemini-planner.js';
const first={type:'model',step:1,messages:[{role:'system',content:'Read only the supplied skill.'},{role:'user',content:'UNTRUSTED FIXTURE'}],tools:[{type:'function',function:{name:'read_file',description:'Read a pinned skill',parameters:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}}]};
const response=parts=>Response.json({candidates:[{content:{role:'model',parts},finishReason:'STOP'}],responseId:'mock-gemini',usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}});
function adapter(fetch){return new GeminiPlanner(undefined,new GoogleGenAI({apiKey:'LOCAL MOCK ONLY',httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1},fetch}}));}
test('official Gemini SDK preserves signed function parts across the skill broker without automatic tool calls',async()=>{
 const signed=[{functionCall:{name:'read_file',args:{file_path:'/skills/marketing-plan/SKILL.md'}},thoughtSignature:'opaque-test-signature'}];let calls=0;
 const provider=adapter(async(url,init)=>{
  calls++;assert.equal(new URL(url).pathname,'/v1beta/models/gemini-fixture:generateContent');const body=JSON.parse(init.body);
  assert.equal(body.generationConfig.maxOutputTokens,16000);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.generationConfig.thinkingConfig.includeThoughts,false);
  assert.equal(body.tools[0].functionDeclarations[0].name,'read_file');
  if(calls===1)return response(signed);
  assert.deepEqual(body.contents.find(m=>m.role==='model').parts,signed);
  assert.deepEqual(body.contents.at(-1).parts,[{functionResponse:{name:'read_file',response:{result:'Pinned skill content'}}}]);
  return response([{text:'Private summary',thought:true,thoughtSignature:'opaque-thought'},{text:'{"title":"Grounded plan"}',thoughtSignature:'opaque-final'}]);
 });
 const wire=provider.plannerRequest(first,'gemini-fixture');assert.ok(wire.maxInputTokens>=JSON.stringify(wire.body).length);
 const result=await provider.plan(first,'gemini-fixture');assert.equal(calls,1);assert.equal(result.tool_calls[0].name,'read_file');assert.deepEqual(result.provider_context.parts,signed);
 const next={...first,step:2,messages:[...first.messages,{role:'assistant',content:result.content,tool_calls:result.tool_calls,provider_context:result.provider_context},{role:'tool',content:'Pinned skill content',tool_call_id:result.tool_calls[0].id}]};
 const final=await provider.plan(next,'gemini-fixture');assert.equal(calls,2);assert.equal(final.content,'{"title":"Grounded plan"}');assert.equal(final.provider_context.parts.length,2);
 const bad=structuredClone(next);bad.messages[2].tool_calls[0].args.file_path='/etc/passwd';assert.throws(()=>provider.plannerRequest(bad,'gemini-fixture'),/SKILL_BROKER_INVALID/);
});
test('Gemini rejects unsupported tools and malformed results, and never retries a rejected request',async()=>{
 let calls=0;const provider=adapter(async()=>{calls++;return Response.json({error:{code:429,message:'MOCK quota rejection',status:'RESOURCE_EXHAUSTED'}},{status:429});});
 await assert.rejects(provider.plan(first,'gemini-fixture'),e=>e instanceof ApiError&&e.status===429);assert.equal(calls,1);
 assert.throws(()=>provider.plannerRequest({...first,tools:[{type:'function',function:{name:'publish'}}]},'gemini-fixture'));
 const bad=adapter(async()=>response([{functionCall:{name:'shell',args:{command:'no'}}}]));await assert.rejects(bad.plan(first,'gemini-fixture'));
 const truncated=adapter(async()=>Response.json({candidates:[{content:{role:'model',parts:[{text:'partial'}]},finishReason:'MAX_TOKENS'}]}));await assert.rejects(truncated.plan(first,'gemini-fixture'),/CREATIVE_PLAN_REJECTED/);
});
