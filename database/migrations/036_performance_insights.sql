ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','creative.video','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile','insight.generate'));
CREATE FUNCTION app.insight_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'insight.generate') $$;
REVOKE ALL ON FUNCTION app.insight_scope(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.insight_scope(uuid,uuid) TO desvio_worker;
CREATE TABLE app.insight_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN ('openai','gemini')),enabled boolean NOT NULL DEFAULT false,
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),expires_at timestamptz NOT NULL,budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 input_micros_per_token numeric NOT NULL CHECK(input_micros_per_token>0 AND input_micros_per_token<=1000),output_micros_per_token numeric NOT NULL CHECK(output_micros_per_token>0 AND output_micros_per_token<=1000),
 approved_by text NOT NULL,PRIMARY KEY(organization_id,brand_id,provider),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.insight_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN ('openai','gemini')),selected_model text,
 input jsonb NOT NULL CHECK(octet_length(input::text)<=300000),input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),request_key text NOT NULL,request_hash text NOT NULL,
 output jsonb CHECK(octet_length(output::text)<=100000),UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.insight_calls (
 job_id uuid NOT NULL,step integer NOT NULL CHECK(step BETWEEN 1 AND 3),organization_id uuid NOT NULL,brand_id uuid NOT NULL,provider text NOT NULL CHECK(provider IN ('openai','gemini')),model text NOT NULL,input_sha256 text NOT NULL,
 reserved_micros bigint NOT NULL CHECK(reserved_micros>0),status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),result jsonb CHECK(octet_length(result::text)<=500000),PRIMARY KEY(job_id,step),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.memory_lessons (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,job_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 4),
 content jsonb NOT NULL CHECK(octet_length(content::text)<=20000),state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','testing','rejected','retired')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),applicability text NOT NULL DEFAULT '' CHECK(length(applicability)<=1000),reviewed_by uuid REFERENCES auth."user"(id),reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(job_id,position),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.memory_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,lesson_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),state text NOT NULL CHECK(state IN ('testing','rejected','retired')),revision integer NOT NULL CHECK(revision>1),applicability text NOT NULL CHECK(length(applicability)<=1000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lesson_id,revision),FOREIGN KEY(organization_id,brand_id,lesson_id) REFERENCES app.memory_lessons(organization_id,brand_id,id)
);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['insight_grants','insight_requests','insight_calls','memory_lessons','memory_reviews'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;END $$;
GRANT SELECT ON app.insight_grants,app.insight_requests,app.memory_lessons,app.memory_reviews TO desvio_app;
GRANT INSERT ON app.insight_requests,app.memory_reviews TO desvio_app;
GRANT UPDATE(state,revision,applicability,reviewed_by,reviewed_at) ON app.memory_lessons TO desvio_app;
CREATE POLICY request_create ON app.insight_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND output IS NULL AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='insight.generate' AND j.requested_by=app.actor()));
CREATE POLICY lesson_review ON app.memory_lessons FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND reviewed_by=app.actor() AND state<>'proposed');
CREATE POLICY review_append ON app.memory_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND actor_id=app.actor());
GRANT SELECT ON app.insight_grants,app.insight_requests,app.insight_calls,app.memory_lessons TO desvio_worker;
GRANT INSERT ON app.insight_calls,app.memory_lessons TO desvio_worker;
GRANT UPDATE(status,result) ON app.insight_calls TO desvio_worker;
GRANT UPDATE(output) ON app.insight_requests TO desvio_worker;
CREATE POLICY worker_grant ON app.insight_grants FOR SELECT TO desvio_worker USING(app.insight_scope(organization_id,brand_id));
CREATE POLICY worker_request ON app.insight_requests FOR SELECT TO desvio_worker USING(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_output ON app.insight_requests FOR UPDATE TO desvio_worker USING(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_calls ON app.insight_calls FOR SELECT TO desvio_worker USING(app.insight_scope(organization_id,brand_id));
CREATE POLICY worker_call_insert ON app.insight_calls FOR INSERT TO desvio_worker WITH CHECK(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_call_update ON app.insight_calls FOR UPDATE TO desvio_worker USING(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_lessons ON app.memory_lessons FOR SELECT TO desvio_worker USING(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_lesson_insert ON app.memory_lessons FOR INSERT TO desvio_worker WITH CHECK(app.insight_scope(organization_id,brand_id) AND job_id=app.job_context() AND state='proposed' AND revision=1 AND reviewed_by IS NULL AND EXISTS(SELECT 1 FROM app.insight_requests r WHERE r.job_id=app.job_context() AND r.output IS NOT NULL));

ALTER TABLE app.creative_requests ADD COLUMN memory_context jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(memory_context)='array' AND octet_length(memory_context::text)<=60000);
ALTER TABLE app.video_requests ADD COLUMN memory_context jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(memory_context)='array' AND octet_length(memory_context::text)<=60000);
CREATE POLICY generation_memory ON app.memory_lessons FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) OR app.video_scope(organization_id,brand_id) OR app.planning_scope(organization_id,brand_id));
