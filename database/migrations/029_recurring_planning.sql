-- Bounded, explicitly consented recurring plans. Every occurrence remains an ordinary durable planning job.
CREATE TABLE app.planning_loops (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES auth."user"(id),
 cycles integer NOT NULL CHECK(cycles BETWEEN 2 AND 12),budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 stopped_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.planning_loops ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.planning_loops FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.planning_loops TO desvio_app;
GRANT UPDATE(stopped_at) ON app.planning_loops TO desvio_app;
CREATE POLICY customer_read ON app.planning_loops FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY customer_create ON app.planning_loops FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND stopped_at IS NULL);
CREATE POLICY customer_stop ON app.planning_loops FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(stopped_at IS NOT NULL);
ALTER TABLE app.planning_requests ADD COLUMN loop_id uuid,ADD COLUMN scheduled_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN execution_input jsonb CHECK(octet_length(execution_input::text)<=390000),ADD COLUMN execution_sha256 text CHECK(execution_sha256 ~ '^[a-f0-9]{64}$'),ADD COLUMN execution_brain_id uuid,
 ADD FOREIGN KEY(organization_id,brand_id,loop_id) REFERENCES app.planning_loops(organization_id,brand_id,id),
 ADD FOREIGN KEY(organization_id,brand_id,execution_brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id),
 ADD CHECK((execution_input IS NULL AND execution_sha256 IS NULL AND execution_brain_id IS NULL) OR (loop_id IS NOT NULL AND execution_input IS NOT NULL AND execution_sha256 IS NOT NULL AND execution_brain_id IS NOT NULL));
GRANT SELECT ON app.planning_loops TO desvio_worker;
CREATE POLICY worker_read ON app.planning_loops FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.planning_requests r WHERE r.job_id=app.job_context() AND r.loop_id=planning_loops.id));
GRANT UPDATE(execution_input,execution_sha256,execution_brain_id) ON app.planning_requests TO desvio_worker;
CREATE POLICY loop_brain ON app.brand_brain_versions FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.planning_requests r WHERE r.job_id=app.job_context() AND r.loop_id IS NOT NULL));
CREATE POLICY loop_preferences ON app.business_onboarding FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id));
GRANT SELECT ON app.business_onboarding TO desvio_worker;
ALTER TABLE app.planning_calls ADD COLUMN loop_id uuid,ADD FOREIGN KEY(organization_id,brand_id,loop_id) REFERENCES app.planning_loops(organization_id,brand_id,id);
ALTER TABLE app.job_dispatch ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX job_dispatch_due ON app.job_dispatch(available_at) WHERE dispatched_at IS NULL;
-- Worker snapshots cannot be rewritten after the first execution snapshot has been saved.
CREATE FUNCTION app.immutable_plan_execution() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.execution_input IS NOT NULL AND (NEW.execution_input,NEW.execution_sha256,NEW.execution_brain_id) IS DISTINCT FROM (OLD.execution_input,OLD.execution_sha256,OLD.execution_brain_id) THEN RAISE EXCEPTION 'Planning execution is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_plan_execution BEFORE UPDATE ON app.planning_requests FOR EACH ROW EXECUTE FUNCTION app.immutable_plan_execution();

CREATE POLICY no_customer_execution ON app.planning_requests AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(execution_input IS NULL AND execution_sha256 IS NULL AND execution_brain_id IS NULL);
