export {generateVideoWorkflow} from './video-workflow.js';
import {proxyActivities,sleep} from '@temporalio/workflow';
import type {JobScope} from './jobs.js';
type Activities={validate(scope:JobScope):Promise<string>;fail(scope:JobScope):Promise<string>};
const validation=proxyActivities<Activities>({startToCloseTimeout:'90 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'1 second',maximumInterval:'5 seconds',maximumAttempts:4}});
const finalization=proxyActivities<Activities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function validateAssetWorkflow(scope:JobScope){
  try{return await validation.validate(scope);}catch{return await finalization.fail(scope);}
}

type DocumentActivities={extract(scope:JobScope):Promise<string>;failDocument(scope:JobScope):Promise<string>};
const documents=proxyActivities<DocumentActivities>({startToCloseTimeout:'150 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const documentFinalization=proxyActivities<DocumentActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function extractDocumentWorkflow(scope:JobScope){try{return await documents.extract(scope);}catch{return await documentFinalization.failDocument(scope);}}

type IntakeActivities={processIntake(scope:JobScope):Promise<string>;failIntake(scope:JobScope):Promise<string>};
const intake=proxyActivities<IntakeActivities>({startToCloseTimeout:"15 minutes",heartbeatTimeout:"5 seconds",retry:{initialInterval:"2 seconds",maximumInterval:"10 seconds",maximumAttempts:3}});
const intakeFinalization=proxyActivities<IntakeActivities>({startToCloseTimeout:"20 seconds",retry:{initialInterval:"2 seconds",maximumInterval:"1 minute"}});
export async function processIntakeWorkflow(scope:JobScope){try{return await intake.processIntake(scope);}catch{return await intakeFinalization.failIntake(scope);}}


type CreativeActivities={generateCreative(scope:JobScope):Promise<string>;failCreative(scope:JobScope):Promise<string>};
const creative=proxyActivities<CreativeActivities>({startToCloseTimeout:'10 minutes',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const creativeFinalization=proxyActivities<CreativeActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function generateCreativeWorkflow(scope:JobScope){try{return await creative.generateCreative(scope);}catch{return await creativeFinalization.failCreative(scope);}}


type PlanningActivities={generatePlan(scope:JobScope):Promise<string>;failPlan(scope:JobScope):Promise<string>};
const planning=proxyActivities<PlanningActivities>({startToCloseTimeout:'6 minutes',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const planningFinalization=proxyActivities<PlanningActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function generatePlanWorkflow(scope:JobScope){try{return await planning.generatePlan(scope);}catch{return await planningFinalization.failPlan(scope);}}

type ExportActivities={exportCreative(scope:JobScope):Promise<string>;failExport(scope:JobScope):Promise<string>};
const exports=proxyActivities<ExportActivities>({startToCloseTimeout:'100 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const exportFinalization=proxyActivities<ExportActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function exportCreativeWorkflow(scope:JobScope){try{return await exports.exportCreative(scope);}catch{return await exportFinalization.failExport(scope);}}

type SocialActivities={syncSocial(scope:JobScope):Promise<string>;failSocial(scope:JobScope):Promise<string>};
const social=proxyActivities<SocialActivities>({startToCloseTimeout:'60 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'30 seconds',maximumInterval:'2 minutes',maximumAttempts:3}});
const socialFinalization=proxyActivities<SocialActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function syncSocialWorkflow(scope:JobScope){try{return await social.syncSocial(scope);}catch{return await socialFinalization.failSocial(scope);}}


type OAuthActivities={authorizeSocial(scope:JobScope):Promise<string>;failSocialOAuth(scope:JobScope):Promise<string>};
const oauth=proxyActivities<OAuthActivities>({startToCloseTimeout:'120 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'30 seconds',maximumInterval:'2 minutes',maximumAttempts:3}});
const oauthFinalization=proxyActivities<OAuthActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function authorizeSocialWorkflow(scope:JobScope){try{return await oauth.authorizeSocial(scope);}catch{return await oauthFinalization.failSocialOAuth(scope);}}


type PublicationActivities={publishSocial(scope:JobScope):Promise<string>;reconcileSocial(scope:JobScope):Promise<{state:string;scheduledAt?:string}>;failPublication(scope:JobScope):Promise<string>};
const publication=proxyActivities<PublicationActivities>({startToCloseTimeout:'3 minutes',heartbeatTimeout:'5 seconds',retry:{initialInterval:'30 seconds',maximumInterval:'2 minutes',maximumAttempts:3}});
const publicationFinalization=proxyActivities<PublicationActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function reconcileSocialWorkflow(scope:JobScope){try{return await publication.reconcileSocial(scope);}catch{return await publicationFinalization.failPublication(scope);}}
export async function publishSocialWorkflow(scope:JobScope){
 let outcome:string;try{outcome=await publication.publishSocial(scope);}catch{return await publicationFinalization.failPublication(scope);}
 if(outcome!=='accepted')return outcome;
 // Durable bounded observation: no automatic resubmission, even for missing posts.
 for(let i=0;i<26;i++){
  let observation;try{observation=await publication.reconcileSocial(scope);}catch{return 'accepted_check_unavailable';}
  if(['published','failed','check_failed'].includes(observation.state))return observation.state;
  const until=observation.scheduledAt?Date.parse(observation.scheduledAt)-Date.now():0;
  await sleep(i===0?Math.max(15000,until+15000):3600000);
 }
 return 'accepted_unconfirmed';
}


type InsightActivities={generateInsights(scope:JobScope):Promise<string>;failInsights(scope:JobScope):Promise<string>};
const insights=proxyActivities<InsightActivities>({startToCloseTimeout:'6 minutes',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const insightFinalization=proxyActivities<InsightActivities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function generateInsightsWorkflow(scope:JobScope){try{return await insights.generateInsights(scope);}catch{return await insightFinalization.failInsights(scope);}}

type CarouselActivities={planCarousel(scope:JobScope):Promise<{state:string;children?:{position:number;generation_job_id:string;export_job_id:string}[]}>;prepareCarouselExport(scope:JobScope,position:number):Promise<{state:string;export_scope?:JobScope}>;checkCarouselExport(scope:JobScope,position:number):Promise<string>;completeCarousel(scope:JobScope):Promise<string>;failCarousel(scope:JobScope):Promise<string>};
const carousel=proxyActivities<CarouselActivities>({startToCloseTimeout:'6 minutes',heartbeatTimeout:'5 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'10 seconds',maximumAttempts:3}});
const carouselFinalization=proxyActivities<CarouselActivities>({startToCloseTimeout:'60 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function generateCarouselWorkflow(scope:JobScope){
 try{
  const plan=await carousel.planCarousel(scope);if(plan.state!=='ready')return plan.state;
  for(const child of plan.children!){
   await generateCreativeWorkflow({...scope,jobId:child.generation_job_id});
   const next=await carousel.prepareCarouselExport(scope,child.position);if(next.state!=='ready')return next.state;
   await exportCreativeWorkflow(next.export_scope!);
   const state=await carousel.checkCarouselExport(scope,child.position);if(state!=='ready')return state;
  }
  return await carousel.completeCarousel(scope);
 }catch{return await carouselFinalization.failCarousel(scope);}
}
