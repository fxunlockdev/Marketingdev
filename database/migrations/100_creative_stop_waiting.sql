-- A deliberate local abandonment never clears provider reservations or retries a call.
CREATE FUNCTION app.stop_waiting_for_creative(target uuid, acknowledge_possible_charge boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE request app.jobs%ROWTYPE; child app.jobs%ROWTYPE;
BEGIN
 IF acknowledge_possible_charge IS DISTINCT FROM true THEN RAISE EXCEPTION 'Acknowledge the uncertain provider charge' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant()::text,0));
 SELECT * INTO request FROM app.jobs WHERE id=target AND organization_id=app.tenant() AND app.brand_matches(brand_id);
 IF NOT FOUND OR app.can_access(request.organization_id,true) IS NOT TRUE OR app.business_access(request.organization_id,request.brand_id,true) IS NOT TRUE OR request.kind NOT IN ('creative.generate','carousel.generate') THEN
  RAISE EXCEPTION 'Creative request unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('canvas:'||request.brand_id::text,0));
 SELECT * INTO request FROM app.jobs WHERE id=target FOR UPDATE;
 IF request.status='canceled' AND request.error_code='CREATIVE_RESULT_ABANDONED' THEN RETURN 'canceled'; END IF;
 IF request.status<>'unknown' THEN RAISE EXCEPTION 'Only an uncertain finished request can be abandoned' USING ERRCODE='22023'; END IF;
 -- Children must be handled through their parent, so one slide cannot unlock a running carousel.
 IF EXISTS(SELECT 1 FROM app.carousel_children WHERE generation_job_id=target OR export_job_id=target) THEN
  RAISE EXCEPTION 'Stop waiting for the whole carousel instead' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM app.creative_requests WHERE job_id=target AND output_version_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM app.carousel_requests WHERE job_id=target AND output_version_id IS NOT NULL) THEN
  RAISE EXCEPTION 'A saved result is available; refresh to review it' USING ERRCODE='22023';
 END IF;
 FOR child IN SELECT j.* FROM app.jobs j JOIN app.carousel_children c ON j.id IN(c.generation_job_id,c.export_job_id)
 WHERE c.parent_job_id=target ORDER BY j.id FOR UPDATE OF j LOOP
  IF child.status IN('queued','running','retrying') THEN RAISE EXCEPTION 'Carousel work is still active; wait for it to finish' USING ERRCODE='22023'; END IF;
  IF child.status='unknown' THEN
   UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='CREATIVE_RESULT_ABANDONED',updated_at=now() WHERE id=child.id;
  END IF;
 END LOOP;
 UPDATE app.carousel_requests SET canceled=true WHERE job_id=target;
 UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='CREATIVE_RESULT_ABANDONED',updated_at=now() WHERE id=target;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
 VALUES(request.organization_id,request.brand_id,app.actor(),'creative.unknown_result_abandoned',target);
 RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION app.stop_waiting_for_creative(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stop_waiting_for_creative(uuid,boolean) TO desvio_app;
