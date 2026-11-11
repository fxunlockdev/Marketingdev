import {setTimeout} from 'node:timers/promises';

export async function waitForDeployment({id,previous,status,now=Date.now,sleep=setTimeout,timeoutMs=30*60*1000,progress=()=>{}}){
 const deadline=now()+timeoutMs;let reported='',nextReport=0;
 while(now()<deadline){
  let current;
  try { current=await status(); }
  catch {
   // A failed observation is not evidence that the deployment failed.
   // Keep watching the original ID; never retry a deployment mutation here.
   if(reported!=='OBSERVATION_UNAVAILABLE'||now()>=nextReport){progress({deployment_id:id,status:'OBSERVATION_UNAVAILABLE'});reported='OBSERVATION_UNAVAILABLE';nextReport=now()+60000;}
   await sleep(Math.min(5000,Math.max(0,deadline-now())));
   continue;
  }
  if(current.deploymentId!==previous&&current.deploymentId!==id)throw Error('ACTIVATION_API_DEPLOYMENT_CHANGED');
  if(current.deploymentId===id){
   if(current.status==='SUCCESS'&&!current.stopped)return;
   if(['FAILED','CRASHED','REMOVED','SKIPPED','NEEDS_APPROVAL'].includes(current.status))throw Error('ACTIVATION_API_DEPLOYMENT_FAILED');
  }
  const observed=current.deploymentId===id?current.status:'AWAITING_DEPLOYMENT';
  if(observed!==reported||now()>=nextReport){progress({deployment_id:id,status:observed});reported=observed;nextReport=now()+60000;}
  await sleep(Math.min(5000,Math.max(0,deadline-now())));
 }
 throw Error('ACTIVATION_API_DEPLOYMENT_UNCONFIRMED');
}
