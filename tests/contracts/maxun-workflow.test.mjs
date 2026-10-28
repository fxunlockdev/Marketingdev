import {IntakeError} from '../../dist/safe-web.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {MaxunWorkflow} from '../../dist/maxun-workflow.js';
const scope={organizationId:'org',brandId:'brand',jobId:'job'};
function journal(initial=null){let state=initial;return {load:async()=>state,permitted:async()=>true,replace:async(expected,next)=>{if(JSON.stringify(expected)!==JSON.stringify(state))return false;state=next;return true;}};}
function provider(){const calls=[];return {calls,recoverRobot:async()=>null,recoverRun:async()=>null,createCrawl:async()=>{calls.push('create');return{id:'robot'};},execute:async()=>{calls.push('execute');return{robotId:'robot',runId:'run'};},status:async()=>{calls.push('status');return{status:'success',output:{crawlData:[]},media:[],partial:false};},cancel:async()=>{calls.push('cancel');}};}
test('Maxun durable checkpoints precede external side effects and replay only polls (MOCK provider)',async()=>{
 const j=journal(),p=provider(),w=new MaxunWorkflow(p,async()=>{});
 const create=p.createCrawl;p.createCrawl=async()=>{assert.equal((await j.load()).phase,'creating');return create();};
 const execute=p.execute;p.execute=async()=>{assert.equal((await j.load()).phase,'submitting');return execute();};
 await w.capture(scope,'https://example.com',j);await w.capture(scope,'https://example.com',j);
 assert.deepEqual(p.calls,['create','execute','status','status']);
});
test('ambiguous submissions never duplicate a paid run on replay',async()=>{
 const p=provider(),j=journal();p.execute=async()=>{p.calls.push('execute');throw Error('network timeout');};const w=new MaxunWorkflow(p);
 await assert.rejects(w.capture(scope,'https://example.com',j));
 await assert.rejects(w.capture(scope,'https://example.com',j),/MAXUN_SUBMISSION_UNKNOWN/);
 assert.deepEqual(p.calls,['create','execute']);
});
test('concurrent claimant cannot create or execute another run',async()=>{
 const p=provider(),j=journal();j.replace=async()=>false;
 await assert.rejects(new MaxunWorkflow(p).capture(scope,'https://example.com',j),/MAXUN_SUBMISSION_UNKNOWN/);
 assert.deepEqual(p.calls,[]);
});
test('access revocation cancels the already submitted run and prevents further polling',async()=>{
 const p=provider(),j=journal({phase:'polling',robotId:'robot',runId:'run'});let checks=0;j.permitted=async()=>++checks===1;
 await assert.rejects(new MaxunWorkflow(p).capture(scope,'https://example.com',j),/ACCESS_REVOKED/);
 assert.deepEqual(p.calls,['cancel']);
});
test('poll timeout preserves durable IDs for a later retry',async()=>{
 const p=provider(),j=journal({phase:'polling',robotId:'robot',runId:'run'});p.status=async()=>{p.calls.push('status');return{status:'running'};};
 await assert.rejects(new MaxunWorkflow(p,async()=>{}).capture(scope,'https://example.com',j),/MAXUN_POLL_DEADLINE/);
 assert.equal(p.calls.length,120);assert.ok(p.calls.every(x=>x==='status'));assert.equal((await j.load()).runId,'run');
});

test('lost create response resolves the exact robot without recreating it',async()=>{
 const p=provider(),j=journal();p.createCrawl=async()=>{p.calls.push('create');throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');};
 p.recoverRobot=async()=>{p.calls.push('recoverRobot');return{id:'robot'};};
 await new MaxunWorkflow(p,async()=>{}).capture(scope,'https://example.com',j);
 assert.deepEqual(p.calls,['create','recoverRobot','execute','status']);
});
test('lost paid submission response resumes its one existing run without another execute',async()=>{
 const p=provider(),j=journal();p.execute=async()=>{p.calls.push('execute');throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');};
 p.recoverRun=async(id,time)=>{assert.equal(id,'robot');assert.ok(Number.isFinite(Date.parse(time)));p.calls.push('recoverRun');return{robotId:id,runId:'run'};};
 const w=new MaxunWorkflow(p,async()=>{});await w.capture(scope,'https://example.com',j);await w.capture(scope,'https://example.com',j);
 assert.deepEqual(p.calls,['create','execute','recoverRun','status','status']);
});
test('unresolved and malformed reconciliation keep the paid submission unknown',async()=>{
 for(const read of [async()=>null,async()=>{throw new IntakeError('MAXUN_RESPONSE_INVALID');}]){
  const p=provider(),j=journal({phase:'submitting',robotId:'robot',submittedAt:new Date().toISOString()});p.recoverRun=read;
  await assert.rejects(new MaxunWorkflow(p,async()=>{}).capture(scope,'https://example.com',j),/MAXUN_SUBMISSION_UNKNOWN/);
  assert.deepEqual(p.calls,[]);assert.equal((await j.load()).phase,'submitting');
 }
});
test('legacy submission checkpoints without timestamps are held without guessing',async()=>{
 const p=provider();p.recoverRun=async()=>{throw Error('must not lookup');};
 await assert.rejects(new MaxunWorkflow(p).capture(scope,'https://example.com',journal({phase:'submitting',robotId:'robot'})),/MAXUN_SUBMISSION_UNKNOWN/);
 assert.deepEqual(p.calls,[]);
});

test('read-only recovery never creates, executes or cancels provider work',async()=>{
 const p=provider(),j=journal({phase:'polling',robotId:'robot',runId:'run',recoveryOnly:true});let checks=0;j.permitted=async()=>++checks===1;
 await assert.rejects(new MaxunWorkflow(p).capture(scope,'https://example.com',j),/ACCESS_REVOKED/);assert.deepEqual(p.calls,[]);
 for(const phase of ['creating','created'])await assert.rejects(new MaxunWorkflow(p).capture(scope,'https://example.com',journal({phase,robotId:'robot',recoveryOnly:true})),/MAXUN_SUBMISSION_UNKNOWN/);
 assert.deepEqual(p.calls,[]);
});
