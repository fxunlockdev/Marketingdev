ALTER TABLE app.content_slot_events DROP CONSTRAINT content_slot_events_action_check;
ALTER TABLE app.content_slot_events ADD CHECK(action IN ('created','edited','pending_review','approved','changes_requested','rejected','cancelled','generation_requested','creative_attached','review_reopened'));
DROP POLICY event_append ON app.content_slot_events;
CREATE POLICY event_append ON app.content_slot_events FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND actor_id=app.actor() AND ((app.business_access(organization_id,brand_id,true) AND action NOT IN ('approved','rejected','changes_requested','review_reopened')) OR (action IN ('approved','rejected','changes_requested','review_reopened') AND app.creative_reviewer(organization_id,brand_id))));
CREATE OR REPLACE FUNCTION app.limit_review_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE fields text[];
BEGIN
 IF current_user<>'desvio_app' THEN RETURN NEW; END IF;
 IF NOT app.business_access(OLD.organization_id,OLD.brand_id,true) THEN
  IF NOT app.review_access(OLD.organization_id,OLD.brand_id) THEN RAISE EXCEPTION 'Review access required' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='content_slots' THEN
   fields:=ARRAY['state','revision','approved_by','approved_at','updated_at'];
   IF NOT ((OLD.state='pending_review' AND NEW.state IN ('approved','rejected','changes_requested')) OR (OLD.state IN ('approved','rejected','changes_requested') AND NEW.state='pending_review' AND NEW.approved_by IS NULL AND NEW.approved_at IS NULL AND NOT EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.slot_id=OLD.id AND r.phase NOT IN ('rejected','canceled')))) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='42501'; END IF;
  ELSE
   fields:=ARRAY['status','review_revision','reviewed_by','reviewed_at'];
   IF OLD.status<>'in_review' OR NEW.status NOT IN ('approved','rejected','changes_requested') OR NEW.review_revision<>OLD.review_revision+1 THEN RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='42501'; END IF;
  END IF;
  IF (to_jsonb(NEW)-fields) IS DISTINCT FROM (to_jsonb(OLD)-fields) THEN RAISE EXCEPTION 'Review cannot change content' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
