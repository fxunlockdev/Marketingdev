import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MailQueue,MailWorker} from '../../dist/mail.js';
const config={mode:'test',smtp:{host:'127.0.0.1',port:1,secure:false,from:'mail@example.test'}};
async function attempt(error,attempts=1){
 let finish;
 const queue={decrypt:()=>({to:'owner@example.test',url:'https://app.example.test/b/test/content-plan'})};
 const db={query:async(sql,args)=>{
  if(sql.includes("SET status='processing'"))return {rows:[{id:'fixture',kind:'generation',attempts}]};
  if(sql.includes('lease_id=$2')){finish=args;return{rowCount:1};}
  return {rows:[],rowCount:0};
 }};
 const worker=new MailWorker(db,queue,config);worker.transport={sendMail:async()=>{if(error)throw error;return{accepted:['owner@example.test'],rejected:[]};},close(){}};
 try{return {result:await worker.runOnce(),finish};}finally{worker.close();}
}
test('generation emails reuse bounded SMTP retries and never retry ambiguous delivery',async()=>{
 assert.equal((await attempt({responseCode:451},1)).result.status,'retry');
 assert.equal((await attempt({responseCode:451},5)).result.status,'failed');
 assert.equal((await attempt({responseCode:550})).result.status,'failed');
 assert.equal((await attempt({code:'ETIMEDOUT'})).result.status,'unknown');
 assert.equal((await attempt(null)).result.status,'accepted');
});
test('generation queue refuses external links and encrypts payload with fixed waiting state',async()=>{
 const queue=new MailQueue('https://app.example.test','ab'.repeat(32));let values;
 const db={query:async(sql,args)=>{values=args;return{rows:[{id:args[0]}]};}};
 await assert.rejects(queue.enqueue(db,'generation',{to:'owner@example.test',url:'https://other.example.test/edit'},new Date(),'org','user',true),/configured app origin/);
 await assert.rejects(queue.enqueue(db,'verify',{to:'owner@example.test',url:'https://app.example.test/edit'},new Date(),undefined,undefined,true),/Only generation/);
 await queue.enqueue(db,'generation',{to:'owner@example.test',url:'https://app.example.test/edit'},new Date(),'org','user',true);
 assert.equal(values[7],'waiting_generation');assert.ok(!values[5].includes(Buffer.from('owner@example.test')));
 assert.equal(queue.decrypt({id:values[0],kind:'generation',organization_id:'org',encrypted_payload:values[5]}).to,'owner@example.test');
 assert.throws(()=>queue.decrypt({id:values[0],kind:'invite',organization_id:'org',encrypted_payload:values[5]}));
});
