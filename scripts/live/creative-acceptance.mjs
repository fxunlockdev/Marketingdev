// Uses only customer APIs. The caller supplies durable journal storage and transport.
// No provider SDK, credential, automatic approval, or social publication lives here.
import {createHash} from 'node:crypto';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
export async function creativeAcceptance({api,foreign,anonymous,media,save,wait,now=Date.now},config,state){
 requireThat([config.organizationId,config.businessId,state.runId].every(uuid),'LIVE_EXACT_SCOPE_REQUIRED');
 requireThat(Number.isSafeInteger(config.budgetMicros)&&config.budgetMicros>=2&&config.budgetMicros<=1000000000,'LIVE_BUDGET_INVALID');
 const base='/api/v1/businesses/'+config.businessId,brainPath=`/api/v1/workspaces/${config.organizationId}/brands/${config.businessId}/brain`;
 const denied=async(client,path)=>{const r=await client(path);requireThat([401,403,404].includes(r.status),'LIVE_ISOLATION_FAILED');};
 const request=async(path,body,key,method)=>{const r=await api(path,body,key,method);requireThat(r.status>=200&&r.status<300,'LIVE_API_'+r.status);return r.body;};
 const b=await request(base);requireThat(b.organization_id===config.organizationId,'LIVE_ORGANIZATION_MISMATCH');
 await denied(anonymous,base);await denied(foreign,base);
 const brain=await request(brainPath);requireThat(uuid(brain.active?.id),'LIVE_APPROVED_BRAND_REQUIRED');
 if(state.brainId)requireThat(state.brainId===brain.active.id,'LIVE_APPROVED_BRAND_CHANGED');else{state.brainId=brain.active.id;await save(state);}
 const allowances=await request(base+'/canvas/allowances');requireThat(allowances.allowances.some(a=>a.capability==='creative_openai'&&a.state==='active'),'LIVE_CREATIVE_ALLOWANCE_REQUIRED');
 if(!state.threadId){state.threadId=(await request(base+'/canvas/threads',{title:'Staging acceptance '+state.runId},state.runId+':thread')).id;requireThat(uuid(state.threadId),'LIVE_THREAD_INVALID');await save(state);}
 const threadPath=base+'/canvas/threads/'+state.threadId;
 const deadline=now()+15*60*1000;
 for(const phase of ['create','edit']){
  const slot=state[phase]??={};
  if(!slot.jobId){
   const body={prompt:phase==='create'?'Create a clearly labelled STAGING TEST brand-specific marketing image with editable text. Use only approved brand facts.':'Edit the previous image: use a different composition while preserving approved brand identity. Keep the STAGING TEST label.',format:'static',channel:'linkedin',size:'1024x1024',text_provider:'openai',max_cost_micros:Math.floor(config.budgetMicros/2),...(phase==='edit'?{parent_version_id:state.create.versionId}:{})};
   // The stable key survives a lost HTTP response; replay cannot create a second paid job.
   slot.request=body;await save(state);const result=await request(threadPath+'/messages',body,state.runId+':'+phase);requireThat(uuid(result.id),'LIVE_JOB_INVALID');slot.jobId=result.id;await save(state);
  }
  let run,delay=2000;
  while(true){
   const thread=await request(threadPath);run=thread.runs.find(r=>r.id===slot.jobId);requireThat(!!run,'LIVE_JOB_MISSING');
   if(run.status==='succeeded')break;
   requireThat(['queued','running','retrying'].includes(run.status),'LIVE_JOB_NOT_SUCCESSFUL');
   requireThat(now()<deadline,'LIVE_WAIT_EXPIRED_RESUME_SAME_JOURNAL');await wait(delay);delay=Math.min(10000,delay+2000);
  }
  requireThat(uuid(run.output_version_id)&&uuid(run.project_id),'LIVE_OUTPUT_MISSING');
  const project=await request(base+'/creative-projects/'+run.project_id),version=project.versions.find(v=>v.id===run.output_version_id);
  requireThat(version?.brain_id===state.brainId&&uuid(version.media_id),'LIVE_OUTPUT_SCOPE_MISMATCH');
  if(phase==='edit')requireThat(version.parent_id===state.create.versionId,'LIVE_EDIT_LINEAGE_MISMATCH');
  await denied(foreign,base+'/creative-projects/'+run.project_id);await denied(foreign,base+'/creative-media/'+version.media_id);
  const signed=await request(base+'/creative-media/'+version.media_id),bytes=await media(signed.url);
  requireThat(bytes.length>8&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])),'LIVE_IMAGE_INVALID');
  Object.assign(slot,{projectId:run.project_id,versionId:version.id,mediaId:version.media_id,sha256:createHash('sha256').update(bytes).digest('hex')});await save(state);
 }
 const projectPath=base+'/creative-projects/'+state.edit.projectId;
 if(!state.manualVersionId){
  const project=await request(projectPath),version=project.versions.find(v=>v.id===state.edit.versionId);
  requireThat(!!version,'LIVE_EDIT_MISSING');
  const saved=await request(projectPath+'/versions',{parent_id:version.id,design:version.design,caption:'STAGING TEST — editable caption acceptance '+state.runId});
  requireThat(uuid(saved.id),'LIVE_SAVED_VERSION_INVALID');state.manualVersionId=saved.id;await save(state);
 }
 let project=await request(projectPath),version=project.versions.find(v=>v.id===state.manualVersionId);
 requireThat(project.project.latest_version_id===version?.id,'LIVE_REVIEW_VERSION_CHANGED');
 if(version.status==='draft'){
  await request(base+'/creative-versions/'+version.id+'/review',{decision:'in_review',feedback:'Staging test: please inspect this exact saved image and caption in Desvio.',revision:version.review_revision});
  project=await request(projectPath);version=project.versions.find(v=>v.id===state.manualVersionId);
 }
 requireThat(['in_review','approved'].includes(version.status),'LIVE_REVIEW_NOT_APPROVED');
 state.status=version.status==='approved'?'passed':'awaiting_human_approval';await save(state);
 return {status:state.status,runId:state.runId,organizationId:config.organizationId,businessId:config.businessId,brainId:state.brainId,threadId:state.threadId,created:state.create,edited:state.edit,reviewVersionId:state.manualVersionId,budgetMicros:config.budgetMicros,checks:{authenticated_scope:true,anonymous_denied:true,foreign_account_denied:true,create:true,provider_edit:true,private_media_readback:true,manual_save:true,exact_version_approved:state.status==='passed'},scope:'Customer API creative generation, provider edit, editable save and human approval. Does not certify onboarding extraction, video, publishing, UI quality or full production release.'};
}
