// Health probes shared by the supervisor (readiness) and `status`.
import {Connection} from '@temporalio/client';
import {containerState,scannerPing,adminPool,storageClient} from './containers.mjs';
import {HeadBucketCommand} from '@aws-sdk/client-s3';
import {CONTAINERS,BUCKET,TEMPORAL_NAMESPACE,TEMPORAL_TASK_QUEUE} from './config.mjs';

async function http(url,expect=200){
 try{const r=await fetch(url,{signal:AbortSignal.timeout(3000),redirect:'manual'});await r.body?.cancel();return r.status===expect;}catch{return false;}
}
export async function temporalPollers({ports},timeout=3000){
 let connection;
 try{
  connection=await Connection.connect({address:`127.0.0.1:${ports.temporal}`,connectTimeout:timeout});
  const result=await connection.workflowService.describeTaskQueue({namespace:TEMPORAL_NAMESPACE,taskQueue:{name:TEMPORAL_TASK_QUEUE},taskQueueType:1});
  return {up:true,pollers:result.pollers?.length??0};
 }catch{return {up:false,pollers:0};}
 finally{await connection?.close().catch(()=>{});}
}
export const probes={
 postgres:async context=>{const pool=adminPool(context,1);try{await pool.query('SELECT 1');return true;}catch{return false;}finally{await pool.end();}},
 storage:async context=>{const client=storageClient(context);try{await client.send(new HeadBucketCommand({Bucket:BUCKET}),{abortSignal:AbortSignal.timeout(3000)});return true;}catch{return false;}finally{client.destroy();}},
 scanner:context=>scannerPing(context),
 temporal:async context=>(await temporalPollers(context)).up,
 worker:async context=>(await temporalPollers(context)).pollers>0,
 api:({ports})=>http(`http://127.0.0.1:${ports.api}/health`),
 web:({ports})=>http(`http://127.0.0.1:${ports.web}/health`),
 mail:async({ports})=>{const {createConnection}=await import('node:net');return new Promise(r=>{const s=createConnection({host:'127.0.0.1',port:ports.smtp});s.setTimeout(2000,()=>{s.destroy();r(false);});s.on('data',b=>{s.destroy();r(b.toString().startsWith('220'));});s.on('error',()=>r(false));});},
 mock:({ports,mode})=>mode==='mock'?http(`http://127.0.0.1:${ports.mock}/health`):Promise.resolve(null),
};
export async function checkAll(context){
 const entries=await Promise.all(Object.entries(probes).map(async([name,probe])=>[name,await probe(context)]));
 return Object.fromEntries(entries);
}
export function containerSummary(){
 return Object.fromEntries(Object.entries(CONTAINERS).map(([k,name])=>[k,containerState(name)?.Status??'absent']));
}
