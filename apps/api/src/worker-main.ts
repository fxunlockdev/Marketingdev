import {VideoJobs} from './video-jobs.js';
import {VideoReferences} from './video-references.js';
import {VideoProviderJobs} from './video-provider-jobs.js';
import {VideoRenderer} from './video-renderer.js';
import {VideoDownload} from './video-download.js';
import {HiggsfieldClient,HIGGSFIELD_MODELS} from './higgsfield-client.js';
import {PublicationJobs} from './publication-jobs.js';
import {SocialOAuthJobs} from './social-oauth-jobs.js';
import {SocialJobs,SocialReadRetry} from './social-jobs.js';
import {ExportJobs} from './export-jobs.js';
import {StaticRenderer} from './static-renderer.js';
import {PlanningJobs} from "./planning-jobs.js";
import {CreativeJobs} from './creative-jobs.js';
import {CreativeProvider} from './creative-provider.js';
import {SkillRuntime} from './skill-runtime.js';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Connection,Client} from '@temporalio/client';
import {Context,ApplicationFailure} from '@temporalio/activity';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';
import {workerConfigFromEnv} from './config.js';
import {AssetJobs,JobDispatcher,assertJobRole,type JobScope} from './jobs.js';
import {VisualCrawler} from './visual-crawler.js';
import {IntakeJobs} from './intake-jobs.js';
import {WebsiteParser} from './website-parser.js';
import {BrandAnalyzer} from './brand-analysis.js';
import {DocumentJobs} from './document-jobs.js';
import {DocumentParser} from './document-parser.js';
import {ObjectStore} from './object-store.js';
import {MalwareScanner} from './file-validation.js';
const config=workerConfigFromEnv(),store=new ObjectStore(config.storage);
const pool=new Pool({connectionString:config.jobs.workerDatabaseUrl,max:4,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'});
const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl,max:2,connectionTimeoutMillis:5000});
pool.on('error',()=>{});dispatchPool.on('error',()=>{});
await assertJobRole(pool,'desvio_worker');await assertJobRole(dispatchPool,'desvio_dispatcher');
const connection=await NativeConnection.connect({address:config.jobs.address}),clientConnection=await Connection.connect({address:config.jobs.address});
const jobs=new AssetJobs(pool,store,new MalwareScanner(config.scanner));
const documents=new DocumentJobs(jobs,new DocumentParser(config.documentImage));
const intake=new IntakeJobs(jobs,new WebsiteParser(config.documentImage),new BrandAnalyzer(process.env.OPENAI_API_KEY),undefined,new VisualCrawler(config.documentImage));
const creative=new CreativeJobs(jobs,new SkillRuntime(config.skillImage),new CreativeProvider(process.env.OPENAI_API_KEY));
const planning=new PlanningJobs(jobs,new SkillRuntime(config.skillImage),new CreativeProvider(process.env.OPENAI_API_KEY));
const publication=new PublicationJobs(jobs,config.social,config.renderImage,config.publishingEnabled);
const social=new SocialJobs(jobs,config.social);
const socialOAuth=new SocialOAuthJobs(jobs,config.social,config.oauthEncryptionKey);
const exporter=new ExportJobs(jobs,new StaticRenderer(config.renderImage));
const video=config.video?new VideoJobs(jobs,new VideoReferences(undefined,jobs,config.video.encryptionKey,config.renderImage!,config.video.mode),creative,
 new VideoProviderJobs(jobs,new HiggsfieldClient({mode:config.video.mode,credentials:config.video.credentials,models:[HIGGSFIELD_MODELS.image],referenceOrigins:[new URL(config.storage.endpoint).origin]}),config.video.encryptionKey),
 new VideoDownload(config.video.outputOrigins),new VideoRenderer(config.video.image)):undefined;
