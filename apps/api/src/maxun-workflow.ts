import {MaxunClient, type MaxunScope} from './maxun-client.js';
import {IntakeError} from './safe-web.js';

export type MaxunCheckpoint = {
 phase:'creating'|'created'|'submitting'|'polling';
 robotId?:string;
 runId?:string;
 submittedAt?:string;
 recoveryOnly?:boolean;
};
/** The implementation must store this under the authenticated job scope and use
 * an atomic compare-and-set. Never implement it with a process-local cache. */
export interface MaxunJournal {
 load():Promise<MaxunCheckpoint|null>;
 replace(expected:MaxunCheckpoint|null,next:MaxunCheckpoint):Promise<boolean>;
 permitted():Promise<boolean>;
}
export class MaxunWorkflow {
 constructor(readonly client:MaxunClient,
   readonly sleep:(ms:number)=>Promise<void>=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))){}
 async capture(scope:MaxunScope,url:string,journal:MaxunJournal){
  const check=async()=>{if(!await journal.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');};
  await check();
  let saved=await journal.load();
  if(!saved){
   const creating:MaxunCheckpoint={phase:'creating'};
   if(!await journal.replace(null,creating))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
   // Persist intent before any external side effect. A crash cannot duplicate it.
   saved=creating;
   try{
    const robot=await this.client.createCrawl(scope,url);
    saved={phase:'created',robotId:robot.id};
    if(!await journal.replace(creating,saved))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
   }catch(error){if(!(error instanceof IntakeError)||error.code!=='MAXUN_SUBMISSION_UNKNOWN')throw error;saved=await journal.load();}

  }
  const recover=async<T>(read:()=>Promise<T|null>):Promise<T>=>{
   for(let attempt=0;attempt<3;attempt++){
    await check();
    try{const found=await read();if(found)return found;}catch(error){
     if(!(error instanceof IntakeError)||!['MAXUN_UNAVAILABLE','MAXUN_RATE_LIMITED','MAXUN_REQUEST_FAILED'].includes(error.code))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
    }
    if(attempt<2)await this.sleep(1000);
   }
   throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  };
  if(!saved)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  if(saved.recoveryOnly&&!['submitting','polling'].includes(saved.phase))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
  if(saved.phase==='creating'){
   const robot=await recover(()=>this.client.recoverRobot(scope,url)),next:MaxunCheckpoint={phase:'created',robotId:robot.id};
   if(!await journal.replace(saved,next))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');saved=next;
  }

  if(saved.phase==='created'){
   await check();
   const submitting:MaxunCheckpoint={phase:'submitting',robotId:saved.robotId,submittedAt:new Date().toISOString()};
   if(!await journal.replace(saved,submitting))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
   saved=submitting;
   try{
    const run=await this.client.execute(saved.robotId!);
    const next:MaxunCheckpoint={phase:'polling',...run,...(saved.recoveryOnly?{recoveryOnly:true}:{})};
    if(!await journal.replace(submitting,next))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');saved=next;
   }catch(error){if(!(error instanceof IntakeError)||error.code!=='MAXUN_SUBMISSION_UNKNOWN')throw error;}

  }
  if(saved.phase==='submitting'){
   // Older checkpoints lack a submission timestamp; never guess their run.
   if(!saved.robotId||!saved.submittedAt)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
   const robotId=saved.robotId,submittedAt=saved.submittedAt;
   const run=await recover(()=>this.client.recoverRun(robotId,submittedAt)),next:MaxunCheckpoint={phase:'polling',...run,...(saved.recoveryOnly?{recoveryOnly:true}:{})};
   if(!await journal.replace(saved,next))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');saved=next;
  }
  if(saved.phase!=='polling'||!saved.robotId||!saved.runId)throw new IntakeError('MAXUN_RESPONSE_INVALID');
  const run={robotId:saved.robotId,runId:saved.runId};
  // Ten minutes within the existing fifteen-minute activity deadline. Retries
  // resume this saved run; they never execute a second crawl.
  const deadline=Date.now()+10*60*1000;
  for(let attempt=0;attempt<120&&Date.now()<deadline;attempt++){
   if(!await journal.permitted()){
    if(!saved.recoveryOnly)await this.client.cancel(run).catch(()=>{});
    throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
   }
   let result;
   try { result=await this.client.status(run); }
   catch(error){
    if(error instanceof IntakeError && ['MAXUN_UNAVAILABLE','MAXUN_RATE_LIMITED','MAXUN_REQUEST_FAILED'].includes(error.code)){
      await this.sleep(5000);continue;
    }
    throw error;
   }
   if(result.status==='success')return {...result,run};
   if(result.status==='failed'||result.status==='aborted')throw new IntakeError('MAXUN_CAPTURE_FAILED');
   await this.sleep(5000);
  }
  // Ordinary Error allows Temporal's bounded retry to resume polling this run.
  throw new Error('MAXUN_POLL_DEADLINE');
 }
}
