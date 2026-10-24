CREATE TABLE app.video_projects (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,thread_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),latest_version_id uuid,
 UNIQUE(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id)
);
CREATE TABLE app.video_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,project_id uuid NOT NULL,brain_id uuid NOT NULL,
 prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 4000),channel text NOT NULL CHECK(channel IN ('instagram','linkedin')),duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 3 AND 15),
 draft_revision integer NOT NULL DEFAULT 1 CHECK(draft_revision>0),edited_brief jsonb CHECK(octet_length(edited_brief::text)<=40000),approved_brief jsonb CHECK(octet_length(approved_brief::text)<=40000),approved_revision integer,approved_by uuid REFERENCES auth."user"(id),approved_at timestamptz,
 CHECK((approved_by IS NULL)=(approved_at IS NULL)),CHECK((approved_by IS NULL)=(approved_brief IS NULL)),CHECK(approved_revision IS NULL OR approved_revision=draft_revision),
 request_key text NOT NULL,request_hash text NOT NULL,plan jsonb CHECK(octet_length(plan::text)<=200000),output_version_id uuid,
 UNIQUE(organization_id,brand_id,request_key),UNIQUE(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_references(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.video_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,brain_id) REFERENCES app.brand_brain_versions(organization_id,brand_id,id)
);
CREATE TABLE app.video_bases (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,object_key text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 24 AND 67108864),
 width integer NOT NULL CHECK(width BETWEEN 64 AND 1920),height integer NOT NULL CHECK(height BETWEEN 64 AND 1920),duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 2750 AND 15250),
 manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=16000),
 UNIQUE(organization_id,brand_id,job_id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_requests(organization_id,brand_id,job_id),
 CHECK(object_key='video/'||organization_id::text||'/'||brand_id::text||'/'||job_id::text||'/base/'||sha256)
);
CREATE TABLE app.video_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,project_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,
 object_key text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 24 AND 67108864),
 poster_key text NOT NULL,poster_sha256 text NOT NULL CHECK(poster_sha256 ~ '^[a-f0-9]{64}$'),poster_bytes integer NOT NULL CHECK(poster_bytes BETWEEN 24 AND 2097152),
 caption text NOT NULL CHECK(length(caption)<=3000),overlays jsonb NOT NULL CHECK(octet_length(overlays::text)<=6000),manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=200000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','rejected','changes_requested')),review_revision integer NOT NULL DEFAULT 1,
 reviewed_by uuid REFERENCES auth."user"(id),reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,project_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.video_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_bases(organization_id,brand_id,job_id),
 CHECK(object_key='video/'||organization_id::text||'/'||brand_id::text||'/'||job_id::text||'/render/'||sha256),
 CHECK(poster_key='video/'||organization_id::text||'/'||brand_id::text||'/'||job_id::text||'/poster/'||poster_sha256)
);
ALTER TABLE app.video_projects ADD FOREIGN KEY(organization_id,brand_id,id,latest_version_id) REFERENCES app.video_versions(organization_id,brand_id,project_id,id);
ALTER TABLE app.video_requests ADD FOREIGN KEY(organization_id,brand_id,project_id,output_version_id) REFERENCES app.video_versions(organization_id,brand_id,project_id,id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['video_projects','video_requests','video_bases','video_versions'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY customer_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON app.video_projects,app.video_requests,app.video_bases,app.video_versions TO desvio_app,desvio_worker;
GRANT INSERT ON app.video_projects,app.video_requests TO desvio_app;
CREATE POLICY project_create ON app.video_projects FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND latest_version_id IS NULL);
CREATE POLICY request_create ON app.video_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND plan IS NULL AND output_version_id IS NULL AND draft_revision=1 AND edited_brief IS NULL AND approved_brief IS NULL AND approved_revision IS NULL AND approved_by IS NULL);
GRANT UPDATE(plan,output_version_id) ON app.video_requests TO desvio_worker;
CREATE POLICY worker_request ON app.video_requests FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT UPDATE(latest_version_id) ON app.video_projects TO desvio_worker;
CREATE POLICY worker_project ON app.video_projects FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_requests r WHERE r.job_id=app.job_context() AND r.project_id=video_projects.id));
GRANT INSERT ON app.video_bases,app.video_versions TO desvio_worker;
CREATE POLICY worker_base ON app.video_bases FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_version ON app.video_versions FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND status='draft' AND review_revision=1 AND reviewed_by IS NULL);
CREATE POLICY video_brain ON app.brand_brain_versions FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_requests r WHERE r.job_id=app.job_context() AND r.brain_id=brand_brain_versions.id));
CREATE POLICY video_text_grant ON app.creative_grants FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id));
CREATE POLICY video_plan_read ON app.creative_calls FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id));
CREATE POLICY video_plan_insert ON app.creative_calls FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND step IN ('plan:1','plan:2','plan:3'));
CREATE POLICY video_plan_update ON app.creative_calls FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND step IN ('plan:1','plan:2','plan:3'));

GRANT UPDATE(status,review_revision,reviewed_by,reviewed_at) ON app.video_versions TO desvio_app;
CREATE POLICY customer_review ON app.video_versions FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND (status='in_review' AND reviewed_by IS NULL OR status IN ('approved','rejected','changes_requested') AND app.creative_reviewer(organization_id,brand_id) AND reviewed_by=app.actor()));
CREATE TABLE app.video_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,version_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),decision text NOT NULL CHECK(decision IN ('in_review','approved','rejected','changes_requested')),
 feedback text NOT NULL CHECK(length(feedback)<=2000),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),revision integer NOT NULL CHECK(revision>1),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version_id,revision),FOREIGN KEY(organization_id,brand_id,version_id) REFERENCES app.video_versions(organization_id,brand_id,id)
);
ALTER TABLE app.video_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_reviews FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.video_reviews TO desvio_app;
CREATE POLICY review_read ON app.video_reviews FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY review_create ON app.video_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND actor_id=app.actor() AND (decision='in_review' OR app.creative_reviewer(organization_id,brand_id)));

GRANT UPDATE(draft_revision,edited_brief,approved_brief,approved_revision,approved_by,approved_at) ON app.video_requests TO desvio_app;
CREATE POLICY prompt_edit ON app.video_requests FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND (approved_by IS NULL OR approved_by=app.actor() AND app.creative_reviewer(organization_id,brand_id)));
