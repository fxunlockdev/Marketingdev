import test from 'node:test';
import assert from 'node:assert/strict';
import {HiggsfieldImageClient,HIGGSFIELD_IMAGE_MODEL} from '../../dist/higgsfield-image-client.js';
const id='3c90c3cc-0d44-4b50-8888-8dd25736052a';
const input={model:HIGGSFIELD_IMAGE_MODEL,idempotencyKey:id,prompt:'MOCK background',aspect:'9:16'};
test('Higgsfield still adapter uses exact image schema, bounded authenticated request and status image',async()=>{
 const calls=[];const client=new HiggsfieldImageClient({mode:'test',credentials:'MOCK-key'},async(url,init)=>{calls.push({url:String(url),init});return Response.json(String(url).includes('/estimate/')?{usd:'0.0057'}:String(url).endsWith('/status')?{request_id:id,status:'completed',images:[{url:'https://media.example/image.png'}]}:{request_id:id,status:'queued'});});
 const p=client.prepare(input);assert.deepEqual(JSON.parse(p.body),{prompt:input.prompt,aspect_ratio:'9:16',resolution:'1080p',batch_size:1,enhance_prompt:false});assert.equal(await client.estimate(input),5700);await client.submit(input,p.sha256);assert.equal((await client.status(id)).imageURL,'https://media.example/image.png');
 for(const c of calls){assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert.equal(c.init.headers.Authorization,'Key MOCK-key');assert.equal(new URL(c.url).origin,'https://api.higgsfield.ai');}
 assert.equal(calls[1].init.headers['Idempotency-Key'],id);
});
test('Higgsfield still adapter rejects extra inputs, malformed image output and unbounded estimates',async()=>{
 const client=new HiggsfieldImageClient({mode:'test',credentials:'MOCK-key'},async()=>Response.json({request_id:id,status:'completed',images:[{url:'http://127.0.0.1/image.png'}]}));
 assert.throws(()=>client.prepare({...input,referenceURL:'https://example.com'}));assert.throws(()=>client.prepare({...input,aspect:'auto'}));await assert.rejects(client.submit(input,'0'.repeat(64)),/REPLAY/);await assert.rejects(client.status(id),/RESPONSE/);
 const malformed=new HiggsfieldImageClient({mode:'test',credentials:'MOCK-key'},async()=>Response.json(null));await assert.rejects(malformed.estimate(input),e=>e.code==='HIGGSFIELD_ESTIMATE_INVALID');
 const huge=new HiggsfieldImageClient({mode:'test',credentials:'MOCK-key'},async()=>Response.json({usd:'999999999999999999'}));await assert.rejects(huge.estimate(input),/ESTIMATE/);
});
test('Higgsfield still adapter never automatically retries an ambiguous generation',async()=>{
 let calls=0;const client=new HiggsfieldImageClient({mode:'test',credentials:'MOCK-key'},async()=>{calls++;throw new Error('fixture failure');});await assert.rejects(client.submit(input,client.prepare(input).sha256),e=>e.outcome==='unknown');assert.equal(calls,1);
});
