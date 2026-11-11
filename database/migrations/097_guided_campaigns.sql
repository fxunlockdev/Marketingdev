CREATE TABLE app.guided_campaigns (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,moodboard_id uuid NOT NULL,
 planning_job_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES auth."user"(id),
 request_key text NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 generation_started_at timestamptz,last_error text,attempted_at timestamptz,generation_request jsonb,planning_request jsonb NOT NULL,
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,moodboard_id) REFERENCES app.guided_moodboards(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,planning_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.guided_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guided_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY guided_campaign_read ON app.guided_campaigns FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY guided_campaign_create ON app.guided_campaigns FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor());
CREATE POLICY guided_campaign_update ON app.guided_campaigns FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY guided_campaign_operator ON app.guided_campaigns TO CURRENT_USER USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON app.guided_campaigns TO desvio_app;
GRANT UPDATE(generation_started_at,last_error,attempted_at,generation_request,planning_job_id) ON app.guided_campaigns TO desvio_app;
-- Server-only queue scan; mutations subsequently recheck the initiating member's access.
CREATE FUNCTION app.pending_guided_campaigns() RETURNS TABLE(id uuid,brand_id uuid,created_by uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT g.id,g.brand_id,g.created_by FROM app.guided_campaigns g JOIN app.jobs j ON j.id=g.planning_job_id
 WHERE g.generation_started_at IS NULL AND g.last_error IS NULL AND j.status='succeeded'
 AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=g.organization_id AND m.user_id=g.created_by AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin','editor')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=g.organization_id AND bm.brand_id=g.brand_id AND bm.user_id=g.created_by AND bm.active AND bm.role IN ('admin','editor')))))
 AND (g.attempted_at IS NULL OR g.attempted_at<now()-interval '30 seconds') ORDER BY g.created_at LIMIT 10
$$;
REVOKE ALL ON FUNCTION app.pending_guided_campaigns() FROM PUBLIC,desvio_worker;
GRANT EXECUTE ON FUNCTION app.pending_guided_campaigns() TO desvio_app;
