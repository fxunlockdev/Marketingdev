-- Vision check of a rendered reel: a video job may record the two optional quality-check calls
-- (first render, and one re-render when captions do not read) in the shared creative ledger.
-- Planning calls keep their existing policies; nothing else is widened.
CREATE POLICY video_qa_insert ON app.creative_calls FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND step IN ('qa:1','qa:2') AND provider='openai');
CREATE POLICY video_qa_update ON app.creative_calls FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND step IN ('qa:1','qa:2') AND provider='openai');
