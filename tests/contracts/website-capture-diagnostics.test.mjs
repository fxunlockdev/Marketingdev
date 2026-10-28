import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRenderedCapture} from '../../dist/website-renderer.js';
test('empty capture retains only bounded fixed diagnostic codes, never page error text',async()=>{
 const raw={version:'website-renderer-v1',pages:[],failures:[{page:0,code:'DOM_LOAD_TIMEOUT',message:'private detail',url:'https://secret.invalid'},{page:4,code:'SCREENSHOT_FAILED'},{page:0,code:'arbitrary source text'},{page:1,code:'DOCUMENT_CHANGED'}]};
 await assert.rejects(normalizeRenderedCapture(raw,'https://example.com/',{}),error=>{
  assert.equal(error.code,'AI_RESEARCH_NO_SOURCES');assert.deepEqual(error.captureDiagnostics,[{page:0,code:'DOM_LOAD_TIMEOUT'},{page:1,code:'DOCUMENT_CHANGED'}]);return true;
 });
});

test('partial capture keeps text but never fabricates screenshots or accepts unbrokered photos',async()=>{
 const url='https://example.com/',entry={url,text:'Authentic fetched brand information. '.repeat(10),images:[{url:'https://example.com/unfetched.jpg'}],links:[]};
 const broker={documents:new Set([url]),images:new Map(),requests:1};
 const raw={version:'website-renderer-v1',pages:[entry],failures:[{page:0,code:'SCREENSHOT_FAILED'}]};
 const result=await normalizeRenderedCapture(raw,url,broker);
 assert.equal(result.pages.length,1);assert.equal(result.coverage.screenshotsAvailable,false);assert.equal(result.coverage.photosAvailable,0);assert.equal(result.captures.size,0);
 for(const screenshot of [null,{},42])await assert.rejects(normalizeRenderedCapture({...raw,pages:[{...entry,screenshot}]},url,broker),{code:'WEBSITE_RENDER_OUTPUT_INVALID'});
 await assert.rejects(normalizeRenderedCapture({...raw,pages:[{...entry,screenshot:'invalid'}]},url,broker));
});
