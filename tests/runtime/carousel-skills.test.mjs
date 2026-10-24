import {test,before} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import OpenAI from 'openai';import {GoogleGenAI} from '@google/genai';
import {prepareSkillImage} from '../../scripts/skill-test-image.mjs';import {SkillRuntime} from '../../dist/skill-runtime.js';
import {CreativeProvider} from '../../dist/creative-provider.js';import {GeminiPlanner} from '../../dist/gemini-planner.js';
import {CAROUSEL_SKILLS} from '../../dist/carousel-planning.js';import {carouselInput,carouselPlan} from '../fixtures/carousel-planning.mjs';
let runtime;before(()=>{runtime=new SkillRuntime(prepareSkillImage());});
test('actual isolated carousel runtime loads original four skills with credential-free read-only boundaries (MOCK model)',async()=>{
 let calls=0;const result=await runtime.carouselPlan(carouselInput(),async request=>{calls++;assert.ok(request.messages.some(m=>m.content.includes('ONE coordinated ordered carousel')));const ids=execFileSync('docker',['ps','--filter','label=desvio.purpose=skill-sandbox','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);assert.equal(ids.length,1);const [container]=JSON.parse(execFileSync('docker',['inspect',ids[0]],{encoding:'utf8'}));assert.equal(container.HostConfig.NetworkMode,'none');assert.equal(container.HostConfig.ReadonlyRootfs,true);assert.equal(container.Config.User,'65534:65534');assert.equal(container.Mounts.length,0);assert.ok(!container.Config.Env.some(e=>/^(OPENAI_API_KEY|GEMINI_API_KEY|DATABASE_URL|AWS_SECRET_ACCESS_KEY)=/.test(e)));return {content:JSON.stringify(carouselPlan()),tool_calls:[]};});assert.equal(calls,1);assert.equal(result.plan.slides.length,3);assert.equal(result.helpers_executed,false);for(const [name,pin]of Object.entries(CAROUSEL_SKILLS)){assert.ok(result.reads.includes(`/skills/${name}/SKILL.md`));assert.deepEqual(result.skills.find(s=>s.name===name),{name,...pin});}
});
test('OpenAI and Gemini official planner adapters each return a coordinated carousel through the actual runtime (MOCK transport)',async()=>{
 let openai=0,gemini=0;const input=carouselInput(2),plan=carouselPlan(2);
 const a=new CreativeProvider(undefined,new OpenAI({apiKey:'LOCAL MOCK',maxRetries:0,fetch:async(_url,init)=>{openai++;const wire=JSON.parse(init.body);assert.equal(wire.max_output_tokens,16000);assert.ok(wire.input.some(m=>m.content?.includes('UNTRUSTED BUSINESS DATA AND REQUEST:')));return Response.json({object:'response',id:'mock-carousel',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(plan),annotations:[]}]}]});}}));
 const b=new GeminiPlanner(undefined,new GoogleGenAI({apiKey:'LOCAL MOCK',httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1},fetch:async(_url,init)=>{gemini++;const wire=JSON.parse(init.body);assert.equal(wire.generationConfig.maxOutputTokens,16000);return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(plan)}]},finishReason:'STOP'}]});}}}));
 assert.equal((await runtime.carouselPlan(input,r=>a.plan(r,'MOCK-carousel',16000))).plan.slides.length,2);assert.equal((await runtime.carouselPlan(input,r=>b.plan(r,'gemini-fixture',16000))).plan.slides.length,2);assert.equal(openai,1);assert.equal(gemini,1);
});
test('carousel runtime fails closed on malformed output and unsupported tools; invalid input makes no model call',async()=>{
 let calls=0;assert.throws(()=>runtime.carouselPlan({...carouselInput(),slide_count:99},async()=>{calls++;throw Error('must not run');}),/CAROUSEL_INPUT_INVALID/);assert.equal(calls,0);
 await assert.rejects(runtime.carouselPlan(carouselInput(),async()=>({content:JSON.stringify(carouselPlan(2)),tool_calls:[]})),/CAROUSEL_PLAN_INVALID/);
 await assert.rejects(runtime.carouselPlan(carouselInput(),async()=>({content:'',tool_calls:[{id:'bad',name:'publish',args:{}}]})),/SKILL_/);
});
