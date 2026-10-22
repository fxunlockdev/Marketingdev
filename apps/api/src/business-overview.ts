import {Businesses} from './businesses.js';
export class BusinessOverview {
 constructor(readonly businesses:Businesses){}
 async read(user:string,brand:string){const b=await this.businesses.resolve(user,brand);return this.businesses.database.transaction(user,b.organization_id,false,async db=>{
  const counts=(await db.query(`SELECT
   (SELECT count(*)::int FROM app.content_slots WHERE state='pending_review') AS awaiting_review,
   (SELECT count(*)::int FROM app.content_slots WHERE state='approved') AS approved_posts,
   (SELECT count(*)::int FROM app.creative_projects) AS creative_projects,
   (SELECT count(*)::int FROM app.jobs WHERE status IN ('queued','running','retrying')) AS active_jobs,
   (SELECT count(*)::int FROM app.publication_requests WHERE phase='accepted' AND observed_state='published') AS published_posts,
   (SELECT count(*)::int FROM app.publication_requests WHERE phase='accepted' AND observed_state='queued') AS scheduled_posts,
   (SELECT count(*)::int FROM app.publication_requests WHERE phase='unknown') AS uncertain_publications,
   (SELECT count(*)::int FROM app.publication_requests WHERE phase='accepted' AND (observed_state IN ('missing','unknown','failed') OR check_error IS NOT NULL)) AS publication_attention,
   (SELECT count(*)::int FROM app.jobs WHERE status IN ('failed','rejected') AND updated_at>now()-interval '7 days') AS failed_jobs_last_week`)).rows[0];
  const activity=(await db.query('SELECT id,kind,status,updated_at FROM app.jobs ORDER BY updated_at DESC,id LIMIT 8')).rows;
  return {business_id:brand,counts,activity,checked_at:new Date().toISOString(),analytics_available:false};
 },brand);}
}
