ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate'));

CREATE TABLE app.canvas_threads (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 request_key text NOT NULL,request_hash text NOT NULL,UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,created_by,request_key),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.creative_projects (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,thread_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),latest_version_id uuid,created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id)
);
CREATE TABLE app.creative_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,thread_id uuid NOT NULL,project_id uuid NOT NULL,brain_id uuid NOT NULL,parent_version_id uuid,
 prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 4000),format text NOT NULL CHECK(format IN ('static','ad')),channel text NOT NULL CHECK(channel IN ('linkedin','instagram')),size text NOT NULL CHECK(size IN ('1024x1024','1536x1024','1024x1536')),
 request_key text NOT NULL,request_hash text NOT NULL,plan jsonb CHECK(octet_length(plan::text)<=200000),output_version_id uuid,
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.creative_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id)
);
CREATE TABLE app.canvas_messages (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,thread_id uuid NOT NULL,job_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('user','assistant')),content text NOT NULL CHECK(length(content) BETWEEN 1 AND 8000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,role),FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.creative_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,text_model text NOT NULL CHECK(length(text_model) BETWEEN 1 AND 100),image_model text NOT NULL CHECK(length(image_model) BETWEEN 1 AND 100),quality text NOT NULL CHECK(quality IN ('low','medium','high')),
 expires_at timestamptz NOT NULL,budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),input_micros_per_token numeric NOT NULL CHECK(input_micros_per_token>0 AND input_micros_per_token<=1000),output_micros_per_token numeric NOT NULL CHECK(output_micros_per_token>0 AND output_micros_per_token<=1000),
 max_image_request_micros bigint NOT NULL CHECK(max_image_request_micros BETWEEN 1 AND 100000000),approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.creative_calls (
 job_id uuid NOT NULL,step text NOT NULL CHECK(step IN ('plan:1','plan:2','plan:3','image')),organization_id uuid NOT NULL,brand_id uuid NOT NULL,model text NOT NULL,input_sha256 text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),result jsonb CHECK(octet_length(result::text)<=500000),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,step),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.creative_media (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,object_key text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 20971520),width integer NOT NULL CHECK(width IN (1024,1536)),height integer NOT NULL CHECK(height IN (1024,1536)),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.creative_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,project_id uuid NOT NULL,parent_id uuid,brain_id uuid NOT NULL,job_id uuid UNIQUE,media_id uuid NOT NULL,
 design jsonb NOT NULL CHECK(octet_length(design::text)<=32000),caption text NOT NULL CHECK(length(caption)<=3000),skill_manifest jsonb NOT NULL CHECK(octet_length(skill_manifest::text)<=200000),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','changes_requested','rejected','approved')),review_revision integer NOT NULL DEFAULT 1,
 reviewed_by uuid REFERENCES auth."user"(id),reviewed_at timestamptz,created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,project_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.creative_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id,parent_id) REFERENCES app.creative_versions(organization_id,brand_id,project_id,id),
 FOREIGN KEY(organization_id,brand_id,brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,media_id) REFERENCES app.creative_media(organization_id,brand_id,id)
);
ALTER TABLE app.creative_projects ADD FOREIGN KEY(organization_id,brand_id,id,latest_version_id) REFERENCES app.creative_versions(organization_id,brand_id,project_id,id);
ALTER TABLE app.creative_requests ADD FOREIGN KEY(organization_id,brand_id,project_id,parent_version_id) REFERENCES app.creative_versions(organization_id,brand_id,project_id,id);
ALTER TABLE app.creative_requests ADD FOREIGN KEY(organization_id,brand_id,project_id,output_version_id) REFERENCES app.creative_versions(organization_id,brand_id,project_id,id);
CREATE TABLE app.creative_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,version_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),decision text NOT NULL CHECK(decision IN ('in_review','changes_requested','rejected','approved')),feedback text NOT NULL CHECK(length(feedback)<=2000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,version_id) REFERENCES app.creative_versions(organization_id,brand_id,id)
);
CREATE FUNCTION app.creative_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'creative.generate') $$;
REVOKE ALL ON FUNCTION app.creative_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creative_scope(uuid,uuid) TO desvio_worker;
CREATE FUNCTION app.creative_reviewer(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.business_access(org,brand,true) AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=org AND user_id=app.actor() AND active AND role IN ('owner','admin')) $$;
REVOKE ALL ON FUNCTION app.creative_reviewer(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creative_reviewer(uuid,uuid) TO desvio_app;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['canvas_threads','creative_projects','creative_requests','canvas_messages','creative_grants','creative_calls','creative_media','creative_versions','creative_reviews'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['creative_projects','creative_requests','creative_grants','creative_calls','creative_media','creative_versions'] LOOP
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON app.canvas_threads,app.canvas_messages,app.creative_projects,app.creative_requests,app.creative_media,app.creative_versions,app.creative_reviews TO desvio_app;
GRANT INSERT ON app.canvas_threads,app.canvas_messages,app.creative_projects,app.creative_requests,app.creative_versions,app.creative_reviews TO desvio_app;
CREATE POLICY thread_create ON app.canvas_threads FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor());
CREATE POLICY project_create ON app.creative_projects FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND latest_version_id IS NULL);
CREATE POLICY request_create ON app.creative_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND plan IS NULL AND output_version_id IS NULL);
CREATE POLICY message_create ON app.canvas_messages FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND role='user');
CREATE POLICY version_edit ON app.creative_versions FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND job_id IS NULL AND status='draft' AND reviewed_by IS NULL AND review_revision=1 AND parent_id IS NOT NULL);
CREATE POLICY version_review ON app.creative_versions FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK((status='in_review' AND reviewed_by IS NULL) OR (app.creative_reviewer(organization_id,brand_id) AND status IN ('approved','rejected','changes_requested') AND reviewed_by=app.actor()));
GRANT UPDATE(status,review_revision,reviewed_by,reviewed_at) ON app.creative_versions TO desvio_app;
CREATE POLICY review_create ON app.creative_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND actor_id=app.actor() AND (decision='in_review' OR app.creative_reviewer(organization_id,brand_id)));
CREATE POLICY project_update ON app.creative_projects FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
GRANT UPDATE(latest_version_id) ON app.creative_projects TO desvio_app,desvio_worker;
CREATE POLICY worker_project ON app.creative_projects FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id)) WITH CHECK(app.creative_scope(organization_id,brand_id));
GRANT SELECT ON app.creative_projects,app.creative_requests,app.creative_grants,app.creative_calls,app.creative_media,app.creative_versions,app.brand_brain_versions TO desvio_worker;
CREATE POLICY worker_brain ON app.brand_brain_versions FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_requests r WHERE r.job_id=app.job_context() AND r.brain_id=brand_brain_versions.id));
CREATE POLICY worker_request ON app.creative_requests FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT UPDATE(plan,output_version_id) ON app.creative_requests TO desvio_worker;
CREATE POLICY worker_call_insert ON app.creative_calls FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_call_update ON app.creative_calls FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT INSERT ON app.creative_calls,app.creative_media,app.creative_versions,app.canvas_messages TO desvio_worker;
GRANT UPDATE(status,result) ON app.creative_calls TO desvio_worker;
CREATE POLICY worker_media_insert ON app.creative_media FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_version_insert ON app.creative_versions FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context() AND status='draft' AND reviewed_by IS NULL AND review_revision=1);
CREATE POLICY worker_message_insert ON app.canvas_messages FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context() AND role='assistant');
