-- Stop waiting on an uncertain video or reel. Until now an uncertain video blocked every later
-- video for the business (and the monthly hand-off) with no way out. Releasing it never repeats the
-- paid call and keeps its reservation; the customer acknowledges that a charge may still apply.
-- Shot jobs of a reel are released only through their reel.
CREATE OR REPLACE FUNCTION app.stop_waiting_for_request(target uuid, acknowledge_possible_charge boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE request app.jobs%ROWTYPE; child app.jobs%ROWTYPE;
BEGIN
 IF acknowledge_possible_charge IS DISTINCT FROM true THEN RAISE EXCEPTION 'Acknowledge the uncertain provider charge' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant()::text,0));
 SELECT * INTO request FROM app.jobs WHERE id=target AND organization_id=app.tenant() AND app.brand_matches(brand_id);
 IF NOT FOUND OR app.can_access(request.organization_id,true) IS NOT TRUE OR app.business_access(request.organization_id,request.brand_id,true) IS NOT TRUE
    OR request.kind NOT IN ('website.extract','brand.analyze','plan.generate','blog.generate','creative.video')
    OR EXISTS(SELECT 1 FROM app.reel_shots s WHERE s.job_id=target) THEN
  RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO request FROM app.jobs WHERE id=target FOR UPDATE;
 IF request.status='canceled' AND request.error_code='RESULT_ABANDONED' THEN RETURN 'canceled'; END IF;
 IF request.status<>'unknown' THEN RAISE EXCEPTION 'Only a request with an uncertain result can be abandoned' USING ERRCODE='22023'; END IF;
 IF request.kind='plan.generate' AND EXISTS(SELECT 1 FROM app.planning_requests WHERE job_id=target AND output_plan_id IS NOT NULL) THEN
  RAISE EXCEPTION 'A saved plan is available; refresh to review it' USING ERRCODE='22023';
 END IF;
 -- An automatic analysis waiting on this capture can no longer start.
 FOR child IN SELECT j.* FROM app.jobs j JOIN app.intake_dependencies d ON d.analysis_job_id=j.id
  WHERE d.capture_job_id=target ORDER BY j.id FOR UPDATE OF j LOOP
  IF child.status IN ('running','retrying') THEN RAISE EXCEPTION 'Analysis is still active; wait for it to finish' USING ERRCODE='22023'; END IF;
  IF child.status IN ('queued','unknown') THEN
   UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='RESULT_ABANDONED',updated_at=now() WHERE id=child.id;
  END IF;
 END LOOP;
 -- A video or reel: its provider holds stay counted (a charge may apply), nothing is resubmitted, and
 -- shots that never started are closed so the business can request its next video.
 IF request.kind='creative.video' THEN
  IF EXISTS(SELECT 1 FROM app.video_requests WHERE job_id=target AND output_version_id IS NOT NULL) THEN
   RAISE EXCEPTION 'A saved video is available; refresh to review it' USING ERRCODE='22023';
  END IF;
  UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='RESULT_ABANDONED',updated_at=now()
   WHERE id IN (SELECT job_id FROM app.reel_shots WHERE parent_job_id=target) AND status IN ('queued','unknown');
  IF EXISTS(SELECT 1 FROM app.jobs WHERE id IN (SELECT job_id FROM app.reel_shots WHERE parent_job_id=target) AND status IN ('running','retrying')) THEN
   RAISE EXCEPTION 'A shot is still generating; wait for it to finish' USING ERRCODE='22023';
  END IF;
 END IF;
 -- The article can be generated again; its reserved credit stays counted.
 IF request.kind='blog.generate' THEN
  UPDATE app.campaign_blog_calls SET status='abandoned',error_code='RESULT_ABANDONED' WHERE job_id=target AND status IN ('submitted','unknown');
 END IF;
 UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='RESULT_ABANDONED',updated_at=now() WHERE id=target;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
 VALUES(request.organization_id,request.brand_id,app.actor(),'request.unknown_result_abandoned',target);
 RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION app.stop_waiting_for_request(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stop_waiting_for_request(uuid,boolean) TO desvio_app;
