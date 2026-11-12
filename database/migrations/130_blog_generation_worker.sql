-- Blog articles are written on the worker through the skills harness. The API holds no model key:
-- it only checks the request, snapshots its input and enqueues a blog.generate job.
ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','creative.video','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile','insight.generate','carousel.generate','blog.generate'));

CREATE FUNCTION app.blog_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'blog.generate') $$;
REVOKE ALL ON FUNCTION app.blog_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.blog_scope(uuid,uuid) TO desvio_worker;

-- One customer request per row, as before. Reservations now accrue per harness step on the worker,
-- so a request starts at zero; 'abandoned' is the customer stopping a wait on an uncertain result.
ALTER TABLE app.campaign_blog_calls ADD COLUMN job_id uuid;
ALTER TABLE app.campaign_blog_calls ADD FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id);
CREATE UNIQUE INDEX campaign_blog_calls_job ON app.campaign_blog_calls(job_id) WHERE job_id IS NOT NULL;
ALTER TABLE app.campaign_blog_calls DROP CONSTRAINT campaign_blog_calls_reserved_micros_check;
ALTER TABLE app.campaign_blog_calls ADD CONSTRAINT campaign_blog_calls_reserved_micros_check CHECK(reserved_micros>=0);
ALTER TABLE app.campaign_blog_calls DROP CONSTRAINT campaign_blog_calls_status_check;
ALTER TABLE app.campaign_blog_calls ADD CONSTRAINT campaign_blog_calls_status_check CHECK(status IN ('submitted','succeeded','rejected','unknown','abandoned'));
-- The API may no longer settle a request; only the worker job that owns it, or the stop-waiting release.
REVOKE UPDATE ON app.campaign_blog_calls FROM desvio_app;

-- The immutable input of one generation, written by the API with the job.
CREATE TABLE app.campaign_blog_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,blog_id uuid NOT NULL,call_id uuid NOT NULL UNIQUE REFERENCES app.campaign_blog_calls(id),
 revision integer NOT NULL CHECK(revision>0),model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),requested_by uuid NOT NULL,
 input jsonb NOT NULL CHECK(octet_length(input::text)<=200000),input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 knowledge_context jsonb CHECK(octet_length(knowledge_context::text)<=70000),output jsonb CHECK(octet_length(output::text)<=200000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,blog_id) REFERENCES app.campaign_blogs(organization_id,brand_id,id)
);
-- One ledger row per harness model call, written before the call: a replay never pays twice.
CREATE TABLE app.campaign_blog_step_calls (
 job_id uuid NOT NULL,step integer NOT NULL CHECK(step BETWEEN 1 AND 3),organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 model text NOT NULL,input_sha256 text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),result jsonb CHECK(octet_length(result::text)<=300000),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,step),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX campaign_blog_step_calls_brand ON app.campaign_blog_step_calls(organization_id,brand_id);
CREATE TRIGGER monthly_blog_step_reservation AFTER INSERT ON app.campaign_blog_step_calls FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();

DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['campaign_blog_requests','campaign_blog_step_calls'] LOOP
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,desvio_app,desvio_worker',tab);
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('GRANT SELECT ON app.%I TO desvio_app,desvio_worker',tab);
 EXECUTE format('CREATE POLICY member_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id))',tab);
END LOOP;END $$;
GRANT INSERT ON app.campaign_blog_requests TO desvio_app;
CREATE POLICY writer_insert ON app.campaign_blog_requests FOR INSERT TO desvio_app WITH CHECK(app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND requested_by=app.actor());
GRANT UPDATE(knowledge_context,output) ON app.campaign_blog_requests TO desvio_worker;
CREATE POLICY worker_update ON app.campaign_blog_requests FOR UPDATE TO desvio_worker USING(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id)) WITH CHECK(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id));
GRANT INSERT ON app.campaign_blog_step_calls TO desvio_worker;
GRANT UPDATE(status,result) ON app.campaign_blog_step_calls TO desvio_worker;
CREATE POLICY worker_insert ON app.campaign_blog_step_calls FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id));
CREATE POLICY worker_update ON app.campaign_blog_step_calls FOR UPDATE TO desvio_worker USING(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id)) WITH CHECK(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id));
-- The step ledger counts toward the planning credit like every other blog reservation.
CREATE POLICY blog_step_budget_read ON app.campaign_blog_step_calls FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id) OR app.blog_scope(organization_id,brand_id));

