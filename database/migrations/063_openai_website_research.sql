-- Share the existing onboarding grant and reservation ledger with GPT web research.
-- Exact job writes and brand-scoped reads remain enforced by forced RLS.
CREATE POLICY research_grant_read ON app.analysis_grants FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY research_call_read ON app.analysis_calls FOR SELECT TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY research_call_insert ON app.analysis_calls FOR INSERT TO desvio_worker
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY research_call_update ON app.analysis_calls FOR UPDATE TO desvio_worker
 USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'))
 WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'website.extract'));
