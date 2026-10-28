-- API creates both jobs in one transaction; the worker waits durably for capture.
CREATE TABLE app.intake_dependencies (
 organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 analysis_job_id uuid PRIMARY KEY, capture_job_id uuid NOT NULL UNIQUE,
 CHECK(analysis_job_id<>capture_job_id),
 FOREIGN KEY(organization_id,brand_id,analysis_job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,capture_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.intake_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.intake_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY dependency_read ON app.intake_dependencies FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY dependency_create ON app.intake_dependencies FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=analysis_job_id AND kind='brand.analyze' AND requested_by=app.actor() AND status='queued')
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=capture_job_id AND kind='website.extract' AND requested_by=app.actor() AND status='queued'));
GRANT SELECT,INSERT ON app.intake_dependencies TO desvio_app;
CREATE POLICY dependency_worker ON app.intake_dependencies FOR SELECT TO desvio_worker
 USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND analysis_job_id=app.job_context());
GRANT SELECT ON app.intake_dependencies TO desvio_worker;
-- Read only the capture prerequisite of the current analysis; no write permission.
CREATE POLICY intake_parent_read ON app.jobs FOR SELECT TO desvio_worker
 USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND EXISTS(
 SELECT 1 FROM app.intake_dependencies d WHERE d.analysis_job_id=app.job_context() AND d.capture_job_id=jobs.id));
