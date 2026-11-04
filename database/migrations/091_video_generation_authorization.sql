-- A deliberate Generate action authorizes the skill-planned video for this request.
-- Existing requests retain their explicit script-review workflow.
ALTER TABLE app.video_requests ADD COLUMN generation_authorized_by uuid REFERENCES auth."user"(id);
CREATE POLICY generation_authorization ON app.video_requests AS RESTRICTIVE FOR INSERT TO desvio_app
 WITH CHECK(generation_authorized_by IS NULL OR (generation_authorized_by=app.actor() AND app.creative_reviewer(organization_id,brand_id)));
GRANT UPDATE(approved_brief,approved_revision,approved_by,approved_at) ON app.video_requests TO desvio_worker;
CREATE FUNCTION app.protect_video_skill_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='desvio_worker' AND ROW(NEW.approved_brief,NEW.approved_revision,NEW.approved_by,NEW.approved_at) IS DISTINCT FROM ROW(OLD.approved_brief,OLD.approved_revision,OLD.approved_by,OLD.approved_at) THEN
  IF NEW.generation_authorized_by IS NULL OR NEW.approved_by IS DISTINCT FROM NEW.generation_authorized_by
   OR OLD.approved_brief IS NOT NULL OR NEW.edited_brief IS NOT NULL OR NEW.draft_revision<>1
   OR NEW.approved_revision IS DISTINCT FROM NEW.draft_revision OR NEW.approved_at IS NULL
   OR NEW.plan->'brief' IS NULL OR NEW.approved_brief IS DISTINCT FROM NEW.plan->'brief'
   OR NOT EXISTS(SELECT 1 FROM app.jobs j JOIN app.memberships m ON m.organization_id=j.organization_id AND m.user_id=j.requested_by
    WHERE j.id=NEW.job_id AND j.requested_by=NEW.generation_authorized_by AND NOT j.cancel_requested AND j.status IN ('queued','running','retrying') AND m.active
    AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=j.organization_id AND b.brand_id=j.brand_id AND b.user_id=j.requested_by AND b.active AND b.role='admin'))))
  THEN RAISE EXCEPTION 'VIDEO_GENERATION_AUTHORIZATION_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.protect_video_skill_approval() FROM PUBLIC;
CREATE TRIGGER protect_video_skill_approval BEFORE UPDATE ON app.video_requests FOR EACH ROW EXECUTE FUNCTION app.protect_video_skill_approval();

-- Keep the customer publication guard out of worker-owned attachment updates.
-- SQL boolean expressions need not short-circuit before checking function rights.
CREATE OR REPLACE FUNCTION app.protect_published_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF current_user='desvio_app' THEN
  IF (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') AND app.slot_has_publication(OLD.id) THEN
   RAISE EXCEPTION 'Resolve the existing publication before changing this post' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
