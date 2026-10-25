import {proxyActivities} from '@temporalio/workflow';
import type {JobScope} from './jobs.js';
type Activities={provisionSocial(scope:JobScope):Promise<string>;failProvisionSocial(scope:JobScope):Promise<string>};
const operations=proxyActivities<Activities>({startToCloseTimeout:'90 seconds',heartbeatTimeout:'5 seconds',retry:{initialInterval:'30 seconds',maximumInterval:'2 minutes',maximumAttempts:3}});
const finalization=proxyActivities<Activities>({startToCloseTimeout:'20 seconds',retry:{initialInterval:'2 seconds',maximumInterval:'1 minute'}});
export async function provisionSocialWorkflow(scope:JobScope){try{return await operations.provisionSocial(scope);}catch{return await finalization.failProvisionSocial(scope);}}
