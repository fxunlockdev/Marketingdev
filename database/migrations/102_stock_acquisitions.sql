-- Internal only: never grant these vendor/license records to the customer role.
CREATE TABLE app.stock_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false,ai_use_authorized boolean NOT NULL DEFAULT false,
 max_daily_downloads integer NOT NULL CHECK(max_daily_downloads BETWEEN 1 AND 100),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,brand_id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.stock_acquisitions (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 resource_id bigint NOT NULL CHECK(resource_id>0),
 status text NOT NULL CHECK(status IN('acquiring','ready','unknown','rejected')),
 requires_attribution boolean,attribution_url text,
 object_key text,sha256 text,bytes integer,width integer,height integer,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 CHECK(status<>'ready' OR (object_key IS NOT NULL AND sha256 IS NOT NULL AND bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND requires_attribution IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND bytes BETWEEN 1 AND 6291456 AND width>0 AND height>0 AND requires_attribution=false)),
 CHECK(object_key IS NULL OR object_key='stock/'||organization_id::text||'/'||brand_id::text||'/'||job_id::text||'/'||sha256)
);
CREATE INDEX stock_daily_usage ON app.stock_acquisitions(organization_id,brand_id,created_at);
ALTER TABLE app.stock_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stock_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_acquisitions FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_read ON app.stock_grants FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id));
CREATE POLICY worker_read ON app.stock_acquisitions FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id));
CREATE POLICY worker_insert ON app.stock_acquisitions FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_update ON app.stock_acquisitions FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT SELECT ON app.stock_grants,app.stock_acquisitions TO desvio_worker;
GRANT INSERT,UPDATE ON app.stock_acquisitions TO desvio_worker;
