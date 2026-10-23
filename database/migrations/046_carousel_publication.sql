DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.publication_requests'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%export_id IS NOT NULL%' LOOP
 EXECUTE format('ALTER TABLE app.publication_requests DROP CONSTRAINT %I',c.conname);END LOOP;
END $$;
ALTER TABLE app.publication_requests ADD COLUMN carousel_version_id uuid,ADD COLUMN carousel_sha256 text,
 ADD FOREIGN KEY(organization_id,brand_id,carousel_version_id,carousel_sha256) REFERENCES app.carousel_versions(organization_id,brand_id,id,sha256),
 ADD CHECK((carousel_version_id IS NULL)=(carousel_sha256 IS NULL)),
 ADD CHECK(num_nonnulls(export_id,video_version_id,carousel_version_id)=1 AND (export_id IS NULL)=(image_sha256 IS NULL) AND (video_version_id IS NULL)=(video_sha256 IS NULL));
GRANT SELECT(carousel_version_id,carousel_sha256),INSERT(carousel_version_id,carousel_sha256) ON app.publication_requests TO desvio_app;
CREATE TABLE app.publication_slides (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,publication_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 9),export_id uuid NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','uploading','uploaded')),remote_media jsonb CHECK(octet_length(remote_media::text)<=4096),
 PRIMARY KEY(publication_id,position),UNIQUE(publication_id,export_id),
 FOREIGN KEY(organization_id,brand_id,publication_id) REFERENCES app.publication_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,export_id) REFERENCES app.creative_exports(organization_id,brand_id,id),
 CHECK((phase='uploaded')=(remote_media IS NOT NULL))
);
ALTER TABLE app.publication_slides ENABLE ROW LEVEL SECURITY;ALTER TABLE app.publication_slides FORCE ROW LEVEL SECURITY;
GRANT INSERT(organization_id,brand_id,publication_id,position,export_id,sha256) ON app.publication_slides TO desvio_app;
GRANT SELECT ON app.publication_slides TO desvio_worker;
GRANT UPDATE(phase,remote_media) ON app.publication_slides TO desvio_worker;
CREATE POLICY slide_create ON app.publication_slides FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.job_id=publication_id AND r.carousel_version_id IS NOT NULL AND r.phase='queued'));
CREATE POLICY slide_worker_read ON app.publication_slides FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND publication_id=app.job_context());
CREATE POLICY slide_worker_update ON app.publication_slides FOR UPDATE TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND publication_id=app.job_context()) WITH CHECK(app.intake_scope(organization_id,brand_id,'social.publish') AND publication_id=app.job_context());
GRANT SELECT ON app.carousel_versions,app.carousel_projects,app.carousel_pages,app.carousel_reviews TO desvio_worker;
CREATE POLICY publication_carousel ON app.carousel_versions FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.carousel_version_id=carousel_versions.id));
CREATE POLICY publication_carousel_project ON app.carousel_projects FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.project_id=carousel_projects.id));
CREATE POLICY publication_carousel_pages ON app.carousel_pages FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.carousel_version_id=carousel_pages.carousel_version_id));
CREATE POLICY publication_carousel_review ON app.carousel_reviews FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.carousel_version_id=carousel_reviews.version_id));
CREATE POLICY publication_carousel_export ON app.creative_exports FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_slides s WHERE s.export_id=creative_exports.id));
