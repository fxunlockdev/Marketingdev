CREATE TABLE app.uploaded_visuals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,asset_id uuid NOT NULL UNIQUE,job_id uuid NOT NULL,
 object_key text NOT NULL UNIQUE,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 6291456),width integer NOT NULL CHECK(width BETWEEN 1 AND 3072),height integer NOT NULL CHECK(height BETWEEN 1 AND 3072),
 captured_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,asset_id) REFERENCES app.assets(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.uploaded_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.uploaded_visuals FORCE ROW LEVEL SECURITY;
CREATE POLICY uploaded_visual_read ON app.uploaded_visuals FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.assets a WHERE a.id=asset_id AND a.state='ready'));
CREATE POLICY uploaded_visual_worker_read ON app.uploaded_visuals FOR SELECT TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'asset.validate'));
CREATE POLICY uploaded_visual_worker_insert ON app.uploaded_visuals FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'asset.validate') AND EXISTS(SELECT 1 FROM app.assets a JOIN app.jobs j ON j.asset_id=a.id WHERE j.id=job_id AND a.id=uploaded_visuals.asset_id AND a.sha256=source_sha256 AND a.state='validating' AND a.content_type IN ('image/png','image/jpeg','image/webp')));
GRANT SELECT ON app.uploaded_visuals TO desvio_app;
GRANT SELECT,INSERT ON app.uploaded_visuals TO desvio_worker;
ALTER TABLE app.brand_references ADD COLUMN uploaded_visual_id uuid,
 ADD COLUMN crop jsonb CHECK(crop IS NULL OR jsonb_typeof(crop)='object' AND octet_length(crop::text)<=200),
 ADD FOREIGN KEY(organization_id,brand_id,uploaded_visual_id) REFERENCES app.uploaded_visuals(organization_id,brand_id,id);
ALTER TABLE app.brand_references DROP CONSTRAINT brand_references_check;
ALTER TABLE app.brand_references ADD CHECK(num_nonnulls(website_visual_id,document_visual_id,uploaded_visual_id)=1);
CREATE UNIQUE INDEX active_uploaded_reference ON app.brand_references(brand_id,uploaded_visual_id) WHERE revoked_at IS NULL;
CREATE POLICY worker_reference_upload ON app.uploaded_visuals FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.brand_references r WHERE r.uploaded_visual_id=uploaded_visuals.id));
