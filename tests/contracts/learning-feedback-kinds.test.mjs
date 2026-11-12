import test from 'node:test';
import assert from 'node:assert/strict';
import {summariseSignals} from '../../dist/learning-signals.js';

const now=new Date(Date.UTC(2026,10,12,12,0,0));
const row=(kind,reason='',minutesAgo=10)=>({kind,reason,diff:{},context:{},created_at:new Date(now.getTime()-minutesAgo*60000)});

test('change requests with feedback become a preference statement',()=>{
  const statements=summariseSignals([row('changes_requested','Use brighter colours'),row('changes_requested','Colours feel too dark'),row('approved')],now).map(s=>s.statement);
  assert.ok(statements.includes('Change requests mention colour: 2 of 2 change requests with feedback'),JSON.stringify(statements));
});

test('asking for changes instead of approving is counted like regeneration',()=>{
  const statements=summariseSignals([row('changes_requested','x'),row('changes_requested','y'),row('approved')],now).map(s=>s.statement);
  assert.ok(statements.includes('Asks for changes instead of approving: 2 of 3 change requests and approvals'),JSON.stringify(statements));
});

test('retries after a failure are not treated as a taste preference',()=>{
  assert.deepEqual(summariseSignals([row('retried'),row('retried'),row('retried')],now),[]);
});

test('existing rejection statements are unchanged',()=>{
  const statements=summariseSignals([row('rejected','Too many people'),row('rejected','No faces please')],now).map(s=>s.statement);
  assert.deepEqual(statements,['Rejection reasons mention people: 2 of 2 rejections with a reason']);
});
