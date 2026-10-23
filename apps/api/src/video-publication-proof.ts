import {ConflictException} from '@nestjs/common';
import {VIDEO_RENDER_VERSION} from './video-renderer.js';
export const videoPublicationProofSQL=`SELECT DISTINCT v.*,s.id AS slot_id,s.revision AS slot_revision,s.planned_at,s.channel FROM app.content_slots s
 JOIN app.video_versions v ON v.id=s.video_version_id JOIN app.video_projects p ON p.id=v.project_id JOIN app.video_requests r ON r.job_id=v.job_id
 JOIN app.video_reviews a ON a.version_id=v.id AND a.revision=v.review_revision AND a.decision='approved' AND a.sha256=v.sha256
 JOIN app.content_slot_events se ON se.slot_id=s.id AND se.revision=s.revision AND se.action='approved' AND se.video_version_id=v.id AND se.video_sha256=v.sha256
 WHERE s.format='video' AND s.state='approved' AND s.approved_by IS NOT NULL AND v.status='approved' AND v.reviewed_by IS NOT NULL
 AND s.video_sha256=v.sha256 AND p.latest_version_id=v.id AND r.output_version_id=v.id AND r.channel=s.channel
 AND v.manifest->>'image'=$1 AND v.manifest->>'version'=$2 AND v.manifest->>'video_sha256'=v.sha256`;
export async function videoPublicationProof(db:any,slot:string,image?:string){
 if(!image||!/^sha256:[a-f0-9]{64}$/.test(image))throw new ConflictException('Video publishing renderer is not configured');
 const row=(await db.query(videoPublicationProofSQL+' AND s.id=$3',[image,VIDEO_RENDER_VERSION,slot])).rows[0];
 if(!row)throw new ConflictException('Approve the latest saved video and its current calendar post before publishing');return row;
}
