ALTER TABLE app.creative_projects ADD COLUMN archived_at timestamptz,
 ADD COLUMN archive_revision integer NOT NULL DEFAULT 1 CHECK(archive_revision>0);
GRANT UPDATE(archived_at,archive_revision) ON app.creative_projects TO desvio_app;
CREATE INDEX creative_projects_archive ON app.creative_projects(organization_id,brand_id,archived_at DESC) WHERE archived_at IS NOT NULL;

-- Archived creatives remain readable for history/export, but cannot enter new work.
CREATE FUNCTION app.reject_archived_creative_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project uuid;
BEGIN
 IF TG_TABLE_NAME='creative_requests' OR TG_TABLE_NAME='creative_versions' THEN
  project := NEW.project_id;
 ELSE
  SELECT project_id INTO project FROM app.creative_versions WHERE id=NEW.creative_version_id;
 END IF;
 IF EXISTS(SELECT 1 FROM app.creative_projects WHERE id=project AND archived_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Restore the archived creative before using it' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER active_creative_request BEFORE INSERT ON app.creative_requests FOR EACH ROW EXECUTE FUNCTION app.reject_archived_creative_reference();
CREATE TRIGGER active_creative_version BEFORE INSERT ON app.creative_versions FOR EACH ROW EXECUTE FUNCTION app.reject_archived_creative_reference();
CREATE TRIGGER active_creative_slot BEFORE INSERT OR UPDATE OF creative_version_id ON app.content_slots FOR EACH ROW EXECUTE FUNCTION app.reject_archived_creative_reference();
CREATE TRIGGER active_creative_slide BEFORE INSERT OR UPDATE OF creative_version_id ON app.carousel_pages FOR EACH ROW EXECUTE FUNCTION app.reject_archived_creative_reference();

ALTER TABLE app.video_projects ADD COLUMN archived_at timestamptz,
 ADD COLUMN archive_revision integer NOT NULL DEFAULT 1 CHECK(archive_revision>0);
ALTER TABLE app.carousel_projects ADD COLUMN archived_at timestamptz,
 ADD COLUMN archive_revision integer NOT NULL DEFAULT 1 CHECK(archive_revision>0);
GRANT UPDATE(archived_at,archive_revision) ON app.video_projects,app.carousel_projects TO desvio_app;
CREATE INDEX video_projects_archive ON app.video_projects(organization_id,brand_id,archived_at DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX carousel_projects_archive ON app.carousel_projects(organization_id,brand_id,archived_at DESC) WHERE archived_at IS NOT NULL;
CREATE FUNCTION app.reject_archived_multimedia_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project uuid;
BEGIN
 IF TG_TABLE_NAME IN ('video_versions','video_requests') THEN
  IF EXISTS(SELECT 1 FROM app.video_projects WHERE id=NEW.project_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the archived video before using it' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME IN ('carousel_versions','carousel_requests') THEN
  IF EXISTS(SELECT 1 FROM app.carousel_projects WHERE id=NEW.project_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the archived carousel before using it' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM app.video_versions v JOIN app.video_projects p ON p.id=v.project_id WHERE v.id=NEW.video_version_id AND p.archived_at IS NOT NULL) OR EXISTS(SELECT 1 FROM app.carousel_versions v JOIN app.carousel_projects p ON p.id=v.project_id WHERE v.id=NEW.carousel_version_id AND p.archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the archived creative before using it' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER active_video_request BEFORE INSERT ON app.video_requests FOR EACH ROW EXECUTE FUNCTION app.reject_archived_multimedia_reference();
CREATE TRIGGER active_video_version BEFORE INSERT ON app.video_versions FOR EACH ROW EXECUTE FUNCTION app.reject_archived_multimedia_reference();
CREATE TRIGGER active_carousel_request BEFORE INSERT ON app.carousel_requests FOR EACH ROW EXECUTE FUNCTION app.reject_archived_multimedia_reference();
CREATE TRIGGER active_carousel_version BEFORE INSERT ON app.carousel_versions FOR EACH ROW EXECUTE FUNCTION app.reject_archived_multimedia_reference();
CREATE TRIGGER active_multimedia_slot BEFORE INSERT OR UPDATE OF video_version_id,carousel_version_id ON app.content_slots FOR EACH ROW EXECUTE FUNCTION app.reject_archived_multimedia_reference();
CREATE POLICY project_archive_change ON app.video_projects FOR UPDATE TO desvio_app
 USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true))
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
