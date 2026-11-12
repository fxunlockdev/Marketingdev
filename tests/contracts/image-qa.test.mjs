import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import sharp from 'sharp';
import {CreativeProvider} from '../../dist/creative-provider.js';
import {ImageQa,QA_SCHEMA,validateQaFinding,settleVerdict,expectedTextFound,qaExpectation,qaRetryNotes,qaPreview,qaReport} from '../../dist/image-qa.js';
import {MODEL_POLICY,reservationRates} from '../../dist/model-policy.js';

const direction={layout_archetype:'lifestyle_hero',text_mode:'in_image',headline_treatment:'Bold sans, top left',hierarchy:'Headline then dog',composition:'Dog on the right third',lighting:'Soft morning light',palette_roles:{dominant:'#f4efe6',headline:'#112233',accent:'#ff6b35'},product_placement:'Grooming kit on the counter',logo_placement:'bottom_right'};
const brief={headline:'Fresh coats, happy dogs',body:'',cta:'Book now',caption:'Grooming that dogs enjoy.',image_prompt:'A happy dog after grooming.',palette:['#ffffff','#112233'],fact_ids:['f1'],warnings:[],art_direction:direction};
const identity=[{id:'f1',field:'brand_name',value:'Groomday'},{id:'f2',field:'offering',value:'Dog grooming'}];
const good={text_matches:true,found_text:['FRESH COATS,','HAPPY DOGS','Book now'],brief_fit:5,brand_fit:4,artefacts:[],verdict:'pass'};
const expectation=qaExpectation(brief,'in_image',identity);
const png=await sharp({create:{width:1024,height:1536,channels:3,background:'#336699'}}).png().toBuffer();
const reply=value=>Response.json({id:'resp_qa',object:'response',status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:900,output_tokens:80,total_tokens:980}});
const qaWith=fetch=>new ImageQa(new CreativeProvider(undefined,new OpenAI({apiKey:'fixture',maxRetries:0,fetch})));

test('expectation carries the exact designed copy only when type is designed into the image',()=>{
 assert.deepEqual(expectation.expected_text,['Fresh coats, happy dogs','Book now']);
 assert.deepEqual(expectation.allowed_text,['Groomday']);
 assert.deepEqual(qaExpectation(brief,'overlay',identity).expected_text,[]);
 assert.deepEqual(qaExpectation(brief,'none',identity).expected_text,[]);
});

test('strict finding contract: exact keys, bounded lists, scores 1-5, closed verdicts',()=>{
 assert.deepEqual(validateQaFinding(good),good);
 assert.deepEqual([...QA_SCHEMA.required].sort(),Object.keys(good).sort());
 assert.equal(QA_SCHEMA.additionalProperties,false);
 for(const bad of [null,[],{},{...good,extra:1},{...good,verdict:'approve'},{...good,brief_fit:0},{...good,brand_fit:6},{...good,brief_fit:4.5},{...good,text_matches:'yes'},{...good,found_text:'x'},{...good,found_text:['x'.repeat(301)]},{...good,artefacts:Array(11).fill('x')},(({artefacts,...rest})=>rest)(good)])
  assert.throws(()=>validateQaFinding(bad),e=>e.code==='IMAGE_QA_INVALID');
});

test('spelling is verified against the transcription, not only the checker\'s own boolean',()=>{
 assert.equal(expectedTextFound(['Fresh coats, happy dogs'],['FRESH COATS,','HAPPY DOGS']),true);
 assert.equal(expectedTextFound(['Don’t wait'],["DON'T WAIT"]),true);
 assert.equal(expectedTextFound(['Fresh coats, happy dogs'],['FRESH COTS, HAPPY DOGS']),false);
 assert.equal(settleVerdict(good,expectation),'pass');
 // The checker claims a match but its own transcription is misspelled: regenerate.
 assert.equal(settleVerdict({...good,found_text:['Fresh cots, happy dogs','Book now']},expectation),'retry');
 assert.equal(settleVerdict({...good,text_matches:false},expectation),'retry');
 // A pass with a poor score is not a pass.
 assert.equal(settleVerdict({...good,brand_fit:2},expectation),'flag');
 assert.equal(settleVerdict({...good,verdict:'flag'},expectation),'flag');
});

test('request sends one downscaled JPEG and the specification, strict JSON out, on the check model, nothing stored',async()=>{
 const preview=await qaPreview(png),meta=await sharp(preview).metadata();
 assert.equal(meta.format,'jpeg');assert.equal(meta.height,1024);assert.ok(meta.width<1024);
 let sent;
 const qa=qaWith(async(_url,init)=>{sent=JSON.parse(init.body);return reply(good);});
 const wire=qa.request(preview,expectation);
 assert.equal(wire.model,MODEL_POLICY.check.model);
 assert.match(wire.sha256,/^[a-f0-9]{64}$/);
 const rates=reservationRates('check');
 assert.equal(qa.reservation(wire),wire.maxInputTokens*rates.input_micros_per_token+wire.maxOutputTokens*rates.output_micros_per_token);
 assert.ok(wire.maxInputTokens>=preview.toString('base64').length);
 assert.deepEqual(await qa.check(wire),good);
 assert.equal(sent.model,MODEL_POLICY.check.model);
 assert.equal(sent.store,false);
 assert.equal(sent.tools,undefined);
 assert.equal(sent.text.format.strict,true);
 assert.deepEqual(sent.text.format.schema,JSON.parse(JSON.stringify(QA_SCHEMA)));
 const [text,image]=sent.input[1].content;
 assert.ok(text.text.includes('Fresh coats, happy dogs'));
 assert.ok(image.image_url.startsWith('data:image/jpeg;base64,'));
});

