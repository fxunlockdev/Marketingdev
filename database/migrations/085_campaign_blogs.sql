CREATE TABLE app.campaign_blogs(id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,plan_id uuid NOT NULL,title text NOT NULL,brief text NOT NULL,planned_at timestamptz NOT NULL,latest_version_id uuid,state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','archived')),revision integer NOT NULL DEFAULT 1,request_key text NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,plan_id) REFERENCES app.content_plans(organization_id,brand_id,id));
CREATE TABLE app.campaign_blog_versions(id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,blog_id uuid NOT NULL,title text NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL,FOREIGN KEY(organization_id,brand_id,blog_id) REFERENCES app.campaign_blogs(organization_id,brand_id,id));
CREATE TABLE app.campaign_blog_calls(id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,blog_id uuid NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,revision integer NOT NULL,model text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),error_code text,version_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,blog_id) REFERENCES app.campaign_blogs(organization_id,brand_id,id));
CREATE UNIQUE INDEX campaign_blog_active_call ON app.campaign_blog_calls(blog_id) WHERE status='submitted';
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['campaign_blogs','campaign_blog_versions','campaign_blog_calls'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('GRANT SELECT,INSERT ON app.%I TO desvio_app',tab);
 EXECUTE format('CREATE POLICY member_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 EXECUTE format('CREATE POLICY writer_insert ON app.%I FOR INSERT TO desvio_app WITH CHECK(app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true))',tab);
 IF tab<>'campaign_blog_versions' THEN
 EXECUTE format('GRANT UPDATE ON app.%I TO desvio_app',tab);
 EXECUTE format('CREATE POLICY writer_update ON app.%I FOR UPDATE TO desvio_app USING(app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true))',tab);
 END IF;END LOOP;END $$;
CREATE TRIGGER monthly_blog_reservation AFTER INSERT ON app.campaign_blog_calls FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
GRANT SELECT(organization_id,brand_id,provider,reserved_micros) ON app.planning_calls TO desvio_app;
CREATE POLICY blog_planning_usage ON app.planning_calls FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- Immutable history and tenant-bound version pointers: another article's version
-- can never become this article's active content, even within the same brand.
ALTER TABLE app.campaign_blogs ADD CHECK(length(title) BETWEEN 1 AND 200), ADD CHECK(length(brief) BETWEEN 1 AND 4000), ADD CHECK(revision>0);
ALTER TABLE app.campaign_blog_versions ADD UNIQUE(organization_id,brand_id,blog_id,id), ADD CHECK(length(title) BETWEEN 1 AND 200), ADD CHECK(length(body) BETWEEN 1 AND 40000);
ALTER TABLE app.campaign_blogs ADD FOREIGN KEY(organization_id,brand_id,id,latest_version_id) REFERENCES app.campaign_blog_versions(organization_id,brand_id,blog_id,id);
ALTER TABLE app.campaign_blog_calls ADD FOREIGN KEY(organization_id,brand_id,blog_id,version_id) REFERENCES app.campaign_blog_versions(organization_id,brand_id,blog_id,id), ADD CHECK(revision>0), ADD CHECK((status='succeeded')=(version_id IS NOT NULL));
REVOKE UPDATE ON app.campaign_blogs,app.campaign_blog_calls FROM desvio_app;
GRANT UPDATE(title,latest_version_id,state,revision) ON app.campaign_blogs TO desvio_app;
GRANT UPDATE(status,error_code,version_id) ON app.campaign_blog_calls TO desvio_app;
GRANT SELECT(organization_id,brand_id,reserved_micros) ON app.campaign_blog_calls TO desvio_worker;
CREATE POLICY worker_blog_budget_read ON app.campaign_blog_calls FOR SELECT TO desvio_worker USING(app.planning_scope(organization_id,brand_id));
CREATE POLICY reviewer_approve ON app.campaign_blogs FOR UPDATE TO desvio_app USING(app.brand_matches(brand_id) AND app.review_access(organization_id,brand_id)) WITH CHECK(app.brand_matches(brand_id) AND app.review_access(organization_id,brand_id) AND state='approved' AND latest_version_id IS NOT NULL);
CREATE FUNCTION app.guard_blog_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='desvio_app' AND NOT app.business_access(OLD.organization_id,OLD.brand_id,true) THEN
  IF NOT app.review_access(OLD.organization_id,OLD.brand_id) OR NEW.state<>'approved' OR NEW.latest_version_id IS DISTINCT FROM OLD.latest_version_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'Reviewers may only approve the saved article' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_blog_review() FROM PUBLIC;
CREATE TRIGGER guard_blog_review BEFORE UPDATE ON app.campaign_blogs FOR EACH ROW EXECUTE FUNCTION app.guard_blog_review();
