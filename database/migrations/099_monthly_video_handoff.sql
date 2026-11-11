-- Calendar approval binds the chosen upload to each video concept. Media jobs
-- remain in the existing durable video pipeline and never publish automatically.
ALTER TABLE app.guided_campaigns ADD COLUMN video_references jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN video_error text;
GRANT UPDATE(video_references,video_error) ON app.guided_campaigns TO desvio_app;
CREATE FUNCTION app.pending_monthly_videos() RETURNS TABLE(id uuid,brand_id uuid,approved_by uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT g.id,g.brand_id,g.plan_approved_by FROM app.guided_campaigns g
 WHERE g.generation_started_at IS NOT NULL AND g.video_error IS NULL
 AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=g.organization_id AND m.user_id=g.plan_approved_by AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=g.organization_id AND bm.brand_id=g.brand_id AND bm.user_id=g.plan_approved_by AND bm.active AND bm.role='admin'))))
 AND jsonb_array_length(g.video_references)>0
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.video_references) ref
 WHERE NOT EXISTS(SELECT 1 FROM app.video_requests r WHERE r.organization_id=g.organization_id
 AND r.brand_id=g.brand_id AND (r.request_key='monthly-video:'||g.id::text||':'||(ref->>'id') OR (r.slot_id::text=ref->>'id' AND r.slot_revision>=(ref->>'revision')::integer))))
 ORDER BY g.created_at LIMIT 20
$$;
REVOKE ALL ON FUNCTION app.pending_monthly_videos() FROM PUBLIC,desvio_worker;
GRANT EXECUTE ON FUNCTION app.pending_monthly_videos() TO desvio_app;