test('a malformed, refused or failed check is an error the caller can absorb, never a silent pass',async()=>{
 const preview=await qaPreview(png);
 for(const fetch of [async()=>reply('not json'),async()=>reply({...good,verdict:'approve'}),async()=>Response.json({id:'r',object:'response',status:'incomplete',output:[]}),async()=>Response.json({error:{message:'down'}},{status:500})]){
  const qa=qaWith(fetch);
  await assert.rejects(qa.check(qa.request(preview,expectation)));
 }
 assert.equal(new ImageQa(new CreativeProvider()).configured,false);
});

test('retry notes quote what was wrong and restate the exact copy; they are data, bounded',()=>{
 const notes=qaRetryNotes({...good,text_matches:false,found_text:['Fresh cots'],artefacts:['Six fingers on the left hand'],brief_fit:3,verdict:'retry'},expectation);
 assert.ok(notes.startsWith('\nQUALITY REVIEW OF THE PREVIOUS ATTEMPT'));
 assert.ok(notes.includes('"Fresh cots"'));
 assert.ok(notes.includes('"Fresh coats, happy dogs" and "Book now"'));
 assert.ok(notes.includes('Six fingers on the left hand'));
 assert.match(notes,/creative task and art direction/);
 assert.ok(qaRetryNotes({...good,text_matches:false,found_text:Array(30).fill('x'.repeat(300)),artefacts:Array(10).fill('y'.repeat(300))},expectation).length<4000);
});

test('report: retry never survives as a final verdict, and an unavailable check is recorded as such',()=>{
 const model=MODEL_POLICY.check.model,bad={...good,text_matches:false,verdict:'retry'};
 const first={step:'qa:1',media_sha256:'a'.repeat(64),status:'checked',finding:bad},second={step:'qa:2',media_sha256:'b'.repeat(64),status:'checked',finding:good};
 assert.equal(qaReport(model,expectation,[{...first,finding:good}],false).verdict,'pass');
 const fixed=qaReport(model,expectation,[first,second],true);
 assert.equal(fixed.verdict,'pass');assert.equal(fixed.retried,true);assert.equal(fixed.attempts.length,2);
 assert.equal(qaReport(model,expectation,[first,{...second,finding:bad}],true).verdict,'flag');
 const failedRetry=qaReport(model,expectation,[first],false,'CREATIVE_REQUEST_BUDGET_EXHAUSTED');
 assert.equal(failedRetry.verdict,'flag');assert.equal(failedRetry.retry_error,'CREATIVE_REQUEST_BUDGET_EXHAUSTED');
 const down=qaReport(model,expectation,[{step:'qa:1',media_sha256:'a'.repeat(64),status:'unavailable',reason:'CREATIVE_PROVIDER_REJECTED'}],false);
 assert.equal(down.status,'unavailable');assert.equal(down.verdict,'unavailable');
 assert.deepEqual(down.expected_text,['Fresh coats, happy dogs','Book now']);
});

test('report: an output too close to its stock photo is regenerated once, then flagged, and the closeness is recorded',()=>{
 const model=MODEL_POLICY.check.model;
 const checked={step:'qa:1',media_sha256:'a'.repeat(64),status:'checked',finding:good};
 const near=(step,sha)=>({step,media_sha256:sha,status:'checked',distance:2,too_close:true});
 const far=(step,sha)=>({step,media_sha256:sha,status:'checked',distance:30,too_close:false});
 // A passing vision check does not survive an output that is little more than the stock photo.
 const stillClose=qaReport(model,expectation,[checked,{...checked,step:'qa:2',media_sha256:'b'.repeat(64)}],true,undefined,{threshold:6,checks:[near('qa:1','a'.repeat(64)),near('qa:2','b'.repeat(64))]});
 assert.equal(stillClose.verdict,'flag');
 assert.deepEqual(stillClose.stock_source,{threshold:6,checks:[near('qa:1','a'.repeat(64)),near('qa:2','b'.repeat(64))]});
 const fixed=qaReport(model,expectation,[checked,{...checked,step:'qa:2'}],true,undefined,{threshold:6,checks:[near('qa:1','a'.repeat(64)),far('qa:2','b'.repeat(64))]});
 assert.equal(fixed.verdict,'pass');
 // The vision check may be down while the local closeness check still ran.
 const down={step:'qa:1',media_sha256:'a'.repeat(64),status:'unavailable',reason:'CREATIVE_PROVIDER_REJECTED'};
 assert.equal(qaReport(model,expectation,[down],false,'CREATIVE_PROVIDER_REJECTED',{threshold:6,checks:[near('qa:1','a'.repeat(64))]}).verdict,'flag');
 assert.equal(qaReport(model,expectation,[down],false,undefined,{threshold:6,checks:[far('qa:1','a'.repeat(64))]}).verdict,'unavailable');
 // Without stock nothing is added to the report.
 assert.equal('stock_source' in qaReport(model,expectation,[checked],false),false);
 // Notes for the one regeneration say why, with or without a vision finding.
 const stockOnly=qaRetryNotes(null,expectation,true);
 assert.ok(stockOnly.startsWith('\nQUALITY REVIEW OF THE PREVIOUS ATTEMPT'));
 assert.match(stockOnly,/stock photograph/);
 assert.doesNotMatch(stockOnly,/lettering/);
 const both=qaRetryNotes({...good,text_matches:false,found_text:['Fresh cots'],verdict:'retry'},expectation,true);
 assert.ok(both.includes('"Fresh cots"'));assert.match(both,/stock photograph/);
 assert.doesNotMatch(qaRetryNotes({...good,text_matches:false,found_text:['Fresh cots'],verdict:'retry'},expectation),/stock photograph/);
});
