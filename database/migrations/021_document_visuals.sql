CREATE TABLE app.document_visuals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,source_id uuid NOT NULL,job_id uuid NOT NULL,
 page integer NOT NULL CHECK(page BETWEEN 1 AND 50),parser_version text NOT NULL,
 object_key text NOT NULL CHECK(object_key LIKE 'evidence/'||organization_id::text||'/'||brand_id::text||'/documents/%'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 2097152),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2000),height integer NOT NULL CHECK(height BETWEEN 1 AND 2000),
 captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(source_id,page,parser_version),
 FOREIGN KEY(organization_id,brand_id,source_id) REFERENCES app.brand_sources(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.document_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_visuals FORCE ROW LEVEL SECURITY;
CREATE POLICY document_visual_read ON app.document_visuals FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY worker_document_visual_read ON app.document_visuals FOR SELECT TO desvio_worker USING(app.document_scope(organization_id,brand_id) OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY worker_document_visual_insert ON app.document_visuals FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.document_scope(organization_id,brand_id)
 AND EXISTS(SELECT 1 FROM app.brand_sources s JOIN app.jobs j ON j.id=app.job_context() WHERE s.id=source_id AND s.kind='document' AND s.asset_id=j.asset_id AND s.parser_version=document_visuals.parser_version));
GRANT SELECT ON app.document_visuals TO desvio_app;
GRANT SELECT,INSERT ON app.document_visuals TO desvio_worker;
