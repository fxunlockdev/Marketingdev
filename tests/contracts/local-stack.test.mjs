import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {parseArgs} from '../../scripts/local-stack.mjs';
import {providerEnvironment,apiEnvironment,workerEnvironment,DEFAULT_PORTS} from '../../scripts/local-stack/config.mjs';
import {respond,placeholderImage} from '../../scripts/local-stack/mock-providers.mjs';
import {validateBusinessDirection,BUSINESS_DIRECTION_SCHEMA} from '../../dist/business-research-direction.js';
import {carouselPlanSchema,validateCarouselPlan} from '../../dist/carousel-planning.js';
import {QA_SCHEMA} from '../../dist/image-qa.js';
import {carouselInput} from '../fixtures/carousel-planning.mjs';

const secrets={roles:{APP_DATABASE_PASSWORD:'a'.repeat(64),AUTH_DATABASE_PASSWORD:'b'.repeat(64),MAIL_DATABASE_PASSWORD:'c'.repeat(64),WORKER_DATABASE_PASSWORD:'d'.repeat(64),DISPATCHER_DATABASE_PASSWORD:'e'.repeat(64),POSTIZ_PROVISIONER_DATABASE_PASSWORD:'f'.repeat(64)},
 authSecret:'1'.repeat(64),mailEncryptionKey:'2'.repeat(64),storageAccessKeyId:'GK'+'3'.repeat(24),storageSecretAccessKey:'4'.repeat(64)};

test('live mode demands an explicit spend cap; mock mode refuses one',()=>{
 assert.equal(parseArgs(['start']).mode,'mock');
 assert.throws(()=>parseArgs(['start','--live']),/spend-cap-usd/);
 assert.equal(parseArgs(['start','--live','--spend-cap-usd','5']).spendCapUsd,5);
 assert.throws(()=>parseArgs(['start','--mock','--spend-cap-usd','5']),/live only/);
 assert.throws(()=>parseArgs(['start','--live','--spend-cap-usd','0']),/between/);
 assert.throws(()=>parseArgs(['start','--web-port','80']),/web-port/);
});

test('mock mode never forwards keys from the operator shell, and live mode forwards only named keys',()=>{
 const liveKeys={OPENAI_API_KEY:'sk-live-fixture',VECTEEZY_API_KEY:'v',VECTEEZY_ACCOUNT_ID:'7',POSTFORME_API_KEY:'p',UNRELATED:'x'};
 const mock=providerEnvironment({mode:'mock',ports:DEFAULT_PORTS,liveKeys},'worker');
 assert.equal(mock.OPENAI_API_KEY,'local-mock-openai-key');
 assert.equal(mock.OPENAI_BASE_URL,`http://127.0.0.1:${DEFAULT_PORTS.mock}/v1`);
 assert.ok(!JSON.stringify(mock).includes('sk-live-fixture'));
 assert.deepEqual(providerEnvironment({mode:'mock',ports:DEFAULT_PORTS,liveKeys},'api'),{});
 const worker=providerEnvironment({mode:'live',ports:DEFAULT_PORTS,liveKeys},'worker');
 assert.equal(worker.OPENAI_API_KEY,'sk-live-fixture');assert.equal(worker.OPENAI_BASE_URL,undefined);assert.equal(worker.UNRELATED,undefined);
 const api=providerEnvironment({mode:'live',ports:DEFAULT_PORTS,liveKeys},'api');
 assert.equal(api.OPENAI_API_KEY,undefined,'the API never holds a model key');
 assert.equal(api.POSTFORME_ENABLED,'true');
});

