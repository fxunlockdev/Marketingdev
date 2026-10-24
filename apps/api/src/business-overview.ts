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
  const results=(await db.query(`SELECT r.job_id AS publication_id,left(r.caption,200) AS caption,c.provider,c.name AS account_name,r.scheduled_at,
   a.state,a.series,a.collected_at,a.semantics,
   count(*) OVER()::int AS published_count,count(*) FILTER(WHERE a.state='available') OVER()::int AS available_count
   FROM app.publication_requests r JOIN app.social_channels c ON c.id=r.channel_id
   LEFT JOIN LATERAL(SELECT state,series,collected_at,semantics FROM app.post_analytics x WHERE x.publication_id=r.job_id ORDER BY collected_at DESC,id DESC LIMIT 1)a ON true
   WHERE r.phase='accepted' AND r.observed_state='published' ORDER BY r.scheduled_at DESC,r.job_id LIMIT 6`)).rows;
  const performance={published_count:results[0]?.published_count??0,available_count:results[0]?.available_count??0,posts:results.map(r=>({publication_id:r.publication_id,caption:r.caption,provider:r.provider,account_name:r.account_name,scheduled_at:r.scheduled_at,state:r.state??'not_collected',collected_at:r.collected_at,semantics:r.semantics,
   metrics:r.state==='available'?(r.series??[]).slice(0,4).flatMap((series:any)=>{const point=series.points?.at(-1);return point?[{label:series.label,date:point.date,value:point.value}]:[];}):[]}))};
  const recommendations=(await db.query("SELECT id,state,content,applicability,created_at FROM app.memory_lessons WHERE state IN ('proposed','testing') ORDER BY created_at DESC,id LIMIT 3")).rows.map(r=>({id:r.id,state:r.state,title:r.content.title,summary:r.content.summary,hypothesis:r.content.hypothesis,next_test:r.content.next_test,limitations:r.content.limitations,evidence_count:r.content.evidence_ids.length,applicability:r.applicability,created_at:r.created_at}));
  const generation_activity=(await db.query(`SELECT kind,count(*)::int AS requested,count(*) FILTER(WHERE status='succeeded')::int AS completed,count(*) FILTER(WHERE status='unknown')::int AS uncertain
   FROM app.jobs WHERE kind IN ('creative.generate','creative.video','plan.generate','insight.generate') AND created_at>now()-interval '30 days' GROUP BY kind ORDER BY kind`)).rows;
  return {business_id:brand,counts,activity,performance,recommendations,generation_activity,checked_at:new Date().toISOString(),analytics_available:performance.available_count>0};
 },brand);}
}
