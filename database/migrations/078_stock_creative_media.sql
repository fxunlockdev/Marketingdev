-- Imported photos create versioned media, never pretend to be an AI generation job.
ALTER TABLE app.creative_media ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE app.creative_media ADD COLUMN source_uploaded_visual_id uuid,
 ADD FOREIGN KEY(organization_id,brand_id,source_uploaded_visual_id) REFERENCES app.uploaded_visuals(organization_id,brand_id,id),
 ADD CONSTRAINT creative_media_origin CHECK((job_id IS NOT NULL AND source_uploaded_visual_id IS NULL) OR (job_id IS NULL AND source_uploaded_visual_id IS NOT NULL));
GRANT INSERT ON app.creative_media TO desvio_app;
CREATE POLICY stock_media_insert ON app.creative_media FOR INSERT TO desvio_app WITH CHECK(
 app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND job_id IS NULL AND source_uploaded_visual_id IS NOT NULL
 AND object_key='creative-stock/'||organization_id::text||'/'||brand_id::text||'/'||source_uploaded_visual_id::text||'/'||width::text||'x'||height::text||'/'||sha256
 AND EXISTS(SELECT 1 FROM app.uploaded_visuals u JOIN app.stock_imports s ON s.asset_id=u.asset_id
  JOIN app.brand_references r ON r.uploaded_visual_id=u.id
  WHERE u.id=source_uploaded_visual_id AND u.organization_id=creative_media.organization_id AND u.brand_id=creative_media.brand_id
   AND s.organization_id=u.organization_id AND s.brand_id=u.brand_id AND r.revoked_at IS NULL));
