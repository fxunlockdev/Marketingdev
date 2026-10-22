ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile','creative.video'));

-- Operator-only funded staging authorization; no customer can grant spend.
CREATE TABLE app.video_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 models text[] NOT NULL CHECK(cardinality(models) BETWEEN 1 AND 2 AND models <@ ARRAY['kling-video/v3.0/std/image-to-video','kling-video/o3/video-edit']::text[]),
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 max_create_micros bigint NOT NULL CHECK(max_create_micros BETWEEN 1 AND 100000000),
 max_edit_micros bigint NOT NULL CHECK(max_edit_micros BETWEEN 1 AND 100000000),
 expires_at timestamptz NOT NULL,operator_reference text NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 500),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.video_reservations (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,model text NOT NULL,
 reserved_micros bigint NOT NULL CHECK(reserved_micros BETWEEN 1 AND 100000000),
 state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','released')),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,job_id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.video_operations (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 provider_key uuid NOT NULL UNIQUE,model text NOT NULL,intent_sha256 text NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
 encrypted_intent bytea NOT NULL CHECK(octet_length(encrypted_intent) BETWEEN 30 AND 65536),
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','submitting','accepted','unknown','completed','failed','nsfw','canceled','rejected')),
 remote_request_id uuid UNIQUE,encrypted_output bytea CHECK(octet_length(encrypted_output) BETWEEN 30 AND 8192),
 remote_state text CHECK(remote_state IN ('queued','in_progress','completed','failed','nsfw','canceled')),
 cancel_phase text NOT NULL DEFAULT 'none' CHECK(cancel_phase IN ('none','submitting','accepted','unknown','rejected')),
 error_code text,last_checked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 deadline_at timestamptz NOT NULL DEFAULT (now()+interval '6 hours'),
 UNIQUE(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_reservations(organization_id,brand_id,job_id),
 CHECK((phase NOT IN ('accepted','completed','failed','nsfw','canceled')) OR remote_request_id IS NOT NULL OR phase='canceled'),
 CHECK((phase='completed')=(encrypted_output IS NOT NULL))
);
CREATE TABLE app.video_observations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,job_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','in_progress','completed','failed','nsfw','canceled')),
 checked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_operations(organization_id,brand_id,job_id)
);
CREATE FUNCTION app.video_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'creative.video') $$;
REVOKE ALL ON FUNCTION app.video_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.video_scope(uuid,uuid) TO desvio_worker;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['video_grants','video_reservations','video_operations','video_observations'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY customer_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['video_grants','video_reservations'] LOOP
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id))',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['video_operations','video_observations'] LOOP
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context())',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['video_reservations','video_operations','video_observations'] LOOP
  EXECUTE format('CREATE POLICY worker_insert ON app.%I FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context())',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['video_reservations','video_operations'] LOOP
  EXECUTE format('CREATE POLICY worker_update ON app.%I FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context())',tab);
 END LOOP;
END $$;
GRANT SELECT ON app.video_grants,app.video_reservations,app.video_observations TO desvio_app,desvio_worker;
GRANT SELECT(job_id,organization_id,brand_id,model,phase,remote_state,cancel_phase,error_code,last_checked_at,created_at,deadline_at) ON app.video_operations TO desvio_app;
GRANT SELECT ON app.video_operations TO desvio_worker;
GRANT INSERT ON app.video_operations,app.video_reservations,app.video_observations TO desvio_worker;
GRANT UPDATE(state) ON app.video_reservations TO desvio_worker;
GRANT UPDATE(phase,remote_request_id,encrypted_output,remote_state,cancel_phase,error_code,last_checked_at) ON app.video_operations TO desvio_worker;
-- Intent, key, model, hash, reservation amount and deadline cannot be rewritten
-- by either runtime role. Only operator migrations may alter authorizations.
