import test from 'node:test';import assert from 'node:assert/strict';
import {RenderedWebsiteResearch} from '../../dist/rendered-website-research.js';
import {IntakeError} from '../../dist/safe-web.js';
const good={pages:[],captures:new Map(),visualErrors:[],coverage:{photosAvailable:1}};
test('the local renderer reads the site beside GPT research; its failure never hides usable GPT pages',async()=>{
 for(const configured of [true,false]){let calls=0;const adapter=new RenderedWebsiteResearch({capture:async()=>good},{configured,capture:async()=>{calls++;throw new Error();}});assert.equal(await adapter.capture({}, {},'url'),good);assert.equal(calls,configured?1:0);}
});
test('either reader is enough: rendered pages carry the capture when GPT research has none or an uncertain outcome',async()=>{
 const rendered={pages:[{url:'https://site.test/',chunks:[]}],captures:new Map(),visualErrors:[],coverage:{photosAvailable:0}};
 for(const code of ['AI_RESEARCH_NO_SOURCES','AI_RESEARCH_SUBMISSION_UNKNOWN']){let calls=0;const adapter=new RenderedWebsiteResearch({capture:async()=>{throw new IntakeError(code);}},{configured:true,capture:async()=>{calls++;return rendered;}});assert.equal(await adapter.capture({}, {},'url'),rendered);assert.equal(calls,1);}
 const neither=new RenderedWebsiteResearch({capture:async()=>{throw new IntakeError('AI_RESEARCH_NO_SOURCES');}},{configured:true,capture:async()=>{throw new IntakeError('WEBSITE_RENDER_FAILED');}});
 await assert.rejects(neither.capture({}, {},'url'),{code:'AI_RESEARCH_NO_SOURCES'});
 const revoked=new RenderedWebsiteResearch({capture:async()=>good},{configured:true,capture:async()=>{throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');}});
 await assert.rejects(revoked.capture({}, {},'url'),{code:'ACCESS_REVOKED_OR_CANCELED'});
});
