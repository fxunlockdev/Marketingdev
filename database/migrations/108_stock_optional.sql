-- Stock is optional. Every creative job records what happened to its stock step, including
-- why it went ahead without a photo, so a skipped or uncertain stock step never fails the job.
ALTER TABLE app.stock_selections ALTER COLUMN query DROP NOT NULL;
-- A job that skips stock before searching has no candidates; several queries may return up to 24.
ALTER TABLE app.stock_selections DROP CONSTRAINT stock_selections_candidates_check;
ALTER TABLE app.stock_selections ADD CONSTRAINT stock_selections_candidates_check CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates) BETWEEN 0 AND 24);
ALTER TABLE app.stock_selections
 ADD COLUMN queries jsonb CHECK(queries IS NULL OR (jsonb_typeof(queries)='array' AND jsonb_array_length(queries) BETWEEN 1 AND 3)),
 ADD COLUMN outcome text CHECK(outcome IN('selected','reused','skipped')),
 ADD COLUMN skip_reason text CHECK(skip_reason ~ '^[A-Z0-9_]{3,64}$'),
 ADD COLUMN selected_resource_id bigint CHECK(selected_resource_id>0),
 ADD COLUMN use_as text CHECK(use_as IN('base','inspiration')),
 -- A later carousel slide reuses the first slide's photo instead of buying another.
 ADD COLUMN source_job_id uuid,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD CONSTRAINT stock_selections_decision_check CHECK(
  outcome IS NULL
  OR (outcome='skipped' AND skip_reason IS NOT NULL)
  OR (outcome='selected' AND skip_reason IS NULL AND selected_resource_id IS NOT NULL AND use_as IS NOT NULL AND source_job_id IS NULL)
  OR (outcome='reused' AND skip_reason IS NULL AND selected_resource_id IS NOT NULL AND use_as IS NOT NULL AND source_job_id IS NOT NULL));
CREATE POLICY worker_update ON app.stock_selections FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT UPDATE(outcome,skip_reason,selected_resource_id,use_as,source_job_id,updated_at) ON app.stock_selections TO desvio_worker;
-- A slide job may find the first slide of a carousel in its own business, to reuse that slide's photo.
CREATE POLICY worker_first_slide ON app.carousel_children FOR SELECT TO desvio_worker USING(position=0 AND app.creative_scope(organization_id,brand_id));
