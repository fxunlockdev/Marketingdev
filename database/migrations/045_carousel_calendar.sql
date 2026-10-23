ALTER TABLE app.carousel_versions ADD UNIQUE(organization_id,brand_id,id,sha256);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.content_slots'::regclass AND contype='c'
 AND ((pg_get_constraintdef(oid) LIKE '%format%' AND pg_get_constraintdef(oid) NOT LIKE '%video_draft%') OR (pg_get_constraintdef(oid) LIKE '%state%' AND pg_get_constraintdef(oid) LIKE '%creative_version_id%')) LOOP
 EXECUTE format('ALTER TABLE app.content_slots DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.content_slots
 ADD COLUMN carousel_version_id uuid, ADD COLUMN carousel_sha256 text,
 ADD CHECK(format IN ('static','ad','video','carousel')),
 ADD CHECK((carousel_version_id IS NULL)=(carousel_sha256 IS NULL)),
 ADD CHECK((format='video' AND creative_version_id IS NULL AND carousel_version_id IS NULL) OR (format='carousel' AND creative_version_id IS NULL AND video_version_id IS NULL) OR (format IN ('static','ad') AND video_version_id IS NULL AND carousel_version_id IS NULL)),
 ADD CHECK(state IN ('content_needed','cancelled') OR num_nonnulls(creative_version_id,video_version_id,carousel_version_id)=1),
 ADD FOREIGN KEY(organization_id,brand_id,carousel_version_id,carousel_sha256) REFERENCES app.carousel_versions(organization_id,brand_id,id,sha256);
ALTER TABLE app.content_slot_events
 ADD COLUMN carousel_version_id uuid, ADD COLUMN carousel_sha256 text,
 ADD CHECK((carousel_version_id IS NULL)=(carousel_sha256 IS NULL)),
 ADD CHECK(num_nonnulls(creative_version_id,video_version_id,carousel_version_id)<=1),
 ADD FOREIGN KEY(organization_id,brand_id,carousel_version_id,carousel_sha256) REFERENCES app.carousel_versions(organization_id,brand_id,id,sha256);
GRANT UPDATE(carousel_version_id,carousel_sha256) ON app.content_slots TO desvio_app;
