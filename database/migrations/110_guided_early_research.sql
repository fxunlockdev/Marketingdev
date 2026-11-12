-- Early research: saving the first questionnaire step with a website starts a capture
-- plus market research in the background, before the brief is complete. It is kept apart
-- from research_job_id so editing answers never waits on it or discards it.
ALTER TABLE app.guided_business_briefs ADD COLUMN prefill_job_id uuid;
ALTER TABLE app.guided_business_briefs ADD FOREIGN KEY(organization_id,brand_id,prefill_job_id) REFERENCES app.jobs(organization_id,brand_id,id);
GRANT UPDATE(prefill_job_id) ON app.guided_business_briefs TO desvio_app;

-- Competitors named after early research ran are covered by a smaller competitor-only
-- market step inside the final analysis job. The API records exactly which ones.
ALTER TABLE app.intake_requests ADD COLUMN market_followup jsonb CHECK(market_followup IS NULL OR (
 jsonb_typeof(market_followup)='object' AND jsonb_typeof(market_followup->'website')='string'
 AND jsonb_typeof(market_followup->'competitors')='array' AND jsonb_array_length(market_followup->'competitors') BETWEEN 1 AND 3
 AND octet_length(market_followup::text)<=4000));

-- The final analysis may wait on an early capture that is already running, and that
-- another member may have started. Only this business's own early capture qualifies.
CREATE POLICY dependency_early_capture ON app.intake_dependencies FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=analysis_job_id AND kind='brand.analyze' AND requested_by=app.actor() AND status='queued')
 AND EXISTS(SELECT 1 FROM app.jobs WHERE id=capture_job_id AND kind='website.extract' AND status IN ('queued','running','retrying'))
 AND EXISTS(SELECT 1 FROM app.guided_business_briefs g WHERE g.organization_id=intake_dependencies.organization_id
  AND g.brand_id=intake_dependencies.brand_id AND g.prefill_job_id=capture_job_id));

-- The competitor-only step runs in the analysis job: it may record its own ledger row
-- and store market evidence, tagged by parser version, but no other kind of source.
CREATE POLICY market_followup_insert ON app.market_research_calls FOR INSERT TO desvio_worker
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY market_followup_update ON app.market_research_calls FOR UPDATE TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'))
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY market_followup_source ON app.brand_sources FOR INSERT TO desvio_worker
 WITH CHECK(kind='website' AND parser_version='openai-market-research-v1' AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY market_followup_chunk ON app.brand_chunks FOR INSERT TO desvio_worker
 WITH CHECK(app.intake_scope(organization_id,brand_id,'brand.analyze') AND EXISTS(SELECT 1 FROM app.brand_sources s
  WHERE s.id=source_id AND s.kind='website' AND s.parser_version='openai-market-research-v1'));
