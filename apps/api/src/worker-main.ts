import {StockAssets} from './stock-assets.js';
import {logActivityFailure} from './activity-log.js';
import {VecteezyClient} from './vecteezy-client.js';
import {HiggsfieldReplacementJobs} from './higgsfield-replacement-jobs.js';
import {HiggsfieldImageClient} from './higgsfield-image-client.js';
import {ImageReplacementVault} from './image-replacement-vault.js';
import {WebsiteRenderer} from './website-renderer.js';
import {RenderedWebsiteResearch} from './rendered-website-research.js';
import {WebsitePhotos} from './website-photos.js';
import {CarouselJobs} from './carousel-jobs.js';
import {InsightJobs} from './insight-jobs.js';
import {GeminiPlanner} from './gemini-planner.js';
import {VideoJobs} from './video-jobs.js';
import {VideoReferences} from './video-references.js';
import {VideoProviderJobs} from './video-provider-jobs.js';
import {VideoRenderer} from './video-renderer.js';
import {VideoDownload} from './video-download.js';
import {RunwayClient} from './runway-client.js';
import {PublicationJobs} from './publication-jobs.js';
import {SocialOAuthJobs} from './social-oauth-jobs.js';
import {SocialJobs,SocialReadRetry} from './social-jobs.js';
import {ExportJobs} from './export-jobs.js';
import {StaticRenderer} from './static-renderer.js';
import {PlanningJobs} from "./planning-jobs.js";
import {CreativeJobs} from './creative-jobs.js';
import {CreativeProvider} from './creative-provider.js';
import {ImageQa} from './image-qa.js';
import {PostformeClient} from './postforme-client.js';
import {learningSyncTick,LEARNING_SYNC_INTERVAL_MS} from './learning-schedule.js';
import {SkillRuntime} from './skill-runtime.js';
import {BlogJobs} from './blog-jobs.js';
import {Worker,NativeConnection} from '@temporalio/worker';
import {Connection,Client} from '@temporalio/client';
import {Context,ApplicationFailure} from '@temporalio/activity';
import {Pool} from 'pg';
import {fileURLToPath} from 'node:url';
import {workerConfigFromEnv} from './config.js';
import {AssetJobs,JobDispatcher,assertJobRole,type JobScope} from './jobs.js';
import {OpenAIWebsiteResearch} from './openai-website-research.js';
import {IntakeJobs} from './intake-jobs.js';
import {ResearchKnowledge,KnowledgeExtractor} from './knowledge-research.js';

