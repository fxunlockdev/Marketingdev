import { IntakeError, websiteURL } from './safe-web.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type MaxunScope = {organizationId:string;brandId:string;jobId:string};
export type MaxunRobot = {id:string;name:string};
function robotName(scope:MaxunScope){return `desvio-${id(scope.organizationId)}-${id(scope.brandId)}-${id(scope.jobId)}`;}
export type MaxunRun = {robotId:string;runId:string};
function id(value:unknown):string {
 if(typeof value!=='string'||!uuid.test(value))throw new IntakeError('MAXUN_RESPONSE_INVALID');
 return value;
}
/** Private server-to-server API. Not exported as a customer route or skill tool.
 * Persist robot/run IDs under the job's tenant scope before advancing the workflow.
 * An uncertain execution must be reconciled, never automatically re-executed.
 */
export class MaxunClient {
 private readonly origin:URL;
 constructor(private readonly key:string | undefined,private readonly transport:typeof fetch=fetch) {
  this.origin=new URL('https://app.maxun.dev');
  if(key&&/[\r\n]/.test(key))throw new IntakeError('MAXUN_NOT_CONFIGURED');
 }
 private async request(path:string,body?:unknown,uncertain=false):Promise<any>{
  if(!this.key)throw new IntakeError('MAXUN_NOT_CONFIGURED');
  try {
   const response=await this.transport(new URL(path,this.origin),{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'authorization':'Bearer '+this.key,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok){
    await response.body?.cancel().catch(()=>{});
    if(uncertain&&response.status>=500)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
    if(response.status===403){
     // Cloud can deny paid operations while the key remains valid. Read the
     // account once; never retry the denied operation or expose provider text.
     if(path!=='/api/v1/me'){
      try{const account=await this.request('/api/v1/me');if(account.data?.credits===0)throw new IntakeError('MAXUN_CREDITS_EXHAUSTED');}
      catch(error){if(error instanceof IntakeError&&['MAXUN_CREDITS_EXHAUSTED','MAXUN_AUTH_FAILED'].includes(error.code))throw error;}
     }
     throw new IntakeError('MAXUN_ACCESS_DENIED');
    }
    throw new IntakeError(response.status===401?'MAXUN_AUTH_FAILED':response.status===402?'MAXUN_CREDITS_EXHAUSTED':response.status===429?'MAXUN_RATE_LIMITED':'MAXUN_REQUEST_FAILED');
   }
   const reader=response.body?.getReader();if(!reader)throw new IntakeError('MAXUN_RESPONSE_INVALID');
   const chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const v=await reader.read();if(v.done)break;bytes+=v.value.length;if(bytes>16*1024*1024)throw new IntakeError('MAXUN_OUTPUT_TOO_LARGE');chunks.push(v.value);}}
   finally{await reader.cancel().catch(()=>{});}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value?.success!==true)throw new IntakeError('MAXUN_RESPONSE_INVALID');return value;
  }catch(error){
   if(error instanceof IntakeError){if(uncertain&&['MAXUN_RESPONSE_INVALID','MAXUN_OUTPUT_TOO_LARGE'].includes(error.code))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');throw error;}
   throw new IntakeError(uncertain?'MAXUN_SUBMISSION_UNKNOWN':'MAXUN_UNAVAILABLE');
  }
 }
 async createCrawl(scope:MaxunScope,url:string):Promise<MaxunRobot>{
  const name=robotName(scope);
  const target=websiteURL(url).href;
  const response=await this.request('/api/v1/robots/crawl',{url:target,name,crawlConfig:{outputFormats:['markdown','html','text','links','screenshot-visible','screenshot-fullpage'],mode:'domain',limit:5,maxDepth:2,useSitemap:true,followLinks:true,respectRobots:true}},true);
  const meta=response?.data;
  if(meta?.name!==name||meta?.type!=='crawl'||meta?.url!==target)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  try{return {id:id(meta.id),name};}catch{throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');}
 }
 // Read-only reconciliation: an absent or ambiguous match never authorizes a new POST.
 async recoverRobot(scope:MaxunScope,url:string):Promise<MaxunRobot|null>{
  const name=robotName(scope),target=websiteURL(url).href;
  const query=new URLSearchParams({type:'crawl',q:name,limit:'100',offset:'0'});
  const response=await this.request('/api/v1/robots?'+query);
  if(!Array.isArray(response.data)||response.data.length>=100)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  const matches=response.data.filter((r:any)=>r?.name===name);
  if(matches.length===0)return null;
  if(matches.length!==1||matches[0].type!=='crawl'||matches[0].url!==target)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  return {id:id(matches[0].id),name};
 }
 async recoverRun(robotId:string,submittedAt:string):Promise<MaxunRun|null>{
  id(robotId);
  if(!Number.isFinite(Date.parse(submittedAt)))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  const query=new URLSearchParams({source:'api',since:submittedAt,limit:'2',offset:'0'});
  const response=await this.request(`/api/v1/robots/${robotId}/runs?${query}`);
  if(!Array.isArray(response.data)||response.data.length>1)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  if(response.data.length===0)return null;
  const run=response.data[0];
  if(run?.robotId!==robotId||run?.source!=='api'||(run.startedAt!=null&&(!Number.isFinite(Date.parse(run.startedAt))||Date.parse(run.startedAt)<Date.parse(submittedAt))))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  return {robotId,runId:id(run.id)};
 }
 async execute(robotId:string):Promise<MaxunRun>{
  id(robotId);
  const response=await this.request(`/api/v1/robots/${robotId}/runs`,{},true);
  try{return {robotId,runId:id(response?.id)};}
  catch{throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');}
 }
 async cancel(run:MaxunRun){id(run.runId);await this.request(`/api/v1/runs/${run.runId}/cancel`,{});}
 async status(run:MaxunRun){
  id(run.robotId);id(run.runId);
  const response=await this.request(`/api/v1/runs/${run.runId}`);
  const data=response?.data;
  if(data?.id!==run.runId||data?.robotId!==run.robotId||!['queued','scheduled','running','success','failed','aborted'].includes(data?.status))throw new IntakeError('MAXUN_RESPONSE_INVALID');
  return {status:data.status as string,output:data.data??{},media:data.screenshots??[],partial:data.isPartial===true};
 }
}
