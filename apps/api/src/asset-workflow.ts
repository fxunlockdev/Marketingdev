import {proxyActivities} from '@temporalio/workflow';
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
