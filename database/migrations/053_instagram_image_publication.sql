-- Permit approved single-image Instagram requests; carousel approval follows separately.
DO $$ DECLARE n text; BEGIN
 SELECT conname INTO STRICT n FROM pg_constraint WHERE conrelid='app.publication_requests'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%provider%linkedin%video_version_id%export_id%carousel_version_id%';
 EXECUTE format('ALTER TABLE app.publication_requests DROP CONSTRAINT %I',n);
END $$;
ALTER TABLE app.publication_requests ADD CONSTRAINT instagram_media_kind CHECK(provider='linkedin' OR carousel_version_id IS NULL);
CREATE POLICY instagram_image_format ON app.publication_requests AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(
 provider<>'instagram-standalone' OR export_id IS NULL OR EXISTS(SELECT 1 FROM app.creative_exports e WHERE e.id=export_id AND e.organization_id=publication_requests.organization_id AND e.brand_id=publication_requests.brand_id AND e.format='instagram-jpeg')
);
