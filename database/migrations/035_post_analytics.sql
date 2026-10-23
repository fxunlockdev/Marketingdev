-- Append-only observations collected by the existing durable publication check.
CREATE TABLE app.post_analytics (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,publication_id uuid NOT NULL,job_id uuid NOT NULL,
 provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
 state text NOT NULL CHECK(state IN ('available','unavailable','missing','error')),
 semantics text NOT NULL DEFAULT 'provider_reported' CHECK(semantics IN ('provider_reported','lifetime')),
 series jsonb NOT NULL CHECK(jsonb_typeof(series)='array' AND octet_length(series::text)<=200000),
 error_code text CHECK(length(error_code)<=100),collected_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,publication_id) REFERENCES app.publication_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX post_analytics_history ON app.post_analytics(organization_id,brand_id,publication_id,collected_at DESC);
ALTER TABLE app.post_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.post_analytics FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.post_analytics TO desvio_app,desvio_worker;
GRANT INSERT ON app.post_analytics TO desvio_worker;
CREATE POLICY scoped_read ON app.post_analytics FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY worker_read ON app.post_analytics FOR SELECT TO desvio_worker USING(app.publication_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.job_id=publication_id));
CREATE POLICY worker_append ON app.post_analytics FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.publication_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.job_id=publication_id AND r.phase='accepted' AND r.remote_post_id IS NOT NULL));
