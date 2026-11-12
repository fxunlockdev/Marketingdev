import {ConflictException} from '@nestjs/common';
import {VideoCanvas} from './video-canvas.js';
import {storyShots,REEL_MIN_SHOTS,REEL_MAX_SHOTS} from './reel-plan.js';

type MonthlySlot={id:string;revision:number;brief:string;channel:string;creative_spec:unknown;storyline?:unknown;video_draft?:{storyline:string;script:string;prompt:string;duration_seconds:number}|null};
/** The submit body for one approved monthly video. A reviewed storyline with two or more shots becomes a
 * multi-shot reel (at most five shots); otherwise the single clip is unchanged. Pure. */
export function monthlyVideoRequest(slot:MonthlySlot,reference:unknown):Record<string,unknown>{
 const draft=slot.video_draft,shots=Math.min(REEL_MAX_SHOTS,storyShots(slot.storyline).length);
 return {prompt:draft?`${slot.brief}\nStoryline: ${draft.storyline}\nScript: ${draft.script}\nPrompt: ${draft.prompt}`:slot.brief,channel:slot.channel,duration_seconds:draft?.duration_seconds??5,
  ...(shots>=REEL_MIN_SHOTS?{shots}:{}),creative_spec:slot.creative_spec,slot_id:slot.id,slot_revision:slot.revision,reference,generate:true};
}

/** Resume approved monthly videos through the existing durable, metered pipeline.
 * Stable keys recover lost responses without making another paid request. */
export class GuidedVideos {
 constructor(readonly videos:VideoCanvas){}
 async advance(user:string,brand:string,id:string){
  // Videos stay parked, not failed, until video generation is connected. Concepts and
  // chosen starting images are kept and resume without another approval.
  if(!this.videos.enabled)return;
  try {
   const next=await this.videos.canvas.scope(user,brand,true,async(db,b)=>{
    const plan=(await db.query('SELECT * FROM app.guided_campaigns WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,brand,id])).rows[0];
    if(!plan?.generation_started_at||plan.video_error||plan.plan_approved_by!==user)return;
    if((await db.query("SELECT 1 FROM app.jobs j WHERE organization_id=$1 AND brand_id=$2 AND kind='creative.video' AND status IN ('queued','running','retrying','unknown') AND NOT EXISTS(SELECT 1 FROM app.reel_shots s WHERE s.job_id=j.id)",[b.organization_id,brand])).rowCount)return;
    for(const selected of plan.video_references){
     const key=`monthly-video:${id}:${selected.id}`;
     if((await db.query('SELECT 1 FROM app.video_requests WHERE organization_id=$1 AND brand_id=$2 AND (request_key=$3 OR (slot_id=$4 AND slot_revision>=$5))',[b.organization_id,brand,key,selected.id,selected.revision])).rowCount)continue;
     const slot=(await db.query('SELECT * FROM app.content_slots WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,brand,selected.id])).rows[0];
     if(!slot||slot.revision!==selected.revision||slot.format!=='video'||slot.state!=='content_needed')throw new ConflictException('A video concept changed after calendar approval. Review it in Calendar before generating.');
     // Titles and requests stay stable on replay. submit rechecks references,
     // permissions, slot revision, allowance and provider configuration.
     const thread=await this.videos.canvas.createThread(user,brand,{title:'Monthly video'},key,{db,b});
     return {key,thread:thread.id,slot,reference:selected.reference};
    }
   });
   if(!next)return;
   await this.videos.submit(user,brand,next.thread,monthlyVideoRequest(next.slot,next.reference),next.key);
  }catch(error){
   if(error instanceof ConflictException&&error.message==='A video request is running or needs reconciliation')return;
   await this.videos.canvas.scope(user,brand,true,db=>db.query('UPDATE app.guided_campaigns SET video_error=$2 WHERE id=$1',[id,error instanceof ConflictException?error.message:'Video preparation needs attention. Your approved calendar and completed posts are saved.']));
  }
 }
}
