-- Rescheduling a Post for Me publication moves the post's calendar date too. A published post otherwise stays
-- immutable for the application role: the only change allowed is its planned time (and updated_at), to exactly
-- the time of its single active, accepted Post for Me publication made from this same revision.
CREATE OR REPLACE FUNCTION app.protect_published_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF current_user='desvio_app' THEN
  IF (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') AND app.slot_has_publication(OLD.id) THEN
   IF (to_jsonb(NEW)-'updated_at'-'planned_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'planned_at')
    AND NOT EXISTS(SELECT 1 FROM app.publication_requests WHERE slot_id=OLD.id AND phase NOT IN ('rejected','canceled'))
    AND (SELECT count(*) FROM app.postforme_publications WHERE slot_id=OLD.id AND phase NOT IN ('rejected','canceled'))=1
    AND EXISTS(SELECT 1 FROM app.postforme_publications WHERE slot_id=OLD.id AND phase='accepted' AND revision=OLD.revision AND scheduled_at=NEW.planned_at)
   THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Resolve the existing publication before changing this post' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.protect_published_slot() FROM PUBLIC;
