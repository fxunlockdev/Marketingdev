-- After website/market research or brand analysis succeeds, the worker asks a model to turn the
-- new sources into knowledge-graph suggestions. This is a third provider request on an intake job,
-- so it has its own ledger: one row per job, written before the call, so a replay never pays twice.
-- Failures and skips are recorded here too; they never change the research job's outcome.
CREATE TABLE app.knowledge_extraction_calls (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 model text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>=0),input_sha256 text,
 -- The brand sources this call read. A later job skips them, so the same page is never paid for twice.
 source_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(source_ids)<=40),
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown','skipped')),
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,80}$'),
 response_id text,result jsonb CHECK(octet_length(result::text)<=400000),usage jsonb,
 applied_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'skipped' OR reserved_micros=0),CHECK(status='skipped' OR reserved_micros>0),
 CHECK(applied_at IS NULL OR status='succeeded'),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX knowledge_extraction_calls_brand ON app.knowledge_extraction_calls(organization_id,brand_id);
REVOKE ALL ON app.knowledge_extraction_calls FROM PUBLIC,desvio_app,desvio_worker;
ALTER TABLE app.knowledge_extraction_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_extraction_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY app_read ON app.knowledge_extraction_calls FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- Both intake kinds read the brand's rows: to skip covered sources and to enforce the shared
-- onboarding allowance. Only the job that owns a row may write it.
CREATE POLICY extraction_read ON app.knowledge_extraction_calls FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY extraction_insert ON app.knowledge_extraction_calls FOR INSERT TO desvio_worker
 WITH CHECK(job_id=app.job_context() AND (app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze')));
CREATE POLICY extraction_update ON app.knowledge_extraction_calls FOR UPDATE TO desvio_worker
 USING(job_id=app.job_context() AND (app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze')))
 WITH CHECK(job_id=app.job_context() AND (app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze')));
GRANT SELECT,INSERT ON app.knowledge_extraction_calls TO desvio_worker;
GRANT UPDATE(status,error_code,response_id,result,usage,applied_at) ON app.knowledge_extraction_calls TO desvio_worker;
-- Counts against the same monthly account budget as every other provider reservation. A skip costs nothing.
CREATE TRIGGER monthly_knowledge_extraction_reservation AFTER INSERT ON app.knowledge_extraction_calls
 FOR EACH ROW WHEN (NEW.reserved_micros>0) EXECUTE FUNCTION app.reserve_monthly_generation();
