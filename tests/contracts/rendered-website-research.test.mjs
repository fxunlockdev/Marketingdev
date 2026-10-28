import test from 'node:test';import assert from 'node:assert/strict';
import {RenderedWebsiteResearch} from '../../dist/rendered-website-research.js';
import {IntakeError} from '../../dist/safe-web.js';
const good={pages:[],captures:new Map(),visualErrors:[],coverage:{photosAvailable:1}};
test('local render does not run when images exist or configuration absent',async()=>{
 for(const configured of [true,false]){let calls=0;const adapter=new RenderedWebsiteResearch({capture:async()=>good},{configured,capture:async()=>{calls++;throw new Error();}});assert.equal(await adapter.capture({}, {},'url'),good);assert.equal(calls,0);}
});
test('definite no sources or missing images invokes local renderer; unknown research never does',async()=>{
 for(const code of ['AI_RESEARCH_NO_SOURCES','AI_RESEARCH_SUBMISSION_UNKNOWN']){let calls=0;const adapter=new RenderedWebsiteResearch({capture:async()=>{throw new IntakeError(code);}},{configured:true,capture:async()=>{calls++;return good;}});if(code==='AI_RESEARCH_NO_SOURCES')assert.equal(await adapter.capture({}, {},'url'),good);else await assert.rejects(adapter.capture({}, {},'url'),{code});assert.equal(calls,code==='AI_RESEARCH_NO_SOURCES'?1:0);}
});
