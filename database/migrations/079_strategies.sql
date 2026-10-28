ALTER TABLE app.planning_loops DROP CONSTRAINT planning_loops_cycles_check;
ALTER TABLE app.planning_loops ADD CONSTRAINT planning_loops_cycles_check CHECK(cycles BETWEEN 1 AND 12);
CREATE TABLE app.content_strategies(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES auth."user"(id),request_key text NOT NULL,request_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('lifestyle','education','problem_solution','promotion')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 140),loop_id uuid NOT NULL,
 credit_cap integer NOT NULL CHECK(credit_cap BETWEEN 1 AND 100000),
 planning_credits integer NOT NULL CHECK(planning_credits BETWEEN 1 AND credit_cap),
 image_credits integer NOT NULL CHECK(image_credits BETWEEN 1 AND credit_cap),
 allocated_credits integer NOT NULL CHECK(allocated_credits BETWEEN 1 AND credit_cap),
 weekly_increase integer NOT NULL CHECK(weekly_increase BETWEEN 0 AND 2),
 schedule_consent boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,loop_id) REFERENCES app.planning_loops(organization_id,brand_id,id)
);
CREATE TABLE app.strategy_occurrences(
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,strategy_id uuid NOT NULL,job_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 12),
 PRIMARY KEY(strategy_id,ordinal),UNIQUE(job_id),
 FOREIGN KEY(organization_id,brand_id,strategy_id) REFERENCES app.content_strategies(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.strategy_image_requests(
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,strategy_id uuid NOT NULL,slot_id uuid NOT NULL,job_id uuid NOT NULL,
 credits integer NOT NULL CHECK(credits>0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(strategy_id,slot_id),
 FOREIGN KEY(organization_id,brand_id,strategy_id) REFERENCES app.content_strategies(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['content_strategies','strategy_occurrences','strategy_image_requests'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('GRANT SELECT,INSERT ON app.%I TO desvio_app',t);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',t);
 EXECUTE format('CREATE POLICY scoped_insert ON app.%I FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true))',t);
 END LOOP; END $$;
GRANT UPDATE(allocated_credits) ON app.content_strategies TO desvio_app;
CREATE POLICY scoped_update ON app.content_strategies FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
