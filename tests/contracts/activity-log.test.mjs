import test from 'node:test';
import assert from 'node:assert/strict';
import {describeFailure,logActivityFailure} from '../../dist/activity-log.js';

const scope={jobId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',brandId:'33333333-3333-4333-8333-333333333333'};

test('keeps the error name, code and where it was thrown',()=>{
  const error=Object.assign(new TypeError('Cannot read properties of undefined'),{code:'42P01'});
  const entry=describeFailure('intake',scope,error);
  assert.equal(entry.event,'activity_failed');
  assert.equal(entry.activity,'intake');
  assert.equal(entry.job_id,scope.jobId);
  assert.equal(entry.error_name,'TypeError');
  assert.equal(entry.error_code,'42P01');
  assert.match(entry.message,/Cannot read properties/);
  assert.ok(Array.isArray(entry.stack)&&entry.stack.length>0&&entry.stack.length<=6);
});

test('redacts credentials from messages and stack frames',()=>{
  const secret='sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const error=new Error(`request failed Authorization: Bearer ${secret} at postgresql://desvio_worker:hunter2secret@db.internal:5432/app?x=1 key=${secret}`);
  const text=JSON.stringify(describeFailure('creative',scope,error));
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('hunter2secret'));
  assert.match(text,/\[redacted\]/);
});

test('bounds message size and tolerates non-Error values',()=>{
  const long=describeFailure('planning',scope,new Error('x'.repeat(5000)));
  assert.ok(long.message.length<=500);
  const odd=describeFailure('planning',scope,'plain string failure');
  assert.equal(odd.error_name,'NonError');
  assert.equal(odd.message,'plain string failure');
  assert.equal(describeFailure('planning',scope,undefined).message,'undefined');
});

test('writes exactly one JSON line and never throws',()=>{
  const lines=[];
  logActivityFailure('intake',scope,new Error('boom'),line=>lines.push(line));
  assert.equal(lines.length,1);
  assert.equal(JSON.parse(lines[0]).activity,'intake');
  assert.doesNotThrow(()=>logActivityFailure('intake',scope,new Error('boom'),()=>{throw new Error('sink down');}));
});
