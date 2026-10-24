import {ConflictException} from '@nestjs/common';
import {carouselPages,carouselFingerprint,currentCarousel} from './carousels.js';
// The global creative review and current calendar review must approve the same
// immutable composition. Caller holds the business canvas/plan locks for mutation.
export const carouselPublicationProofSQL=`SELECT v.*,s.id AS slot_id,s.revision AS slot_revision,s.planned_at,s.channel AS slot_channel
 FROM app.content_slots s JOIN app.carousel_versions v ON v.id=s.carousel_version_id
 JOIN app.carousel_projects p ON p.id=v.project_id AND p.latest_version_id=v.id
 JOIN app.carousel_reviews a ON a.version_id=v.id AND a.revision=v.review_revision AND a.decision='approved' AND a.actor_id=v.reviewed_by
 JOIN app.content_slot_events se ON se.slot_id=s.id AND se.revision=s.revision AND se.action='approved' AND se.carousel_version_id=v.id AND se.carousel_sha256=v.sha256
 WHERE s.format='carousel' AND s.state='approved' AND s.approved_by IS NOT NULL
 AND v.status='approved' AND v.reviewed_by IS NOT NULL AND s.carousel_sha256=v.sha256 AND v.channel=s.channel`;
export async function carouselPublicationProof(db:any,slot:string,image?:string){
 if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw new ConflictException('Carousel publishing renderer is not configured');
 const v=(await db.query(carouselPublicationProofSQL+' AND s.id=$1',[slot])).rows[0];
 if(!v)throw new ConflictException('Approve the current carousel and its calendar post before publishing');
 const pages=await carouselPages(db,v.id);
 if(!currentCarousel(pages,image)||carouselFingerprint(v,pages)!==v.sha256)throw new ConflictException('Review the latest saved carousel slides before publishing');
 const files=[];
 for(const page of pages){
  const e=(await db.query('SELECT id,object_key,bytes,sha256 FROM app.creative_exports WHERE id=$1',[page.export_id])).rows[0];
  if(!e||e.sha256!==page.sha256)throw new ConflictException('Saved carousel slide is unavailable');
  files.push({...e,position:page.position,alt_text:page.alt_text});
 }
 return {...v,files};
}
