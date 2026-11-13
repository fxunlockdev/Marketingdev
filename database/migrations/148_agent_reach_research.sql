-- Agent Reach research (login-free web search, page reads and YouTube) beside the GPT website
-- capture and market research in a website.extract job. One ledger row per Agent Reach call, for
-- support and timing: Agent Reach itself costs nothing, so no reservation is attached.
--
-- The ledger is also the 24-hour read cache of one business: a succeeded row keeps the sized
-- items it returned (result), and a later job of the same business reuses them by target_sha256.
-- Rows are written before the sandbox runs the call (status 'submitted') and settled after, so
-- created_at -> completed_at reads as the call's time. A cache hit, a robots refusal or a
-- rate-limit refusal is recorded as settled at once.
CREATE TABLE app.agent_reach_calls (
 id uuid PRIMARY KEY, job_id uuid NOT NULL, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 channel text NOT NULL, action text NOT NULL,
 -- Only the login-free channels can ever be recorded: web search/read, YouTube search/info/subtitles.
 CONSTRAINT agent_reach_login_free CHECK((channel,action) IN (('web','search'),('web','read'),('youtube','search'),('youtube','read'),('youtube','subtitle'))),
 purpose text NOT NULL CHECK(purpose IN ('own_page','business_search','competitor_page','competitor_search','video_search','video_subtitle')),
 target text NOT NULL CHECK(length(target) BETWEEN 1 AND 2048),
 target_sha256 text NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
 provider text CHECK(provider IN ('jina','exa','yt-dlp','cache','robots','limit')),
 status text NOT NULL CHECK(status IN ('submitted','succeeded','failed','skipped','cached','abandoned')),
 error_code text CHECK(error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
 items integer CHECK(items BETWEEN 0 AND 50), bytes integer CHECK(bytes>=0),
 result jsonb CHECK(octet_length(result::text)<=200000),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX agent_reach_calls_cache ON app.agent_reach_calls(organization_id,brand_id,target_sha256,created_at DESC) WHERE status='succeeded';
CREATE INDEX agent_reach_calls_recent ON app.agent_reach_calls(created_at);
CREATE INDEX agent_reach_calls_job ON app.agent_reach_calls(job_id);
REVOKE ALL ON app.agent_reach_calls FROM PUBLIC,desvio_app,desvio_worker;
ALTER TABLE app.agent_reach_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_reach_calls FORCE ROW LEVEL SECURITY;
-- Any capture job of the business may read its own rows (the cache spans that business's jobs);
-- only the capture job that owns a row may write it.
CREATE POLICY agent_reach_read ON app.agent_reach_calls FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY agent_reach_insert ON app.agent_reach_calls FOR INSERT TO desvio_worker
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY agent_reach_update ON app.agent_reach_calls FOR UPDATE TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'))
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
GRANT SELECT,INSERT ON app.agent_reach_calls TO desvio_worker;
GRANT UPDATE(provider,status,error_code,items,bytes,result) ON app.agent_reach_calls TO desvio_worker;
CREATE TRIGGER agent_reach_call_completion BEFORE UPDATE ON app.agent_reach_calls FOR EACH ROW EXECUTE FUNCTION app.record_call_completion();

-- Fair use. How many new Agent Reach calls this capture job may start now: at most 40 per business
-- per hour and 60 per minute across every business (Jina Reader's keyless limit is 20 requests per
-- minute per address; Exa's hosted search and YouTube publish none). Cache hits and refusals do not
-- count. The lock is held until the caller's transaction ends, so the caller inserts its rows under
-- it and two jobs can never both take the last places. Returns a count only, never another
-- business's rows.
CREATE FUNCTION app.agent_reach_capacity(org uuid,brand uuid,wanted integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE business_left integer; global_left integer;
BEGIN
 IF app.intake_scope(org,brand,'website.extract') IS NOT TRUE THEN
  RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';
 END IF;
 IF wanted IS NULL OR wanted<1 THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('agent-reach-rate',0));
 SELECT 40-count(*) INTO business_left FROM app.agent_reach_calls
  WHERE organization_id=org AND brand_id=brand AND created_at>now()-interval '1 hour' AND status IN ('submitted','succeeded','failed','abandoned');
 SELECT 60-count(*) INTO global_left FROM app.agent_reach_calls
  WHERE created_at>now()-interval '1 minute' AND status IN ('submitted','succeeded','failed','abandoned');
 RETURN greatest(0,least(wanted,business_left,global_left));
END $$;
REVOKE ALL ON FUNCTION app.agent_reach_capacity(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.agent_reach_capacity(uuid,uuid,integer) TO desvio_worker;

-- Operators read Agent Reach timing beside the other onboarding research calls. No application grant.
CREATE VIEW app.agent_reach_timings AS
SELECT organization_id,brand_id,job_id,channel,action,purpose,provider,status,error_code,items,bytes,created_at,completed_at,
 completed_at-created_at AS duration
FROM app.agent_reach_calls;
REVOKE ALL ON app.agent_reach_timings FROM PUBLIC,desvio_app,desvio_worker;
