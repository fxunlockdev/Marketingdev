import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {Businesses} from './businesses.js';
import {object,uuid} from './workspaces.js';

export type StopWaitingResult={id:string;status:string;automatically_retried:false};

/** Lets a customer stop waiting on a research or planning request whose provider
 * result is uncertain. The database function enforces access, state and auditing. */
export class UncertainRequests {
 constructor(readonly businesses:Businesses){}
 async stopWaiting(user:string,businessId:string,jobId:string,body:unknown):Promise<StopWaitingResult>{
  const target=uuid(jobId);
  if(object(body,['acknowledge_possible_charge']).acknowledge_possible_charge!==true)
   throw new BadRequestException('Acknowledge that the provider charge may still apply');
  const business=await this.businesses.resolve(user,businessId);
  return this.businesses.database.transaction(user,business.organization_id,true,async db=>{
   try{
    const result=await db.query('SELECT app.stop_waiting_for_request($1,true) AS status',[target]);
    return {id:target,status:result.rows[0].status as string,automatically_retried:false as const};
   }catch(error:unknown){
    const code=(error as {code?:unknown}).code;
    if(code==='42501')throw new NotFoundException('Request unavailable');
    if(code==='22023')throw new ConflictException((error as Error).message);
    throw error;
   }
  },businessId);
 }
}