import {BrandAnalyzer} from './brand-analysis.js';
import {DocumentJobs} from './document-jobs.js';
import {DocumentParser} from './document-parser.js';
import {ObjectStore} from './object-store.js';
import {s3PreviewPersistence} from './media-storage.js';
import {MalwareScanner} from './file-validation.js';
const config=workerConfigFromEnv(),store=new ObjectStore(config.storage);
store.previews.persistTo(s3PreviewPersistence(store.client,config.storage.bucket),error=>logActivityFailure('PreviewStorage',{jobId:'worker-previews'},error));
const pool=new Pool({connectionString:config.jobs.workerDatabaseUrl,max:4,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'});
const dispatchPool=new Pool({connectionString:config.jobs.dispatcherDatabaseUrl,max:2,connectionTimeoutMillis:5000});
pool.on('error',()=>{});dispatchPool.on('error',()=>{});
await assertJobRole(pool,'desvio_worker');await assertJobRole(dispatchPool,'desvio_dispatcher');
const connection=await NativeConnection.connect({address:config.jobs.address}),clientConnection=await Connection.connect({address:config.jobs.address});
const jobs=new AssetJobs(pool,store,new MalwareScanner(config.scanner));
const documents=new DocumentJobs(jobs,new DocumentParser(config.documentImage));
// Research and analysis feed the knowledge graph afterwards; extraction never changes a job's outcome.
const intake=new IntakeJobs(jobs,new BrandAnalyzer(process.env.OPENAI_API_KEY),new RenderedWebsiteResearch(new OpenAIWebsiteResearch(process.env.OPENAI_API_KEY,undefined,new WebsitePhotos()),new WebsiteRenderer(config.websiteRenderImage)),new ResearchKnowledge(jobs,new KnowledgeExtractor(process.env.OPENAI_API_KEY)));
const imageReplacements=config.higgsfieldImages?new HiggsfieldReplacementJobs(jobs,new HiggsfieldImageClient(config.higgsfieldImages),new ImageReplacementVault(config.higgsfieldImages.encryptionKey)):undefined;
const creativeProvider=new CreativeProvider(process.env.OPENAI_API_KEY);
// The vision check shares the creative provider; it is optional per image and never fails a creative.
const creative=new CreativeJobs(jobs,new SkillRuntime(config.skillImage),creativeProvider,new GeminiPlanner(process.env.GEMINI_API_KEY),process.env.VECTEEZY_API_KEY?new StockAssets(jobs,new VecteezyClient(process.env.VECTEEZY_API_KEY,Number(process.env.VECTEEZY_ACCOUNT_ID))):undefined,new ImageQa(creativeProvider));
const planning=new PlanningJobs(jobs,new SkillRuntime(config.skillImage),new CreativeProvider(process.env.OPENAI_API_KEY),new GeminiPlanner(process.env.GEMINI_API_KEY));
// Blog articles run here, through the skills harness; the API only enqueues them and holds no model key.
const blogs=new BlogJobs(jobs,new SkillRuntime(config.skillImage),new CreativeProvider(process.env.OPENAI_API_KEY));
const insights=new InsightJobs(jobs,new SkillRuntime(config.skillImage),new CreativeProvider(process.env.OPENAI_API_KEY),new GeminiPlanner(process.env.GEMINI_API_KEY));
const publication=new PublicationJobs(jobs,config.social,config.renderImage,config.publishingEnabled,config.videoRenderImage);
const social=new SocialJobs(jobs,config.social);
const socialOAuth=new SocialOAuthJobs(jobs,config.social,config.oauthEncryptionKey);
const exporter=new ExportJobs(jobs,new StaticRenderer(config.renderImage));
const carousel=new CarouselJobs(jobs,creative,exporter);
const video=config.video?new VideoJobs(jobs,new VideoReferences(undefined,jobs,config.video.encryptionKey,config.renderImage!,config.video.mode),creative,
 new VideoProviderJobs(jobs,new RunwayClient({mode:config.video.mode,secret:config.video.credentials,referenceOrigins:[new URL(config.storage.endpoint).origin]}),config.video.encryptionKey),
 new VideoDownload(config.video.outputOrigins,undefined,config.video.outputPolicy),new VideoRenderer(config.video.image)):undefined;
const dispatcher=new JobDispatcher(dispatchPool,new Client({connection:clientConnection,namespace:config.jobs.namespace}),config.jobs.taskQueue,config.provisionTaskQueue);
async function carouselActivity<T>(scope:JobScope,action:()=>Promise<T>):Promise<T>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await action();}catch(e){logActivityFailure('CarouselUnavailable',scope,e);throw ApplicationFailure.retryable('Carousel processing temporarily unavailable','CarouselUnavailable');}finally{clearInterval(timer);}}
const worker=await Worker.create({connection,namespace:config.jobs.namespace,taskQueue:config.jobs.taskQueue,workflowsPath:fileURLToPath(new URL('./asset-workflow.js',import.meta.url)),
  maxConcurrentActivityTaskExecutions:2,activities:{
    planCarousel:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await carousel.plan(scope);}catch(e){logActivityFailure('CarouselUnavailable',scope,e);throw ApplicationFailure.retryable('Carousel planning temporarily unavailable','CarouselUnavailable');}finally{clearInterval(heartbeat);}},
    prepareCarouselExport:(scope:JobScope,position:number)=>carouselActivity(scope,()=>carousel.prepareExport(scope,position)),
    checkCarouselExport:(scope:JobScope,position:number)=>carouselActivity(scope,()=>carousel.checkExport(scope,position)),
    completeCarousel:(scope:JobScope)=>carouselActivity(scope,()=>carousel.complete(scope)),
    failCarousel:(scope:JobScope)=>carouselActivity(scope,()=>carousel.fail(scope)),
    stepVideo:async(scope:JobScope)=>{if(!video)throw ApplicationFailure.nonRetryable('Video generation is not configured','VideoUnavailable');const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await video.step(scope);}catch(e){logActivityFailure('VideoUnavailable',scope,e);throw ApplicationFailure.retryable('Video processing temporarily unavailable','VideoUnavailable');}finally{clearInterval(heartbeat);}},
    failVideo:async(scope:JobScope)=>{if(!video)throw ApplicationFailure.retryable('Video recovery awaits configured worker','VideoUnavailable');return video.exhausted(scope);},
    generateInsights:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await insights.run(scope);}catch(e){logActivityFailure('InsightsUnavailable',scope,e);throw ApplicationFailure.retryable('Analysis temporarily unavailable','InsightsUnavailable');}finally{clearInterval(heartbeat);}},
    failInsights:async(scope:JobScope)=>insights.fail(scope),
    generateBlog:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await blogs.run(scope);}catch(e){logActivityFailure('BlogUnavailable',scope,e);throw ApplicationFailure.retryable('Article writing temporarily unavailable','BlogUnavailable');}finally{clearInterval(heartbeat);}},
    failBlog:async(scope:JobScope)=>blogs.fail(scope),
    publishSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await publication.run(scope);}catch(e){logActivityFailure('PublicationUnavailable',scope,e);throw ApplicationFailure.create({message:'Publication processing unavailable',type:'PublicationUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    reconcileSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await publication.reconcile(scope);}catch(e){logActivityFailure('PublicationCheckUnavailable',scope,e);throw ApplicationFailure.create({message:'Publication check unavailable',type:'PublicationCheckUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failPublication:async(scope:JobScope)=>publication.fail(scope),
    authorizeSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await socialOAuth.run(scope);}catch(e){logActivityFailure('SocialAuthorizationUnavailable',scope,e);throw ApplicationFailure.create({message:'Authorization processing unavailable',type:'SocialAuthorizationUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failSocialOAuth:async(scope:JobScope)=>socialOAuth.fail(scope),
    syncSocial:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await social.run(scope);}catch(e){logActivityFailure('SocialUnavailable',scope,e);throw ApplicationFailure.create({message:'Connection check temporarily unavailable',type:'SocialUnavailable',nextRetryDelay:e instanceof SocialReadRetry?e.delaySeconds*1000:30000});}finally{clearInterval(heartbeat);}},
    failSocial:async(scope:JobScope)=>social.fail(scope),
    exportCreative:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await exporter.run(scope);}catch(e){logActivityFailure('ExportUnavailable',scope,e);throw ApplicationFailure.retryable('Export temporarily unavailable','ExportUnavailable');}finally{clearInterval(heartbeat);}},
    failExport:async(scope:JobScope)=>exporter.fail(scope),
    generatePlan:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await planning.run(scope);}catch(e){logActivityFailure("PlanningUnavailable",scope,e);throw ApplicationFailure.retryable("Planning temporarily unavailable","PlanningUnavailable");}finally{clearInterval(heartbeat);}},
    failPlan:async(scope:JobScope)=>planning.fail(scope),
    generateCreative:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return imageReplacements&&await imageReplacements.handles(scope)?await imageReplacements.step(scope):await creative.run(scope);}catch(e){logActivityFailure("CreativeUnavailable",scope,e);throw ApplicationFailure.retryable("Creative processing temporarily unavailable","CreativeUnavailable");}finally{clearInterval(heartbeat);}},
    failCreative:async(scope:JobScope)=>imageReplacements&&await imageReplacements.handles(scope)?imageReplacements.fail(scope):creative.fail(scope),
    processIntake:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await intake.run(scope);}catch(e){logActivityFailure("IntakeUnavailable",scope,e);throw ApplicationFailure.retryable("Intake temporarily unavailable","IntakeUnavailable");}finally{clearInterval(heartbeat);}},
    failIntake:async(scope:JobScope)=>intake.fail(scope),
    extract:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await documents.extract(scope);}catch(e){logActivityFailure('DocumentProcessingUnavailable',scope,e);throw ApplicationFailure.retryable('Document processing is temporarily unavailable','DocumentProcessingUnavailable');}finally{clearInterval(heartbeat);}},
    failDocument:async(scope:JobScope)=>{try{return await documents.fail(scope);}catch(e){logActivityFailure('DocumentFinalizationUnavailable',scope,e);throw ApplicationFailure.retryable('Unable to save document status','DocumentFinalizationUnavailable');}},
    validate:async(scope:JobScope)=>{const context=Context.current(),heartbeat=setInterval(()=>context.heartbeat(),1000);try{return await jobs.validate(scope);}catch(e){logActivityFailure('AssetValidationUnavailable',scope,e);throw ApplicationFailure.retryable('Asset validation service is temporarily unavailable','AssetValidationUnavailable');}finally{clearInterval(heartbeat);}},
    fail:async(scope:JobScope)=>{try{return await jobs.fail(scope);}catch(e){logActivityFailure('AssetFinalizationUnavailable',scope,e);throw ApplicationFailure.retryable('Unable to save validation status','AssetFinalizationUnavailable');}}
  }});
let dispatching=false,lastDispatchLog=0;
const timer=setInterval(async()=>{if(dispatching)return;dispatching=true;try{await dispatcher.runOnce();}catch(e){const now=Date.now();if(now-lastDispatchLog>60000){lastDispatchLog=now;logActivityFailure('JobDispatcher',{jobId:'dispatcher'},e);}}finally{dispatching=false;}},300);
// Post for Me metrics for published posts, on the dispatcher role (the collector policies of migration 115).
const learningSync=process.env.POSTFORME_ENABLED==='true'&&process.env.POSTFORME_API_KEY?.trim()
 ?learningSyncTick({pool:dispatchPool,client:new PostformeClient(process.env.POSTFORME_API_KEY.trim()),onError:e=>logActivityFailure('LearningSync',{jobId:'learning-sync'},e)}):undefined;
const learningTimer=learningSync?setInterval(()=>{void learningSync();},LEARNING_SYNC_INTERVAL_MS):undefined;
try{await worker.run();}finally{clearInterval(timer);if(learningTimer)clearInterval(learningTimer);await connection.close();await clientConnection.close();store.close();await Promise.all([pool.end(),dispatchPool.end()]);}
