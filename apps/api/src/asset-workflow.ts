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
