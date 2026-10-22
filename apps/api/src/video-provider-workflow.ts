import {proxyActivities,sleep} from '@temporalio/workflow';
import type {JobScope} from './jobs.js';
type Activities={stepVideoProvider(scope:JobScope):Promise<string>;exhaustVideoProvider(scope:JobScope):Promise<string>};
const provider=proxyActivities<Activities>({startToCloseTimeout:'3 minutes',heartbeatTimeout:'10 seconds',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute',maximumAttempts:5}});
const finish=proxyActivities<Activities>({startToCloseTimeout:'30 seconds',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute'}});
/** Child stage for the forthcoming Canvas video workflow. Prepared intent and
 * reservation must already exist. Completion still requires media validation. */
export async function videoProviderWorkflow(scope:JobScope){
 try{for(let i=0;i<720;i++){
  const phase=await provider.stepVideoProvider(scope);
  if(!['prepared','accepted'].includes(phase))return phase;
  await sleep('30 seconds');
 }}catch{}
 return finish.exhaustVideoProvider(scope);
}
