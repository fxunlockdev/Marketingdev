import {Businesses} from './businesses.js';
/** One definition of a published and a queued post, by content slot, across both publishers. The counts and
 * the upcoming list use the same predicates, so a post is never counted as published and listed as upcoming. */
const PUBLISHED_SLOT=`(EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.organization_id=s.organization_id AND r.brand_id=s.brand_id AND r.slot_id=s.id AND r.phase='accepted' AND r.observed_state='published')
 OR EXISTS(SELECT 1 FROM app.postforme_publications f WHERE f.organization_id=s.organization_id AND f.brand_id=s.brand_id AND f.slot_id=s.id AND f.phase='accepted' AND f.observed_state='published'))`;
const QUEUED_SLOT=`(EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.organization_id=s.organization_id AND r.brand_id=s.brand_id AND r.slot_id=s.id AND r.phase='accepted' AND r.observed_state='queued')
 OR EXISTS(SELECT 1 FROM app.postforme_publications f WHERE f.organization_id=s.organization_id AND f.brand_id=s.brand_id AND f.slot_id=s.id AND f.phase='accepted' AND f.observed_state IN ('unconfirmed','scheduled','processing')))`;
export class BusinessOverview {
 constructor(readonly businesses:Businesses){}
 async read(user:string,brand:string){const b=await this.businesses.resolve(user,brand);return this.businesses.database.transaction(user,b.organization_id,false,async db=>{
  const scope=[b.organization_id,brand];
  const counts=(await db.query(`SELECT
   (SELECT count(*)::int FROM app.content_slots s WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.state='pending_review') AS awaiting_review,
   (SELECT count(*)::int FROM app.content_slots s WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.state='approved') AS approved_posts,
   (SELECT count(*)::int FROM app.creative_projects WHERE organization_id=$1 AND brand_id=$2) AS creative_projects,
   (SELECT count(*)::int FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND status IN ('queued','running','retrying')) AS active_jobs,
   (SELECT count(*)::int FROM app.content_slots s WHERE s.organization_id=$1 AND s.brand_id=$2 AND ${PUBLISHED_SLOT}) AS published_posts,
   (SELECT count(*)::int FROM app.content_slots s WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.state<>'cancelled' AND NOT ${PUBLISHED_SLOT} AND ${QUEUED_SLOT}) AS scheduled_posts,
   (SELECT count(*)::int FROM app.publication_requests WHERE organization_id=$1 AND brand_id=$2 AND phase='unknown')
    +(SELECT count(*)::int FROM app.postforme_publications WHERE organization_id=$1 AND brand_id=$2 AND phase='unknown') AS uncertain_publications,
   (SELECT count(*)::int FROM app.publication_requests WHERE organization_id=$1 AND brand_id=$2 AND phase='accepted' AND (observed_state IN ('missing','unknown','failed') OR check_error IS NOT NULL))
    +(SELECT count(*)::int FROM app.postforme_publications f WHERE organization_id=$1 AND brand_id=$2 AND phase='accepted' AND observed_state='failed' AND NOT EXISTS(SELECT 1 FROM app.postforme_publications r WHERE r.retry_of=f.id)) AS publication_attention,
   (SELECT count(*)::int FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND status IN ('failed','rejected') AND updated_at>now()-interval '7 days') AS failed_jobs_last_week`,scope)).rows[0];
  const activity=(await db.query('SELECT id,kind,status,updated_at FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 ORDER BY updated_at DESC,id LIMIT 8',scope)).rows;
  const results=(await db.query(`SELECT r.job_id AS publication_id,left(r.caption,200) AS caption,c.provider,c.name AS account_name,r.scheduled_at,
   a.state,a.series,a.collected_at,a.semantics,
   count(*) OVER()::int AS published_count,count(*) FILTER(WHERE a.state='available') OVER()::int AS available_count
   FROM app.publication_requests r JOIN app.social_channels c ON c.id=r.channel_id
   LEFT JOIN LATERAL(SELECT state,series,collected_at,semantics FROM app.post_analytics x WHERE x.publication_id=r.job_id ORDER BY collected_at DESC,id DESC LIMIT 1)a ON true
   WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.phase='accepted' AND r.observed_state='published' ORDER BY r.scheduled_at DESC,r.job_id LIMIT 6`,scope)).rows;
  const performance={published_count:results[0]?.published_count??0,available_count:results[0]?.available_count??0,posts:results.map(r=>({publication_id:r.publication_id,caption:r.caption,provider:r.provider,account_name:r.account_name,scheduled_at:r.scheduled_at,state:r.state??'not_collected',collected_at:r.collected_at,semantics:r.semantics,
   metrics:r.state==='available'?(r.series??[]).slice(0,4).flatMap((series:any)=>{const point=series.points?.at(-1);return point?[{label:series.label,date:point.date,value:point.value}]:[];}):[]}))};
  const recommendations=(await db.query("SELECT id,state,content,applicability,created_at FROM app.memory_lessons WHERE organization_id=$1 AND brand_id=$2 AND state IN ('proposed','testing') ORDER BY created_at DESC,id LIMIT 3",scope)).rows.map(r=>({id:r.id,state:r.state,title:r.content.title,summary:r.content.summary,hypothesis:r.content.hypothesis,next_test:r.content.next_test,limitations:r.content.limitations,evidence_count:r.content.evidence_ids.length,applicability:r.applicability,created_at:r.created_at}));
  const generation_activity=(await db.query(`SELECT kind,count(*)::int AS requested,count(*) FILTER(WHERE status='succeeded')::int AS completed,count(*) FILTER(WHERE status='unknown')::int AS uncertain
   FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind IN ('creative.generate','creative.video','plan.generate','insight.generate') AND created_at>now()-interval '30 days' GROUP BY kind ORDER BY kind`,scope)).rows;
  const upcoming_posts=(await db.query(`SELECT s.id,s.channel,s.format,s.creative_spec,s.hook,s.brief,s.state,s.planned_at,
    p.timezone,p.starts_on::text,p.title AS plan_title,v.design,s.video_version_id,s.carousel_version_id,
    COALESCE(v.project_id,vv.project_id,cv.project_id) AS project_id,
    latest.status AS generation_status
    FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id
    LEFT JOIN app.creative_versions v ON v.id=s.creative_version_id
    LEFT JOIN app.video_versions vv ON vv.id=s.video_version_id
    LEFT JOIN app.carousel_versions cv ON cv.id=s.carousel_version_id
    LEFT JOIN LATERAL (
      SELECT j.status FROM app.jobs j WHERE j.id IN (
        SELECT g.job_id FROM app.content_slot_generations g WHERE g.slot_id=s.id
        UNION ALL SELECT r.job_id FROM app.video_requests r WHERE r.slot_id=s.id
        UNION ALL SELECT r.job_id FROM app.content_slot_carousel_generations r WHERE r.slot_id=s.id
      ) ORDER BY j.created_at DESC,j.id DESC LIMIT 1
    ) latest ON true
    WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.state<>'cancelled'
      AND (s.planned_at AT TIME ZONE p.timezone)::date >= (now() AT TIME ZONE p.timezone)::date
      AND NOT ${PUBLISHED_SLOT}
    ORDER BY s.planned_at,s.id LIMIT 6`,[b.organization_id,brand])).rows;
  const campaigns=(await db.query(`SELECT p.id,p.title,p.starts_on::text,
    (p.starts_on+p.duration_days-1)::text AS ends_on,
    count(s.id)::int AS post_count,
    count(s.id) FILTER(WHERE s.state='pending_review')::int AS awaiting_review,
    count(s.id) FILTER(WHERE s.state='approved')::int AS approved_count
    FROM app.content_plans p LEFT JOIN app.content_slots s ON s.plan_id=p.id AND s.state<>'cancelled'
    WHERE p.organization_id=$1 AND p.brand_id=$2
      AND p.starts_on+p.duration_days > (now() AT TIME ZONE p.timezone)::date
    GROUP BY p.id ORDER BY p.starts_on,p.id LIMIT 6`,[b.organization_id,brand])).rows;
  return {business_id:brand,campaigns,counts,activity,performance,recommendations,generation_activity,upcoming_posts,checked_at:new Date().toISOString(),analytics_available:performance.available_count>0};
 },brand);}
}
