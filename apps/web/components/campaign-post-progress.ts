/** Customer-facing state for a saved generation attempt; never implies paid retry. */
export function campaignPostProgress(status?:string){
 if(!status||status==='succeeded')return null;
 if(['queued','running','retrying'].includes(status))return {label:status==='queued'?'Queued':'Generating',description:'Your visual is being prepared. It will appear here when ready.',tone:'pending',recover:false};
 if(status==='awaiting_approval')return {label:'Review your script',description:'Open this post to approve its video script before generation.',tone:'pending',recover:true};
 if(status==='needs_attachment')return {label:'Visual ready to attach',description:'Open this post to attach its saved visual.',tone:'attention',recover:true};
 if(status==='unknown')return {label:'Needs attention',description:'We could not confirm this generation. Open the post to check its status before trying again.',tone:'attention',recover:true};
 if(['failed','rejected','canceled','review_changed'].includes(status))return {label:status==='canceled'?'Generation stopped':status==='review_changed'?'Post changed':'Generation failed',description:'Your topic is saved. Open the post to review the issue and choose the next step.',tone:'attention',recover:true};
 return null;
}
