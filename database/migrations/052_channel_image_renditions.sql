-- Separate immutable output formats share the existing scoped export/job/approval lifecycle.
ALTER TABLE app.creative_export_requests ADD COLUMN format text NOT NULL DEFAULT 'png' CHECK(format IN ('png','instagram-jpeg'));
ALTER TABLE app.creative_exports ADD COLUMN format text NOT NULL DEFAULT 'png' CHECK(format IN ('png','instagram-jpeg'));
DO $$ DECLARE old_name text; BEGIN
 SELECT conname INTO STRICT old_name FROM pg_constraint WHERE conrelid='app.creative_exports'::regclass AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (organization_id, brand_id, version_id, renderer_image)';
 EXECUTE format('ALTER TABLE app.creative_exports DROP CONSTRAINT %I',old_name);
END $$;
ALTER TABLE app.creative_exports ADD UNIQUE(organization_id,brand_id,version_id,renderer_image,format);
ALTER TABLE app.creative_exports DROP CONSTRAINT creative_exports_width_check;
ALTER TABLE app.creative_exports DROP CONSTRAINT creative_exports_height_check;
ALTER TABLE app.creative_exports ADD CHECK((format='png' AND width IN (1024,1536) AND height IN (1024,1536)) OR (format='instagram-jpeg' AND width=1080 AND height=1080 AND bytes<=8388608));
CREATE POLICY export_format_create ON app.creative_exports AS RESTRICTIVE FOR INSERT TO desvio_worker WITH CHECK(EXISTS(
 SELECT 1 FROM app.creative_export_requests r WHERE r.job_id=app.job_context() AND r.format=creative_exports.format
));
