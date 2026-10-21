CREATE TABLE app.website_visuals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,source_id uuid NOT NULL,job_id uuid NOT NULL,
 viewport text NOT NULL CHECK(viewport IN ('desktop','mobile')),parser_version text NOT NULL,
 object_key text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 6291456),
 width integer NOT NULL CHECK(width IN (1440,390)),height integer NOT NULL CHECK(height BETWEEN 1 AND 16000),
 observations jsonb NOT NULL CHECK(octet_length(observations::text)<=200000),coverage jsonb NOT NULL CHECK(octet_length(coverage::text)<=64000),captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(source_id,viewport,parser_version),
 FOREIGN KEY(organization_id,brand_id,source_id) REFERENCES app.brand_sources(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.website_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.website_visuals FORCE ROW LEVEL SECURITY;
CREATE POLICY visual_read ON app.website_visuals FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
GRANT SELECT ON app.website_visuals TO desvio_app;
CREATE POLICY worker_visual_read ON app.website_visuals FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY worker_visual_insert ON app.website_visuals FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
GRANT SELECT,INSERT ON app.website_visuals TO desvio_worker;
