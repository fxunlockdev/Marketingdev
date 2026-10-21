// Wire-contract probes against pinned SDKs. Every response below is MOCKED.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import OpenAI, { toFile } from 'openai';
import { createHiggsfieldClient } from '@higgsfield/client/v2';

test('OpenAI generate: exact route, request serialization, base64 response', async () => {
  let captured;
  const sdk = new OpenAI({ apiKey: 'audit-fixture-only', maxRetries: 0, fetch: async (url, init) => {
    captured = {url: String(url), init};
    return Response.json({created: 1, data: [{b64_json: 'TU9DSw=='}]});
  }});
  const result = await sdk.images.generate({model: 'configured-model', prompt: 'MOCK contract', n: 1});
  assert.equal(new URL(captured.url).pathname, '/v1/images/generations');
  assert.equal(JSON.parse(captured.init.body).prompt, 'MOCK contract');
  assert.equal(result.data[0].b64_json, 'TU9DSw==');
});

test('OpenAI edit uses multipart image and prompt', async () => {
  const sdk = new OpenAI({apiKey:'audit-fixture-only', maxRetries:0, fetch:async (url, init) => {
    assert.equal(new URL(url).pathname, '/v1/images/edits');
    assert.equal(init.body.get('prompt'), 'MOCK edit');
    assert.equal(init.body.get('image').name, 'fixture.png');
    return Response.json({created:1,data:[{b64_json:'TU9DSw=='}]});
  }});
  await sdk.images.edit({model:'configured-model',prompt:'MOCK edit',image:await toFile(Buffer.from('MOCK'), 'fixture.png', {type:'image/png'})});
});

for (const status of [401, 403, 429, 500]) {
  test(`OpenAI ${status} surfaces error without paid-call retry`, async () => {
    let calls=0;
    const sdk=new OpenAI({apiKey:'audit-fixture-only',maxRetries:0,fetch:async()=>{calls++;return Response.json({error:{message:'MOCK failure'}},{status});}});
    await assert.rejects(sdk.images.generate({prompt:'MOCK',model:'configured-model'}), e=>e.status===status);
    assert.equal(calls,1);
  });
}

test('OpenAI ambiguous network failure is not automatically resubmitted', async () => {
  let calls=0;
  const sdk=new OpenAI({apiKey:'audit-fixture-only',maxRetries:0,fetch:async()=>{calls++;throw new TypeError('MOCK network lost');}});
  await assert.rejects(sdk.images.generate({prompt:'MOCK',model:'configured-model'}));
  assert.equal(calls,1);
});

test('Higgsfield V2 submit exposes remote ID without automatic polling', async () => {
  let calls=0;
  const server=http.createServer(async(req,res)=>{
    calls++;
    assert.equal(req.method,'POST');
    assert.equal(req.url,'/higgsfield/genjutsu/motion-transfer/v1.0');
    assert.equal(req.headers.authorization,'Key fixture:fixture');
    let raw=''; for await(const chunk of req) raw+=chunk;
    assert.deepEqual(JSON.parse(raw),{video_url:'https://example.invalid/test.mp4',image_urls:['https://example.invalid/test.png']});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'queued',request_id:'MOCK-request',status_url:'https://api.higgsfield.ai/requests/MOCK-request/status',cancel_url:'https://api.higgsfield.ai/requests/MOCK-request/cancel'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const client=createHiggsfieldClient({credentials:'fixture:fixture',baseURL:`http://127.0.0.1:${server.address().port}`,maxRetries:0});
    const result=await client.subscribe('higgsfield/genjutsu/motion-transfer/v1.0',{withPolling:false,input:{video_url:'https://example.invalid/test.mp4',image_urls:['https://example.invalid/test.png']}});
    assert.equal(result.request_id,'MOCK-request');
    assert.equal(calls,1);
    assert.equal(client.getStatus,undefined); // Do not invent an SDK method.
  } finally {await new Promise(resolve=>server.close(resolve));}
});
