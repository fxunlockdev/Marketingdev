import {proxyActivities,sleep,continueAsNew} from '@temporalio/workflow';
import type {JobScope} from './jobs.js';
type Activities={stepVideo(scope:JobScope):Promise<string>;failVideo(scope:JobScope):Promise<string>};
const work=proxyActivities<Activities>({startToCloseTimeout:'12 minutes',heartbeatTimeout:'10 seconds',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute',maximumAttempts:5}});
const finish=proxyActivities<Activities>({startToCloseTimeout:'30 seconds',retry:{initialInterval:'5 seconds',maximumInterval:'1 minute'}});
export async function generateVideoWorkflow(scope:JobScope,awaiting=0):Promise<string>{
 try{for(let i=0;i<722;i++){
  const state=await work.stepVideo(scope);
  if(state==='awaiting_approval'){if(++awaiting>=10080)break;i--;await sleep('1 minute');if(awaiting%100===0)return continueAsNew<typeof generateVideoWorkflow>(scope,awaiting);continue;}
  if(!['prepared','accepted','completed'].includes(state))return state;
  if(state!=='completed')await sleep('30 seconds');
 }}catch{}
 return finish.failVideo(scope);
}