test('process environments drop shell settings that could redirect a service',()=>{
 const saved={...process.env};
 Object.assign(process.env,{OPENAI_BASE_URL:'https://elsewhere.example',DATABASE_URL:'postgres://remote',APP_DATABASE_URL:'postgres://remote',S3_ENDPOINT:'https://remote',OPENAI_API_KEY:'sk-shell'});
 try{
  const context={mode:'mock',ports:DEFAULT_PORTS,secrets,images:{skill:'sha256:'+'9'.repeat(64)},liveKeys:process.env};
  const api=apiEnvironment(context),worker=workerEnvironment(context);
  assert.equal(api.APP_MODE,'development');assert.equal(api.DATABASE_URL,undefined);assert.match(api.APP_DATABASE_URL,/^postgresql:\/\/desvio_app:/);
  assert.equal(api.S3_ENDPOINT,`http://127.0.0.1:${DEFAULT_PORTS.storage}`);assert.equal(api.OPENAI_API_KEY,undefined);assert.equal(api.OPENAI_BASE_URL,undefined);
  assert.equal(worker.OPENAI_API_KEY,'local-mock-openai-key');assert.equal(worker.OPENAI_BASE_URL,`http://127.0.0.1:${DEFAULT_PORTS.mock}/v1`);
  assert.equal(worker.SKILL_RUNTIME_IMAGE,'sha256:'+'9'.repeat(64));assert.equal(worker.AUTH_DATABASE_URL,undefined);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});

test('mock brand analysis returns a business direction Desvio accepts, with no blocking questions',()=>{
 const evidence={chunks:[{id:'chunk-1',text:'Harbour Lane Bakery bakes sourdough every morning. Friendly staff.'},{id:'chunk-2',text:JSON.stringify({brand_name:'Harbour Lane Bakery',audience:'Local families'})}]};
 const body={model:'m',input:JSON.stringify(evidence),text:{format:{type:'json_schema',name:'brand_onboarding',strict:true,schema:{type:'object',properties:{findings:{type:'array',items:{type:'object',properties:{field:{type:'string',enum:['brand_name','audience','offering']},value:{type:'string'},chunk_id:{type:'string'},quote:{type:'string'}}}},recommendation:{anyOf:[{type:'null'}]},missing:{type:'array',items:{type:'string'}},business_direction:BUSINESS_DIRECTION_SCHEMA}}}}};
 const {kind,json}=respond(body),value=JSON.parse(json.output_text);
 assert.equal(kind,'brand-analysis');
 assert.deepEqual(validateBusinessDirection(value.business_direction,['chunk-1','chunk-2']).essential_questions,[]);
 for(const f of value.findings)assert.ok(evidence.chunks.find(c=>c.id===f.chunk_id).text.includes(f.quote));
 assert.equal(value.findings.find(f=>f.field==='brand_name').value,'Harbour Lane Bakery');
});

test('mock carousel plans pass the carousel validator (distinct slides, exact positions)',()=>{
 const input=carouselInput(3);
 const schema=carouselPlanSchema(input);
 const body={model:'m',input:[{role:'user',content:'UNTRUSTED BUSINESS DATA AND REQUEST:\n'+JSON.stringify(input)}],tools:[{type:'function',name:'read_file'}],text:{format:{type:'json_schema',name:'desvio_carousel_plan',strict:true,schema}}};
 const plan=JSON.parse(respond(body).json.output_text);
 assert.equal(validateCarouselPlan(plan,input).slides.length,3);
});

test('mock image check reports exactly the expected lettering; placeholder images have the requested size',async()=>{
 const body={model:'m',input:[{role:'system',content:'x'},{role:'user',content:[{type:'input_text',text:'SPECIFICATION (data):\n'+JSON.stringify({expected_text:['Made for you','Visit us']})},{type:'input_image',image_url:'data:image/jpeg;base64,AA=='}]}],text:{format:{type:'json_schema',name:'desvio_image_qa',strict:true,schema:QA_SCHEMA}}};
 const verdict=JSON.parse(respond(body).json.output_text);
 assert.deepEqual(verdict.found_text,['Made for you','Visit us']);assert.equal(verdict.verdict,'pass');
 for(const size of ['1024x1024','1536x1024','1024x1536']){
  const meta=await sharp(await placeholderImage('Headline: "Fresh bread" #112233 #445566',size)).metadata();
  assert.equal(`${meta.width}x${meta.height}`,size);assert.equal(meta.format,'png');
 }
});
