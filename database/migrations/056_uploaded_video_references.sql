-- Bind normalized, explicitly approved uploaded product photos without requiring
-- a paid static generation. Existing Canvas export consent remains unchanged.
ALTER TABLE app.video_references
 ADD COLUMN brand_reference_id uuid,
 ALTER COLUMN export_id DROP NOT NULL,
 ALTER COLUMN approval_id DROP NOT NULL,
 ALTER COLUMN version_id DROP NOT NULL,
 ALTER COLUMN project_id DROP NOT NULL,
 ALTER COLUMN review_revision DROP NOT NULL,
 ADD FOREIGN KEY(organization_id,brand_id,brand_reference_id) REFERENCES app.brand_references(organization_id,brand_id,id),
 ADD CONSTRAINT video_reference_source CHECK(
  (brand_reference_id IS NULL AND num_nonnulls(export_id,approval_id,version_id,project_id,review_revision)=5)
  OR (brand_reference_id IS NOT NULL AND num_nonnulls(export_id,approval_id,version_id,project_id,review_revision)=0 AND source_sha256=export_sha256)
 );
CREATE POLICY customer_upload_bind ON app.video_references FOR INSERT TO desvio_app WITH CHECK(
 app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND consented_by=app.actor()
 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='creative.video' AND j.status='queued' AND NOT j.cancel_requested AND j.requested_by=app.actor())
 AND EXISTS(SELECT 1 FROM app.brand_references r JOIN app.uploaded_visuals u ON u.id=r.uploaded_visual_id
 WHERE r.id=video_references.brand_reference_id AND r.revoked_at IS NULL AND r.crop IS NULL
 AND u.width>=64 AND u.height>=64 AND u.sha256=video_references.source_sha256 AND u.sha256=video_references.export_sha256)
);
CREATE POLICY video_reference_brand ON app.brand_references FOR SELECT TO desvio_worker USING(
 app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=app.job_context() AND r.brand_reference_id=brand_references.id)
);
CREATE POLICY video_reference_upload ON app.uploaded_visuals FOR SELECT TO desvio_worker USING(
 app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references v JOIN app.brand_references r ON r.id=v.brand_reference_id WHERE v.job_id=app.job_context() AND r.uploaded_visual_id=uploaded_visuals.id)
);
