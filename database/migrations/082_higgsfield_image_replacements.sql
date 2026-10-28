-- Optional generated backgrounds. Existing GPT image requests retain their provider.
ALTER TABLE app.creative_requests ADD COLUMN image_provider text NOT NULL DEFAULT 'openai' CHECK(image_provider IN ('openai','higgsfield'));
ALTER TABLE app.creative_requests ADD CHECK(image_provider<>'higgsfield' OR parent_version_id IS NOT NULL);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.creative_calls'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%provider%' LOOP
 EXECUTE format('ALTER TABLE app.creative_calls DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.creative_calls ADD CHECK(provider IN ('openai','gemini','higgsfield')),
 ADD CHECK((step='image' AND provider IN ('openai','higgsfield')) OR (step<>'image' AND provider IN ('openai','gemini')));
CREATE TABLE app.higgsfield_image_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 model text NOT NULL DEFAULT 'higgsfield-ai/soul/v2/standard' CHECK(model='higgsfield-ai/soul/v2/standard'),
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 max_request_micros bigint NOT NULL CHECK(max_request_micros BETWEEN 1 AND 100000000),
 expires_at timestamptz NOT NULL,approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.higgsfield_image_operations (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','submitting','submitted','completed','unknown','rejected','failed','canceled','saved')),
 intent_sha256 text NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),encrypted_intent bytea NOT NULL CHECK(octet_length(encrypted_intent) BETWEEN 30 AND 65536),
 remote_request_id uuid,encrypted_output bytea CHECK(octet_length(encrypted_output) BETWEEN 30 AND 65536),
 download_attempts integer NOT NULL DEFAULT 0 CHECK(download_attempts BETWEEN 0 AND 3),
 deadline_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',cancel_attempted boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,brand_id,job_id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['higgsfield_image_grants','higgsfield_image_operations'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id))',tab);
 END LOOP;END $$;
GRANT SELECT ON app.higgsfield_image_grants,app.higgsfield_image_operations TO desvio_worker;
GRANT SELECT ON app.higgsfield_image_grants TO desvio_app;
CREATE POLICY member_read ON app.higgsfield_image_grants FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
GRANT INSERT,UPDATE ON app.higgsfield_image_operations TO desvio_worker;
CREATE POLICY worker_create ON app.higgsfield_image_operations FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context() AND phase='prepared' AND remote_request_id IS NULL AND encrypted_output IS NULL AND EXISTS(SELECT 1 FROM app.creative_requests r WHERE r.job_id=app.job_context() AND r.image_provider='higgsfield'));
CREATE POLICY worker_update ON app.higgsfield_image_operations FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
