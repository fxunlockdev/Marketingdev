import {ConflictException} from '@nestjs/common';
import {VideoCanvas} from './video-canvas.js';

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
    if((await db.query("SELECT 1 FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='creative.video' AND status IN ('queued','running','retrying','unknown')",[b.organization_id,brand])).rowCount)return;
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
   await this.videos.submit(user,brand,next.thread,{prompt:next.slot.video_draft?`${next.slot.brief}\nStoryline: ${next.slot.video_draft.storyline}\nScript: ${next.slot.video_draft.script}\nPrompt: ${next.slot.video_draft.prompt}`:next.slot.brief,channel:next.slot.channel,duration_seconds:next.slot.video_draft?.duration_seconds??5,creative_spec:next.slot.creative_spec,slot_id:next.slot.id,slot_revision:next.slot.revision,reference:next.reference,generate:true},next.key);
  }catch(error){
   if(error instanceof ConflictException&&error.message==='A video request is running or needs reconciliation')return;
   await this.videos.canvas.scope(user,brand,true,db=>db.query('UPDATE app.guided_campaigns SET video_error=$2 WHERE id=$1',[id,error instanceof ConflictException?error.message:'Video preparation needs attention. Your approved calendar and completed posts are saved.']));
  }
 }
}