-- The blog job reads its own article and the brand's shared planning credit, and settles its own request.
CREATE FUNCTION app.blog_job_article(blog uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.campaign_blog_requests r WHERE r.job_id=app.job_context() AND r.blog_id=blog)
$$;
REVOKE ALL ON FUNCTION app.blog_job_article(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.blog_job_article(uuid) TO desvio_worker;
GRANT SELECT ON app.campaign_blogs,app.campaign_blog_versions,app.campaign_blog_calls TO desvio_worker;
GRANT UPDATE(title,latest_version_id,state,revision) ON app.campaign_blogs TO desvio_worker;
GRANT INSERT ON app.campaign_blog_versions TO desvio_worker;
GRANT UPDATE(status,error_code,version_id,reserved_micros) ON app.campaign_blog_calls TO desvio_worker;
CREATE POLICY worker_blog_read ON app.campaign_blogs FOR SELECT TO desvio_worker USING(app.blog_scope(organization_id,brand_id) AND app.blog_job_article(id));
CREATE POLICY worker_blog_update ON app.campaign_blogs FOR UPDATE TO desvio_worker USING(app.blog_scope(organization_id,brand_id) AND app.blog_job_article(id)) WITH CHECK(app.blog_scope(organization_id,brand_id) AND app.blog_job_article(id));
CREATE POLICY worker_version_read ON app.campaign_blog_versions FOR SELECT TO desvio_worker USING(app.blog_scope(organization_id,brand_id) AND app.blog_job_article(blog_id));
CREATE POLICY worker_version_insert ON app.campaign_blog_versions FOR INSERT TO desvio_worker WITH CHECK(app.blog_scope(organization_id,brand_id) AND app.blog_job_article(blog_id)
 AND created_by=(SELECT requested_by FROM app.campaign_blog_requests WHERE job_id=app.job_context()));
CREATE POLICY worker_blog_call_read ON app.campaign_blog_calls FOR SELECT TO desvio_worker USING(app.blog_scope(organization_id,brand_id));
CREATE POLICY worker_blog_call_update ON app.campaign_blog_calls FOR UPDATE TO desvio_worker USING(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id)) WITH CHECK(job_id=app.job_context() AND app.blog_scope(organization_id,brand_id));
GRANT SELECT ON app.planning_grants,app.planning_calls TO desvio_worker;
CREATE POLICY worker_blog_grant ON app.planning_grants FOR SELECT TO desvio_worker USING(app.blog_scope(organization_id,brand_id));
CREATE POLICY worker_blog_planning_usage ON app.planning_calls FOR SELECT TO desvio_worker USING(app.blog_scope(organization_id,brand_id));

-- The worker now settles articles too. The review guard is for the API role only, so it must not
-- evaluate API-only access functions (which the worker may not execute) for any other role.
CREATE OR REPLACE FUNCTION app.guard_blog_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='desvio_app' THEN
  IF NOT app.business_access(OLD.organization_id,OLD.brand_id,true) THEN
   IF NOT app.review_access(OLD.organization_id,OLD.brand_id) OR NEW.state<>'approved' OR NEW.latest_version_id IS DISTINCT FROM OLD.latest_version_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Reviewers may only approve the saved article' USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- A blog job reads the business's knowledge graph for its context pack.
CREATE OR REPLACE FUNCTION app.knowledge_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND organization_id=org AND brand_id=brand
  AND kind IN ('website.extract','document.extract','brand.analyze','plan.generate','creative.generate','carousel.generate','creative.video','insight.generate','blog.generate'))
$$;

-- An article request with an uncertain result can be released like research and planning:
-- never retried, the reservation kept, and saved versions untouched.
CREATE OR REPLACE FUNCTION app.stop_waiting_for_request(target uuid, acknowledge_possible_charge boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE request app.jobs%ROWTYPE; child app.jobs%ROWTYPE;
BEGIN
 IF acknowledge_possible_charge IS DISTINCT FROM true THEN RAISE EXCEPTION 'Acknowledge the uncertain provider charge' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant()::text,0));
 SELECT * INTO request FROM app.jobs WHERE id=target AND organization_id=app.tenant() AND app.brand_matches(brand_id);
 IF NOT FOUND OR app.can_access(request.organization_id,true) IS NOT TRUE OR app.business_access(request.organization_id,request.brand_id,true) IS NOT TRUE
    OR request.kind NOT IN ('website.extract','brand.analyze','plan.generate','blog.generate') THEN
  RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO request FROM app.jobs WHERE id=target FOR UPDATE;
 IF request.status='canceled' AND request.error_code='RESULT_ABANDONED' THEN RETURN 'canceled'; END IF;
 IF request.status<>'unknown' THEN RAISE EXCEPTION 'Only a request with an uncertain result can be abandoned' USING ERRCODE='22023'; END IF;
 IF request.kind='plan.generate' AND EXISTS(SELECT 1 FROM app.planning_requests WHERE job_id=target AND output_plan_id IS NOT NULL) THEN
  RAISE EXCEPTION 'A saved plan is available; refresh to review it' USING ERRCODE='22023';
 END IF;
 -- An automatic analysis waiting on this capture can no longer start.
 FOR child IN SELECT j.* FROM app.jobs j JOIN app.intake_dependencies d ON d.analysis_job_id=j.id
  WHERE d.capture_job_id=target ORDER BY j.id FOR UPDATE OF j LOOP
  IF child.status IN ('running','retrying') THEN RAISE EXCEPTION 'Analysis is still active; wait for it to finish' USING ERRCODE='22023'; END IF;
  IF child.status IN ('queued','unknown') THEN
   UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='RESULT_ABANDONED',updated_at=now() WHERE id=child.id;
  END IF;
 END LOOP;
 -- The article can be generated again; its reserved credit stays counted.
 IF request.kind='blog.generate' THEN
  UPDATE app.campaign_blog_calls SET status='abandoned',error_code='RESULT_ABANDONED' WHERE job_id=target AND status IN ('submitted','unknown');
 END IF;
 UPDATE app.jobs SET status='canceled',cancel_requested=true,error_code='RESULT_ABANDONED',updated_at=now() WHERE id=target;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
 VALUES(request.organization_id,request.brand_id,app.actor(),'request.unknown_result_abandoned',target);
 RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION app.stop_waiting_for_request(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stop_waiting_for_request(uuid,boolean) TO desvio_app;
