ALTER TABLE app.publication_requests ALTER COLUMN export_id DROP NOT NULL,ALTER COLUMN image_sha256 DROP NOT NULL,
 ADD COLUMN video_version_id uuid,ADD COLUMN video_sha256 text CHECK(video_sha256 ~ '^[a-f0-9]{64}$'),
 ADD FOREIGN KEY(organization_id,brand_id,video_version_id) REFERENCES app.video_versions(organization_id,brand_id,id),
 ADD CHECK((export_id IS NOT NULL AND image_sha256 IS NOT NULL AND video_version_id IS NULL AND video_sha256 IS NULL) OR (export_id IS NULL AND image_sha256 IS NULL AND video_version_id IS NOT NULL AND video_sha256 IS NOT NULL));
GRANT SELECT(video_version_id,video_sha256),INSERT(video_version_id,video_sha256) ON app.publication_requests TO desvio_app;
CREATE POLICY publication_video ON app.video_versions FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.video_version_id=video_versions.id));
CREATE POLICY publication_video_project ON app.video_projects FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.video_versions v WHERE v.project_id=video_projects.id));
CREATE POLICY publication_video_request ON app.video_requests FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.video_versions v WHERE v.job_id=video_requests.job_id));
CREATE POLICY publication_video_review ON app.video_reviews FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.video_versions v WHERE v.id=video_reviews.version_id));
CREATE POLICY publication_slot_review ON app.content_slot_events FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.slot_id=content_slot_events.slot_id));
GRANT SELECT ON app.video_reviews TO desvio_worker;
