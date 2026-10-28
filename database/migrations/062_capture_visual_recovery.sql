-- A completed capture with missing visuals can reuse its saved provider run.
-- Recovery remains a new read-only job; no new crawl or model call is authorized.
DROP POLICY recovery_create ON app.intake_recoveries;
CREATE POLICY recovery_create ON app.intake_recoveries FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=intake_recoveries.job_id AND kind='website.extract' AND requested_by=app.actor() AND status='queued')
 AND EXISTS(SELECT 1 FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id
 WHERE j.id=source_job_id AND j.kind='website.extract' AND NOT j.cancel_requested
 AND (j.status='unknown' OR (j.status='succeeded' AND jsonb_array_length(COALESCE(r.result->'visualErrors','[]'::jsonb))>0))));
