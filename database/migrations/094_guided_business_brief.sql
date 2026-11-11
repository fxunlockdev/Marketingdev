-- Research snapshots are immutable job inputs; applications cannot update a submitted request.
ALTER TABLE app.intake_requests ADD COLUMN research_context jsonb
 CHECK(research_context IS NULL OR (jsonb_typeof(research_context)='object' AND octet_length(research_context::text)<=20000));
CREATE TABLE app.guided_business_briefs (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 brief jsonb NOT NULL CHECK(jsonb_typeof(brief)='object' AND octet_length(brief::text)<=20000),
 step smallint NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4),
 research_job_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,research_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.guided_business_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guided_business_briefs FORCE ROW LEVEL SECURITY;
CREATE POLICY guided_read ON app.guided_business_briefs FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY guided_insert ON app.guided_business_briefs FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY guided_update ON app.guided_business_briefs FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
GRANT SELECT,INSERT ON app.guided_business_briefs TO desvio_app;
GRANT UPDATE(revision,brief,step,research_job_id,updated_at) ON app.guided_business_briefs TO desvio_app;