const dispatcher=new JobDispatcher(dispatchPool,new Client({connection:clientConnection,namespace:config.jobs.namespace}),config.jobs.taskQueue,config.provisionTaskQueue);
const worker=await Worker.create({connection,namespace:config.jobs.namespace,taskQueue:config.jobs.taskQueue,workflowsPath:fileURLToPath(new URL('./asset-workflow.js',import.meta.url)),
  maxConcurrentActivityTaskExecutions:2,activities:{
    stepVideo:async(scope:JobScope)=>{if(!video)throw ApplicationFailure.nonRetryable('Video generation is not configured','VideoUnavailable');const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await video.step(scope);}catch{throw ApplicationFailure.retryable('Video processing temporarily unavailable','VideoUnavailable');}finally{clearInterval(heartbeat);}},
    failVideo:async(scope:JobScope)=>{if(!video)throw ApplicationFailure.retryable('Video recovery awaits configured worker','VideoUnavailable');return video.exhausted(scope);},
    publishSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await publication.run(scope);}catch(e){throw ApplicationFailure.create({message:'Publication processing unavailable',type:'PublicationUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    reconcileSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await publication.reconcile(scope);}catch(e){throw ApplicationFailure.create({message:'Publication check unavailable',type:'PublicationCheckUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failPublication:async(scope:JobScope)=>publication.fail(scope),
    authorizeSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await socialOAuth.run(scope);}catch(e){throw ApplicationFailure.create({message:'Authorization processing unavailable',type:'SocialAuthorizationUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failSocialOAuth:async(scope:JobScope)=>socialOAuth.fail(scope),
    syncSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await social.run(scope);}catch(e){throw ApplicationFailure.create({message:'Connection check temporarily unavailable',type:'SocialUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failSocial:async(scope:JobScope)=>social.fail(scope),
    exportCreative:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await exporter.run(scope);}catch{throw ApplicationFailure.retryable('Export temporarily unavailable','ExportUnavailable');}finally{clearInterval(heartbeat);}},
    failExport:async(scope:JobScope)=>exporter.fail(scope),
    generatePlan:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await planning.run(scope);}catch{throw ApplicationFailure.retryable("Planning temporarily unavailable","PlanningUnavailable");}finally{clearInterval(heartbeat);}},
    failPlan:async(scope:JobScope)=>planning.fail(scope),
    generateCreative:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await creative.run(scope);}catch{throw ApplicationFailure.retryable("Creative processing temporarily unavailable","CreativeUnavailable");}finally{clearInterval(heartbeat);}},
    failCreative:async(scope:JobScope)=>creative.fail(scope),
    processIntake:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await intake.run(scope);}catch{throw ApplicationFailure.retryable("Intake temporarily unavailable","IntakeUnavailable");}finally{clearInterval(heartbeat);}},
    failIntake:async(scope:JobScope)=>intake.fail(scope),
    extract:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await documents.extract(scope);}catch{throw ApplicationFailure.retryable('Document processing is temporarily unavailable','DocumentProcessingUnavailable');}finally{clearInterval(heartbeat);}},
    failDocument:async(scope:JobScope)=>{try{return await documents.fail(scope);}catch{throw ApplicationFailure.retryable('Unable to save document status','DocumentFinalizationUnavailable');}},
    validate:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await jobs.validate(scope);}catch{throw ApplicationFailure.retryable('Asset validation service is temporarily unavailable','AssetValidationUnavailable');}finally{clearInterval(heartbeat);}},
    fail:async(scope:JobScope)=>{try{return await jobs.fail(scope);}catch{throw ApplicationFailure.retryable('Unable to save validation status','AssetFinalizationUnavailable');}}
  }});
let dispatching=false;
const timer=setInterval(async()=>{if(dispatching)return;dispatching=true;try{await dispatcher.runOnce();}catch{}finally{dispatching=false;}},300);
try{await worker.run();}finally{clearInterval(timer);await connection.close();await clientConnection.close();store.close();await Promise.all([pool.end(),dispatchPool.end()]);}
