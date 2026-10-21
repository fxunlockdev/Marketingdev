import {Worker,NativeConnection} from '@temporalio/worker';
import {Connection,Client} from '@temporalio/client';
import {Context,ApplicationFailure} from '@temporalio/activity';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';
import {workerConfigFromEnv} from './config.js';
import {AssetJobs,JobDispatcher,assertJobRole,type JobScope} from './jobs.js';
import {ObjectStore} from './object-store.js';
import {MalwareScanner} from './file-validation.js';
const config=workerConfigFromEnv(),store=new ObjectStore(config.storage);
const pool=new Pool({connectionString:config.jobs.workerDatabaseUrl,max:4,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'});
const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl,max:2,connectionTimeoutMillis:5000});
pool.on('error',()=>{});dispatchPool.on('error',()=>{});
await assertJobRole(pool,'desvio_worker');await assertJobRole(dispatchPool,'desvio_dispatcher');
const connection=await NativeConnection.connect({address:config.jobs.address}),clientConnection=await Connection.connect({address:config.jobs.address});
const jobs=new AssetJobs(pool,store,new MalwareScanner(config.scanner));
const dispatcher=new JobDispatcher(dispatchPool,new Client({connection:clientConnection,namespace:config.jobs.namespace}),config.jobs.taskQueue);
const worker=await Worker.create({connection,namespace:config.jobs.namespace,taskQueue:config.jobs.taskQueue,workflowsPath:fileURLToPath(new URL('./asset-workflow.js',import.meta.url)),
  maxConcurrentActivityTaskExecutions:2,activities:{
    validate:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await jobs.validate(scope);}catch{throw ApplicationFailure.retryable('Asset validation service is temporarily unavailable','AssetValidationUnavailable');}finally{clearInterval(heartbeat);}},
    fail:async(scope:JobScope)=>{try{return await jobs.fail(scope);}catch{throw ApplicationFailure.retryable('Unable to save validation status','AssetFinalizationUnavailable');}}
  }});
let dispatching=false;
const timer=setInterval(async()=>{if(dispatching)return;dispatching=true;try{await dispatcher.runOnce();}catch{}finally{dispatching=false;}},300);
try{await worker.run();}finally{clearInterval(timer);await connection.close();await clientConnection.close();store.close();await Promise.all([pool.end(),dispatchPool.end()]);}
