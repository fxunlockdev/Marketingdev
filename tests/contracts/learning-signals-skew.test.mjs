import test from 'node:test';
import assert from 'node:assert/strict';
import {summariseSignals} from '../../dist/learning-signals.js';

const row=(offsetMs,reason)=>({kind:'rejected',reason,diff:{},context:{},created_at:new Date(Date.UTC(2026,10,12,12,0,0)+offsetMs)});
const now=new Date(Date.UTC(2026,10,12,12,0,0));

test('signals stamped slightly ahead by the database clock still count',()=>{
  const statements=summariseSignals([row(90_000,'Too many people'),row(120_000,'No faces please')],now).map(s=>s.statement);
  assert.deepEqual(statements,['Rejection reasons mention people: 2 of 2 rejections with a reason']);
});

test('signals far in the future are still ignored',()=>{
  assert.deepEqual(summariseSignals([row(3_600_000,'Too many people'),row(3_600_000,'No faces please')],now),[]);
});
