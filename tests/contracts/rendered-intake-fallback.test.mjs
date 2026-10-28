import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderedIntakeFallback,renderedTarget} from '../../dist/rendered-intake-fallback.js';
import {IntakeError} from '../../dist/safe-web.js';
const scope={organizationId:'org',brandId:'brand',jobId:'job'};
const output={pages:[{chunks:[{text:'rendered factual website content '.repeat(20)}]}],captures:new Map(),visualErrors:[],coverage:{provider:'maxun'}};
const denied=code=>async()=>{throw new IntakeError(code);};
function fixture({error='AI_RESEARCH_NO_SOURCES',saved=null,allowed=true}={}){
 const calls=[];return {calls,adapter:new RenderedIntakeFallback({capture:async()=>{calls.push('research');if(error)throw new IntakeError(error);return output;}},{capture:async()=>{calls.push('render');return output;}},async()=>{calls.push('reserve');},async()=>{calls.push('preflight');},()=>({load:async()=>saved,permitted:async()=>allowed}))};
}
test('definite no sources invokes one guarded rendered fallback',async()=>{
 const {calls,adapter}=fixture();assert.equal((await adapter.capture({},scope,'https://example.com')).coverage.method,'rendered_provider');assert.deepEqual(calls,['research','preflight','reserve','render']);
});
test('good primary and uncertain/auth failures never cause a second paid provider',async()=>{
 for(const error of [null,'AI_RESEARCH_SUBMISSION_UNKNOWN','AI_PROVIDER_AUTH_FAILED','AI_BUDGET_EXHAUSTED']){
  const {calls,adapter}=fixture({error});if(error)await assert.rejects(adapter.capture({},scope,'https://example.com'),{code:error});else await adapter.capture({},scope,'https://example.com');assert.deepEqual(calls,['research']);
 }
});
test('existing checkpoint bypasses research and new allowance, using durable provider recovery',async()=>{
 const {calls,adapter}=fixture({saved:{phase:'polling',runId:'saved'}});await adapter.capture({},scope,'https://example.com');assert.deepEqual(calls,['render']);
});
test('revocation and budget denial cannot begin capture',async()=>{
 const revoked=fixture({allowed:false});await assert.rejects(revoked.adapter.capture({},scope,'https://example.com'),{code:'ACCESS_REVOKED_OR_CANCELED'});assert.deepEqual(revoked.calls,['research']);
 const budget=fixture();budget.adapter.authorize=denied('AI_BUDGET_EXHAUSTED');await assert.rejects(budget.adapter.capture({},scope,'https://example.com'));assert.ok(!budget.calls.includes('render'));
});
test('robots denial and foreign redirect stop before provider request',async()=>{
 const web={fetch:async u=>({status:200,headers:{'content-type':'text/html'},bytes:Buffer.from(u.pathname==='/robots.txt'?'User-agent: *\nDisallow: /':'<html></html>')})};
 await assert.rejects(renderedTarget('https://example.com',web),{code:'WEBSITE_TEXT_DISALLOWED'});
 const redirect={fetch:async u=>u.pathname==='/robots.txt'?{status:404,headers:{},bytes:Buffer.alloc(0)}:{status:302,headers:{location:'https://foreign.example/'},bytes:Buffer.alloc(0)}};
 await assert.rejects(renderedTarget('https://example.com',redirect),{code:'WEBSITE_TEXT_FOREIGN_REDIRECT'});
});
