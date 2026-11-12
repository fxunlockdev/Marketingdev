-- The image generator applies the customer's locked mood board to every static and
-- carousel slide. The worker may read only an approved board, only while running an
-- image generation job for that same business. It cannot write.
GRANT SELECT ON app.guided_moodboards TO desvio_worker;
CREATE POLICY moodboard_creative_read ON app.guided_moodboards FOR SELECT TO desvio_worker
 USING(app.creative_scope(organization_id,brand_id) AND approved_at IS NOT NULL);

-- Allow a true 4:5 portrait still (1024x1280, cropped from the provider's 1024x1536).
ALTER TABLE app.creative_media DROP CONSTRAINT creative_media_canonical_dimensions;
ALTER TABLE app.creative_media ADD CONSTRAINT creative_media_canonical_dimensions
 CHECK((width IN (1024,1536) AND height IN (1024,1536)) OR (width=1080 AND height=1920) OR (width=1024 AND height=1280));
