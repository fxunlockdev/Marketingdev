import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConflictException,ServiceUnavailableException} from '@nestjs/common';
import {ChatActionWorker} from '../../dist/chat-action-worker.js';

function queue(rows){
 const calls=[];
 return {calls,query:async(sql,params=[])=>{calls.push({sql,params});return sql.startsWith('SELECT')?{rows}:{rows:[],rowCount:1};}};
}
test('a refused chat action keeps the customer-facing reason; a temporary failure retries without one',async()=>{
 const refused=queue([{job_id:'j1',brand_id:'b',actor_id:'a',attempts:0}]);
 await new ChatActionWorker(refused,{execute:async()=>{throw new ConflictException('Your monthly carousel allowance is used.');}}).runOnce();
 const update=refused.calls.find(c=>c.sql.startsWith('UPDATE'));
 assert.deepEqual(update.params,['j1',true,'CHAT_ACTION_NEEDS_ATTENTION','Your monthly carousel allowance is used.']);
 assert.match(update.sql,/error_message=\$4/);
 const temporary=queue([{job_id:'j2',brand_id:'b',actor_id:'a',attempts:0}]);
 await new ChatActionWorker(temporary,{execute:async()=>{throw new ServiceUnavailableException('database said something internal');}}).runOnce();
 assert.deepEqual(temporary.calls.find(c=>c.sql.startsWith('UPDATE')).params,['j2',false,'CHAT_ACTION_TEMPORARILY_UNAVAILABLE',null]);
 const unexpected=queue([{job_id:'j3',brand_id:'b',actor_id:'a',attempts:0}]);
 await new ChatActionWorker(unexpected,{execute:async()=>{throw new Error('secret connection string');}}).runOnce();
 assert.equal(unexpected.calls.find(c=>c.sql.startsWith('UPDATE')).params[3],null,'internal errors never reach the customer');
 const long=queue([{job_id:'j4',brand_id:'b',actor_id:'a',attempts:0}]);
 await new ChatActionWorker(long,{execute:async()=>{throw new ConflictException('x'.repeat(500));}}).runOnce();
 assert.equal(long.calls.find(c=>c.sql.startsWith('UPDATE')).params[3].length,300);
});
