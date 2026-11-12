-- Market and competitor research is a second provider request inside a website.extract
-- job. app.analysis_calls holds one row per job, so this step has its own ledger:
-- one row per job, written before the call, so a replay can never pay twice.
CREATE TABLE app.market_research_calls (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 model text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),input_sha256 text NOT NULL,
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),
 response_id text,result jsonb CHECK(octet_length(result::text)<=150000),usage jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX market_research_calls_brand ON app.market_research_calls(organization_id,brand_id);
REVOKE ALL ON app.market_research_calls FROM PUBLIC,desvio_app,desvio_worker;
ALTER TABLE app.market_research_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.market_research_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON app.market_research_calls FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- Both intake job kinds read the brand's reservations to enforce the shared onboarding
-- allowance. Only the capture job that owns a row may write it.
CREATE POLICY market_call_read ON app.market_research_calls FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY market_call_insert ON app.market_research_calls FOR INSERT TO desvio_worker
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY market_call_update ON app.market_research_calls FOR UPDATE TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'))
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
GRANT SELECT,INSERT ON app.market_research_calls TO desvio_worker;
GRANT UPDATE(status,response_id,result,usage) ON app.market_research_calls TO desvio_worker;
-- Counts against the same monthly account budget as every other provider reservation.
CREATE TRIGGER monthly_market_research_reservation AFTER INSERT ON app.market_research_calls
 FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
