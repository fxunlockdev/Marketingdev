-- New monthly plans require explicit review before paid production.
-- Existing generated media and its approval history are unchanged.
ALTER TABLE app.guided_campaigns ADD COLUMN plan_approved_at timestamptz,
 ADD COLUMN plan_approved_by uuid REFERENCES auth."user"(id),
 ADD COLUMN approved_slots jsonb;
GRANT UPDATE(plan_approved_at,plan_approved_by,approved_slots) ON app.guided_campaigns TO desvio_app;
CREATE OR REPLACE FUNCTION app.pending_guided_campaigns() RETURNS TABLE(id uuid,brand_id uuid,created_by uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT g.id,g.brand_id,g.created_by FROM app.guided_campaigns g JOIN app.jobs j ON j.id=g.planning_job_id
 WHERE g.plan_approved_at IS NOT NULL AND g.generation_started_at IS NULL AND g.last_error IS NULL AND j.status='succeeded'
 AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=g.organization_id AND m.user_id=g.created_by AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin','editor')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=g.organization_id AND bm.brand_id=g.brand_id AND bm.user_id=g.created_by AND bm.active AND bm.role IN ('admin','editor')))))
 AND (g.attempted_at IS NULL OR g.attempted_at<now()-interval '30 seconds') ORDER BY g.created_at LIMIT 10
$$;
REVOKE ALL ON FUNCTION app.pending_guided_campaigns() FROM PUBLIC,desvio_worker;
GRANT EXECUTE ON FUNCTION app.pending_guided_campaigns() TO desvio_app;
