-- Recovery is a new read-only provider-check job; original outcomes stay immutable.
CREATE TABLE app.intake_recoveries (
 job_id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 source_job_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(job_id<>source_job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,source_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX intake_recovery_source ON app.intake_recoveries(source_job_id);
ALTER TABLE app.intake_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.intake_recoveries FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.intake_recoveries TO desvio_app;
CREATE POLICY recovery_read ON app.intake_recoveries FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY recovery_create ON app.intake_recoveries FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=intake_recoveries.job_id AND kind='website.extract' AND requested_by=app.actor() AND status='queued')
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=source_job_id AND kind='website.extract' AND status='unknown' AND NOT cancel_requested));
GRANT SELECT ON app.intake_recoveries TO desvio_worker;
CREATE POLICY recovery_work ON app.intake_recoveries FOR SELECT TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
-- Provider identifiers remain server-only; customer responses expose only eligibility.
GRANT SELECT ON app.website_capture_calls TO desvio_app;
CREATE POLICY capture_recovery_eligibility ON app.website_capture_calls FOR SELECT TO desvio_app
 USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY recovery_source_checkpoint ON app.website_capture_calls FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract') AND EXISTS(
 SELECT 1 FROM app.intake_recoveries r WHERE r.job_id=app.job_context() AND r.source_job_id=website_capture_calls.job_id));
