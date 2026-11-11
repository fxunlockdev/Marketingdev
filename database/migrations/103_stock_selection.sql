-- Persist the candidate set before selecting, so resumed planning uses the same input.
CREATE TABLE app.stock_selections (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 query text NOT NULL CHECK(length(query) BETWEEN 3 AND 200),
 candidates jsonb NOT NULL CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates) BETWEEN 1 AND 12),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.stock_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_selections FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_read ON app.stock_selections FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id));
CREATE POLICY worker_insert ON app.stock_selections FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT SELECT,INSERT ON app.stock_selections TO desvio_worker;
ALTER TABLE app.creative_calls DROP CONSTRAINT creative_calls_step_check;
ALTER TABLE app.creative_calls ADD CONSTRAINT creative_calls_step_check CHECK(step IN ('plan:1','plan:2','plan:3','plan:4','plan:5','image'));
