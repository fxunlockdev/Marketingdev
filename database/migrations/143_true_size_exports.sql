-- Stories (1080x1920) and 4:5 posts (1024x1280) are composed at their true size, and the media renderer
-- exports them unpadded: the PNG keeps the design's size and the Instagram rendition is 1080 wide in the
-- design's own shape (1080x1080, 1080x1350 or 1080x1920). The export record now admits exactly those sizes.
DO $$ DECLARE old_name text; BEGIN
 SELECT conname INTO STRICT old_name FROM pg_constraint WHERE conrelid='app.creative_exports'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%instagram-jpeg%' AND pg_get_constraintdef(oid) LIKE '%width%';
 EXECUTE format('ALTER TABLE app.creative_exports DROP CONSTRAINT %I',old_name);
END $$;
ALTER TABLE app.creative_exports ADD CONSTRAINT creative_exports_canonical_dimensions CHECK(
 (format='png' AND ((width IN (1024,1536) AND height IN (1024,1536)) OR (width=1080 AND height=1920) OR (width=1024 AND height=1280)))
 OR (format='instagram-jpeg' AND width=1080 AND height IN (1080,1350,1920) AND bytes<=8388608));
