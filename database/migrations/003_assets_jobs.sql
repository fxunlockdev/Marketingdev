CREATE TABLE app.assets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES auth."user"(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  expected_bytes integer NOT NULL CHECK(expected_bytes BETWEEN 1 AND 20971520),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  quarantine_key text NOT NULL UNIQUE,
  canonical_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'awaiting_upload' CHECK(state IN ('awaiting_upload','queued','validating','ready','rejected','failed','canceled')),
  error_code text,
  scanner_version text,
  etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,brand_id,id),
  FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE INDEX assets_brand ON app.assets(organization_id,brand_id,created_at);
ALTER TABLE app.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assets FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_read ON app.assets FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY asset_insert ON app.assets FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND created_by=app.actor() AND state='awaiting_upload');
CREATE POLICY asset_queue ON app.assets FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND state='awaiting_upload')
  WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND state IN ('queued','canceled'));
GRANT SELECT,INSERT ON app.assets TO desvio_app;
GRANT UPDATE(state,updated_at) ON app.assets TO desvio_app;

CREATE TABLE app.jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth."user"(id),
  kind text NOT NULL CHECK(kind='asset.validate'),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retrying','succeeded','rejected','failed','canceled')),
  cancel_requested boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,brand_id,id),
  UNIQUE(organization_id,brand_id,asset_id,kind),
  FOREIGN KEY(organization_id,brand_id,asset_id) REFERENCES app.assets(organization_id,brand_id,id)
);
CREATE INDEX jobs_brand ON app.jobs(organization_id,brand_id,created_at);
ALTER TABLE app.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY job_read ON app.jobs FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY job_insert ON app.jobs FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND requested_by=app.actor() AND status='queued' AND NOT cancel_requested AND attempt=0);
CREATE POLICY job_cancel ON app.jobs FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND status IN ('queued','running','retrying'))
  WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND cancel_requested);
GRANT SELECT,INSERT ON app.jobs TO desvio_app;
GRANT UPDATE(cancel_requested) ON app.jobs TO desvio_app;

CREATE TABLE app.job_dispatch (
  job_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  dispatched_at timestamptz,
  lease_id uuid,
  leased_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.job_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.job_dispatch FORCE ROW LEVEL SECURITY;
CREATE POLICY enqueue_job ON app.job_dispatch FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id));
GRANT INSERT ON app.job_dispatch TO desvio_app;
GRANT USAGE ON SCHEMA app TO desvio_dispatcher,desvio_worker;
CREATE POLICY dispatch_job ON app.job_dispatch TO desvio_dispatcher USING(true) WITH CHECK(true);
GRANT SELECT ON app.job_dispatch TO desvio_dispatcher;
GRANT UPDATE(dispatched_at,lease_id,leased_until,attempts,last_error) ON app.job_dispatch TO desvio_dispatcher;

CREATE FUNCTION app.job_context() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog
  AS $$ SELECT nullif(current_setting('app.job_id',true),'')::uuid $$;
CREATE POLICY worker_job ON app.jobs TO desvio_worker USING(id=app.job_context() AND organization_id=app.tenant() AND app.brand_matches(brand_id))
  WITH CHECK(id=app.job_context() AND organization_id=app.tenant() AND app.brand_matches(brand_id));
GRANT SELECT ON app.jobs TO desvio_worker;
GRANT UPDATE(status,attempt,error_code,updated_at) ON app.jobs TO desvio_worker;
CREATE POLICY worker_membership ON app.memberships FOR SELECT TO desvio_worker USING(organization_id=app.tenant()
  AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=app.job_context() AND j.organization_id=memberships.organization_id AND j.requested_by=memberships.user_id));
GRANT SELECT ON app.memberships TO desvio_worker;
CREATE FUNCTION app.worker_asset(target uuid,org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs j
    WHERE j.id=app.job_context() AND j.asset_id=target AND j.organization_id=org AND j.brand_id=brand)
$$;
CREATE POLICY worker_asset ON app.assets TO desvio_worker USING(app.worker_asset(id,organization_id,brand_id)) WITH CHECK(app.worker_asset(id,organization_id,brand_id));
GRANT SELECT ON app.assets TO desvio_worker;
GRANT UPDATE(state,error_code,scanner_version,etag,updated_at) ON app.assets TO desvio_worker;
REVOKE ALL ON FUNCTION app.job_context(),app.worker_asset(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.job_context(),app.worker_asset(uuid,uuid,uuid),app.tenant(),app.brand_matches(uuid) TO desvio_worker;
