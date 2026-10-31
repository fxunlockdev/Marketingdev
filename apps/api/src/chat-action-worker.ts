import {HttpException} from '@nestjs/common';
import type {Pool} from 'pg';
import type {ChatConversations} from './chat-conversations.js';
/** Durable continuation; never calls a paid provider directly. execute() atomically
 * creates an idempotent existing workflow under the original actor's current access. */
export class ChatActionWorker {
 constructor(readonly queue:Pool,readonly chat:ChatConversations){}
 async runOnce(){
  const rows=(await this.queue.query("SELECT job_id,brand_id,actor_id,attempts FROM delivery.chat_actions WHERE status='queued' AND next_attempt_at<=now() ORDER BY next_attempt_at,job_id LIMIT 5")).rows;
  for(const r of rows){
   try{await this.chat.execute(r.actor_id,r.brand_id,r.job_id);
    await this.queue.query("UPDATE delivery.chat_actions SET status='completed',error_code=NULL WHERE job_id=$1 AND status='queued'",[r.job_id]);
   }catch(error){
    const permanent=error instanceof HttpException&&error.getStatus()<500;
    await this.queue.query("UPDATE delivery.chat_actions SET attempts=attempts+1,status=CASE WHEN $2 OR attempts>=4 THEN 'failed' ELSE 'queued' END,next_attempt_at=now()+interval '30 seconds',error_code=$3 WHERE job_id=$1 AND status='queued'",[r.job_id,permanent,permanent?'CHAT_ACTION_NEEDS_ATTENTION':'CHAT_ACTION_TEMPORARILY_UNAVAILABLE']);
   }
  }
  return rows.length;
 }
}
