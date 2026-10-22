-- Explicit human decisions on immutable, tenant-scoped visual analysis evidence.
CREATE TABLE app.brand_visual_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,analysis_job_id uuid NOT NULL,
 suggestion_index integer NOT NULL CHECK(suggestion_index BETWEEN 0 AND 11),
 suggestion jsonb NOT NULL CHECK(jsonb_typeof(suggestion)='object' AND octet_length(suggestion::text)<=12000),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='array' AND octet_length(manifest::text)<=100000),
 status text NOT NULL CHECK(status IN ('correct','wrong','edited')),
 value text NOT NULL CHECK(length(value) BETWEEN 1 AND 1500),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reviewed_by uuid NOT NULL REFERENCES auth."user"(id),reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,analysis_job_id,suggestion_index),
 FOREIGN KEY(organization_id,brand_id,analysis_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.brand_visual_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brand_visual_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY visual_review_read ON app.brand_visual_reviews FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY visual_review_insert ON app.brand_visual_reviews FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND reviewed_by=app.actor() AND revision=1 AND EXISTS(
 SELECT 1 FROM app.intake_requests r JOIN app.jobs j ON j.id=r.job_id
 WHERE r.organization_id=brand_visual_reviews.organization_id AND r.brand_id=brand_visual_reviews.brand_id
 AND r.job_id=analysis_job_id AND j.kind='brand.analyze' AND j.status='succeeded'
 AND r.result->'visual_guidance'->suggestion_index=suggestion AND r.result->'visual_manifest'=manifest));
CREATE POLICY visual_review_update ON app.brand_visual_reviews FOR UPDATE TO desvio_app
 USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true))
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND reviewed_by=app.actor());
GRANT SELECT,INSERT ON app.brand_visual_reviews TO desvio_app;
GRANT UPDATE(status,value,revision,reviewed_by,reviewed_at) ON app.brand_visual_reviews TO desvio_app;
