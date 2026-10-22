// Separate worker entry point: never load the enterprise signing secret into
// the customer API, ingestion/model worker, browser or untrusted skill runtime.
import {Worker,NativeConnection} from '@temporalio/worker';
import {Context,ApplicationFailure} from '@temporalio/activity';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';
import {AssetJobs,assertJobRole,type JobScope} from './jobs.js';
import {SocialProvisioningJobs} from './social-provisioning-jobs.js';
import {SocialReadRetry} from './social-jobs.js';
import {provisionerConfigFromEnv} from './config.js';
const config=provisionerConfigFromEnv(),pool=new Pool({connectionString:config.databaseUrl,max:2,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'});
pool.on('error',()=>{});await assertJobRole(pool,'desvio_provisioner');
const jobs=new AssetJobs(pool,null as never,null as never),handler=new SocialProvisioningJobs(jobs,config.provider),connection=await NativeConnection.connect({address:config.address});
const worker=await Worker.create({connection,namespace:config.namespace,taskQueue:config.taskQueue,workflowsPath:fileURLToPath(new URL('./provisioning-workflow.js',import.meta.url)),maxConcurrentActivityTaskExecutions:1,activities:{
 provisionSocial:async(scope:JobScope)=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await handler.run(scope);}catch(e){throw ApplicationFailure.create({message:'Account setup temporarily unavailable',type:'ProvisioningUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(timer);}},
 failProvisionSocial:(scope:JobScope)=>handler.fail(scope)
}});
try{await worker.run();}finally{await connection.close();await pool.end();}
