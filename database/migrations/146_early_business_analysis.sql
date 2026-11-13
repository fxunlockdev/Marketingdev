-- Early business analysis: once onboarding has the answers research reads (steps 1 and 2),
-- the brand analysis starts in the background instead of waiting for "Send my brief". It
-- waits on the early website capture when that is still running. "Send my brief" adopts the
-- finished (or still running) analysis when the research-relevant answers are unchanged.
--
-- early_analysis_digest is the canonical digest of the fields the analysis reads. A save that
-- changes it supersedes the analysis; a save that keeps it starts nothing (at most one start
-- per saved digest, whatever the outcome). research_request_key remembers the "Send my brief"
-- key that adopted an early analysis, so a retried send replays instead of conflicting.
ALTER TABLE app.guided_business_briefs ADD COLUMN early_analysis_job_id uuid,
 ADD COLUMN early_analysis_digest text CHECK(early_analysis_digest IS NULL OR early_analysis_digest ~ '^[a-f0-9]{64}$'),
 ADD COLUMN research_request_key text CHECK(research_request_key IS NULL OR research_request_key ~ '^[-A-Za-z0-9_.:]{8,128}$');
ALTER TABLE app.guided_business_briefs ADD FOREIGN KEY(organization_id,brand_id,early_analysis_job_id) REFERENCES app.jobs(organization_id,brand_id,id);
GRANT UPDATE(early_analysis_job_id,early_analysis_digest,research_request_key) ON app.guided_business_briefs TO desvio_app;

-- Supersede an early analysis whose answers changed. One that never started (queued, no
-- attempt, so no paid call can exist) is closed at once and its wait on the early capture is
-- released, so the replacement can wait on the same capture. One already running is only
-- asked to stop: its call may be in flight, and a canceled job never applies its result.
CREATE FUNCTION app.supersede_early_analysis(target uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE request app.jobs%ROWTYPE;
BEGIN
 -- Same lock order as every worker job transaction: account lock, then the job row.
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant()::text,0));
 SELECT j.* INTO request FROM app.jobs j JOIN app.guided_business_briefs g
  ON g.organization_id=j.organization_id AND g.brand_id=j.brand_id AND g.early_analysis_job_id=j.id
  WHERE j.id=target AND j.organization_id=app.tenant() AND app.brand_matches(j.brand_id) AND j.kind='brand.analyze'
  FOR UPDATE OF j;
 IF NOT FOUND OR app.can_access(request.organization_id,true) IS NOT TRUE OR app.business_access(request.organization_id,request.brand_id,true) IS NOT TRUE THEN
  RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';
 END IF;
 IF request.status='queued' AND request.attempt=0 THEN
  UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='EARLY_ANALYSIS_SUPERSEDED',updated_at=now() WHERE id=target;
  DELETE FROM app.intake_dependencies WHERE analysis_job_id=target;
  INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
  VALUES(request.organization_id,request.brand_id,app.actor(),'guided.early_analysis_superseded',target);
  RETURN 'canceled';
 END IF;
 IF request.status IN ('queued','running','retrying') THEN
  UPDATE app.jobs SET cancel_requested=true WHERE id=target;
  INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
  VALUES(request.organization_id,request.brand_id,app.actor(),'guided.early_analysis_stop_requested',target);
  RETURN 'cancel_requested';
 END IF;
 RETURN request.status;
END $$;
REVOKE ALL ON FUNCTION app.supersede_early_analysis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supersede_early_analysis(uuid) TO desvio_app;

-- Stage timing for support. A ledger row is written just before its provider call; this
-- records when the call settled, so each stage reads as created_at -> completed_at.
ALTER TABLE app.analysis_calls ADD COLUMN completed_at timestamptz;
ALTER TABLE app.market_research_calls ADD COLUMN completed_at timestamptz;
CREATE FUNCTION app.record_call_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.status='submitted' AND NEW.status<>'submitted' AND NEW.completed_at IS NULL THEN NEW.completed_at:=now(); END IF;
 IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN NEW.completed_at:=OLD.completed_at; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.record_call_completion() FROM PUBLIC,desvio_app,desvio_worker;
CREATE TRIGGER analysis_call_completion BEFORE UPDATE ON app.analysis_calls FOR EACH ROW EXECUTE FUNCTION app.record_call_completion();
CREATE TRIGGER market_research_call_completion BEFORE UPDATE ON app.market_research_calls FOR EACH ROW EXECUTE FUNCTION app.record_call_completion();
-- The research screen shows whether the market step is still running. The app may read a
-- market call's state and timing (its existing row policy keeps it to this business), never
-- its result, usage or cost.
GRANT SELECT(job_id,organization_id,brand_id,status,created_at,completed_at) ON app.market_research_calls TO desvio_app;

-- One row per onboarding research job, for operators only (no application grant):
--   queued_at/finished_at  the job itself (an analysis includes any wait on its capture);
--   provider_*             the job's own call: own-site research for a capture, the analysis for brand.analyze;
--   market_*               the market step: full research in a capture, the competitor follow-up in an analysis.
CREATE VIEW app.onboarding_research_timings AS
SELECT j.organization_id,j.brand_id,j.id AS job_id,j.kind,j.status,j.error_code,
 (g.early_analysis_job_id=j.id OR g.prefill_job_id=j.id) AS started_early,
 j.created_at AS queued_at,j.updated_at AS finished_at,
 a.created_at AS provider_started_at,a.completed_at AS provider_completed_at,
 m.created_at AS market_started_at,m.completed_at AS market_completed_at,
 d.capture_job_id AS waited_on_capture
FROM app.jobs j
LEFT JOIN app.analysis_calls a ON a.job_id=j.id
LEFT JOIN app.market_research_calls m ON m.job_id=j.id
LEFT JOIN app.intake_dependencies d ON d.analysis_job_id=j.id
LEFT JOIN app.guided_business_briefs g ON g.organization_id=j.organization_id AND g.brand_id=j.brand_id
WHERE j.kind IN ('website.extract','brand.analyze');
REVOKE ALL ON app.onboarding_research_timings FROM PUBLIC,desvio_app,desvio_worker;
