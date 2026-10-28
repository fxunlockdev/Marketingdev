-- Provider IDs belong to one job and are never part of the customer intake response.
CREATE TABLE app.website_capture_calls (
 job_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 checkpoint jsonb NOT NULL CHECK(octet_length(checkpoint::text)<=2000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 CHECK(checkpoint->>'phase' IN ('creating','created','submitting','polling'))
);
ALTER TABLE app.website_capture_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.website_capture_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY capture_job_scope ON app.website_capture_calls TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'))
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
GRANT SELECT,INSERT ON app.website_capture_calls TO desvio_worker;
GRANT UPDATE(checkpoint,updated_at) ON app.website_capture_calls TO desvio_worker;
-- Provider viewport dimensions are preserved without falsely labelling mobile/desktop.
ALTER TABLE app.website_visuals DROP CONSTRAINT website_visuals_viewport_check;
ALTER TABLE app.website_visuals ADD CONSTRAINT website_visuals_viewport_check CHECK(viewport IN ('desktop','mobile','visible','fullpage'));
ALTER TABLE app.website_visuals DROP CONSTRAINT website_visuals_width_check;
ALTER TABLE app.website_visuals ADD CONSTRAINT website_visuals_width_check CHECK(width BETWEEN 1 AND 8192);
ALTER TABLE app.website_visuals DROP CONSTRAINT website_visuals_height_check;
ALTER TABLE app.website_visuals ADD CONSTRAINT website_visuals_height_check CHECK(height BETWEEN 1 AND 65536 AND width::bigint*height<=64000000);
