ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate'));
ALTER TABLE app.content_plans DROP CONSTRAINT content_plans_origin_check;
ALTER TABLE app.content_plans ADD CONSTRAINT content_plans_origin_check CHECK(origin IN ('manual','generated'));
ALTER TABLE app.content_plans ADD COLUMN job_id uuid UNIQUE, ADD COLUMN brain_id uuid, ADD COLUMN strategy jsonb CHECK(octet_length(strategy::text)<=120000),ADD COLUMN skill_manifest jsonb CHECK(octet_length(skill_manifest::text)<=100000);
ALTER TABLE app.content_plans ADD FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),ADD FOREIGN KEY(organization_id,brand_id,brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id),ADD CHECK((origin='manual' AND job_id IS NULL AND brain_id IS NULL AND strategy IS NULL AND skill_manifest IS NULL) OR (origin='generated' AND job_id IS NOT NULL AND brain_id IS NOT NULL AND strategy IS NOT NULL AND skill_manifest IS NOT NULL));
ALTER TABLE app.content_slots ADD COLUMN strategy_slot_index integer CHECK(strategy_slot_index BETWEEN 0 AND 29);
CREATE TABLE app.planning_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,brain_id uuid NOT NULL,
 input jsonb NOT NULL CHECK(octet_length(input::text)<=390000),input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 request_key text NOT NULL,request_hash text NOT NULL,output jsonb CHECK(octet_length(output::text)<=250000),output_plan_id uuid,
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,output_plan_id) REFERENCES app.content_plans(organization_id,brand_id,id)
);
CREATE TABLE app.planning_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),expires_at timestamptz NOT NULL,
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),input_micros_per_token numeric NOT NULL CHECK(input_micros_per_token>0 AND input_micros_per_token<=1000),output_micros_per_token numeric NOT NULL CHECK(output_micros_per_token>0 AND output_micros_per_token<=1000),
 approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.planning_calls (
 job_id uuid NOT NULL,step integer NOT NULL CHECK(step BETWEEN 1 AND 3),organization_id uuid NOT NULL,brand_id uuid NOT NULL,model text NOT NULL,input_sha256 text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),result jsonb CHECK(octet_length(result::text)<=500000),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,step),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE FUNCTION app.planning_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'plan.generate') $$;
REVOKE ALL ON FUNCTION app.planning_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.planning_scope(uuid,uuid) TO desvio_worker;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['planning_requests','planning_grants','planning_calls'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON app.planning_requests TO desvio_app;
CREATE POLICY scoped_read ON app.planning_requests FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY request_create ON app.planning_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND output IS NULL AND output_plan_id IS NULL AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='plan.generate' AND j.requested_by=app.actor()));
GRANT SELECT ON app.planning_requests,app.planning_grants,app.planning_calls TO desvio_worker;
CREATE POLICY worker_request ON app.planning_requests FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_request_update ON app.planning_requests FOR UPDATE TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT UPDATE(output,output_plan_id) ON app.planning_requests TO desvio_worker;
CREATE POLICY worker_grant ON app.planning_grants FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id));
CREATE POLICY worker_call_read ON app.planning_calls FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id));
CREATE POLICY worker_call_insert ON app.planning_calls FOR INSERT TO desvio_worker WITH CHECK(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_call_update ON app.planning_calls FOR UPDATE TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT INSERT ON app.planning_calls TO desvio_worker;
GRANT UPDATE(status,result) ON app.planning_calls TO desvio_worker;
CREATE POLICY planning_brain ON app.brand_brain_versions FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.planning_requests r WHERE r.job_id=app.job_context() AND r.brain_id=brand_brain_versions.id));
-- Planning workers can create only their own new drafts, never alter/approve existing records.
GRANT SELECT,INSERT ON app.content_plans,app.content_slots,app.content_slot_events TO desvio_worker;
CREATE POLICY planning_plan_read ON app.content_plans FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id));
CREATE POLICY planning_plan_insert ON app.content_plans FOR INSERT TO desvio_worker WITH CHECK(app.planning_scope(organization_id,brand_id) AND job_id=app.job_context() AND origin='generated' AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.requested_by=created_by));
CREATE POLICY planning_slot_read ON app.content_slots FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.content_plans p WHERE p.id=plan_id AND p.job_id=app.job_context()));
CREATE POLICY planning_slot_insert ON app.content_slots FOR INSERT TO desvio_worker WITH CHECK(app.planning_scope(organization_id,brand_id) AND state='content_needed' AND creative_version_id IS NULL AND revision=1 AND approved_by IS NULL AND strategy_slot_index IS NOT NULL AND EXISTS(SELECT 1 FROM app.content_plans p WHERE p.id=plan_id AND p.job_id=app.job_context() AND p.created_by=content_slots.created_by));
CREATE POLICY planning_event_read ON app.content_slot_events FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.content_slots s WHERE s.id=slot_id));
CREATE POLICY planning_event_insert ON app.content_slot_events FOR INSERT TO desvio_worker WITH CHECK(app.planning_scope(organization_id,brand_id) AND action='created' AND revision=1 AND creative_version_id IS NULL AND EXISTS(SELECT 1 FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id WHERE s.id=slot_id AND p.job_id=app.job_context() AND actor_id=p.created_by));
CREATE POLICY manual_plan_only ON app.content_plans AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(origin='manual' AND job_id IS NULL AND brain_id IS NULL);
CREATE POLICY manual_slot_only ON app.content_slots AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(strategy_slot_index IS NULL);
ALTER TABLE app.content_slots ADD UNIQUE(plan_id,strategy_slot_index);
