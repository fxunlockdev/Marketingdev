-- Keep image/video identities separate; review always binds the exact persisted bytes.
ALTER TABLE app.video_versions ADD UNIQUE(organization_id,brand_id,id,sha256);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.content_slots'::regclass AND contype='c'
 AND (pg_get_constraintdef(oid) LIKE '%format%' OR (pg_get_constraintdef(oid) LIKE '%state%' AND pg_get_constraintdef(oid) LIKE '%creative_version_id%')) LOOP
 EXECUTE format('ALTER TABLE app.content_slots DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.content_slots
 ADD COLUMN video_version_id uuid, ADD COLUMN video_sha256 text,
 ADD CHECK(format IN ('static','ad','video')),
 ADD CHECK((video_version_id IS NULL)=(video_sha256 IS NULL)),
 ADD CHECK((format='video' AND creative_version_id IS NULL) OR (format IN ('static','ad') AND video_version_id IS NULL)),
 ADD CHECK(state IN ('content_needed','cancelled') OR creative_version_id IS NOT NULL OR video_version_id IS NOT NULL),
 ADD FOREIGN KEY(organization_id,brand_id,video_version_id,video_sha256) REFERENCES app.video_versions(organization_id,brand_id,id,sha256);
ALTER TABLE app.content_slot_events
 ADD COLUMN video_version_id uuid, ADD COLUMN video_sha256 text,
 ADD CHECK((video_version_id IS NULL)=(video_sha256 IS NULL)),
 ADD CHECK(video_version_id IS NULL OR creative_version_id IS NULL),
 ADD FOREIGN KEY(organization_id,brand_id,video_version_id,video_sha256) REFERENCES app.video_versions(organization_id,brand_id,id,sha256);
GRANT UPDATE(video_version_id,video_sha256) ON app.content_slots TO desvio_app;
