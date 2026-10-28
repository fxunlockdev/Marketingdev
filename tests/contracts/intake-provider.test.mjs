import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IntakeJobs} from '../../dist/intake-jobs.js';

test('website jobs require a configured research provider and never fall back to a local crawler',async()=>{
 const jobs={transaction:async(_scope,fn)=>fn({query:async()=>({rows:[{website_url:'https://example.org/'}]})},{id:'capture'})};
 await assert.rejects(new IntakeJobs(jobs,{}).crawl({}),error=>error.code==='AI_NOT_CONFIGURED');
});
test('website capture passes the stored tenant job and URL to the configured provider',async()=>{
 const scope={organizationId:'org',brandId:'brand',jobId:'job'};
 const jobs={transaction:async(s,fn)=>{assert.equal(s,scope);return fn({query:async()=>({rows:[{website_url:'https://example.org/'}]})},{id:'job'});}};
 const stop=new Error('provider call observed');let calls=0;
 const handler=new IntakeJobs(jobs,{}, {capture:async(j,s,url)=>{calls++;assert.equal(j,jobs);assert.equal(s,scope);assert.equal(url,'https://example.org/');throw stop;}});
 await assert.rejects(handler.crawl(scope),error=>error===stop);assert.equal(calls,1);
});
