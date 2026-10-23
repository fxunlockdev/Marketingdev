ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','creative.video','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile','insight.generate','carousel.generate'));
CREATE FUNCTION app.carousel_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'carousel.generate') $$;
REVOKE ALL ON FUNCTION app.carousel_scope(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.carousel_scope(uuid,uuid) TO desvio_worker;
CREATE TABLE app.carousel_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,project_id uuid NOT NULL,thread_id uuid NOT NULL,
 input jsonb NOT NULL CHECK(octet_length(input::text)<=300000),input_sha256 text NOT NULL,text_provider text NOT NULL CHECK(text_provider IN ('openai','gemini')),selected_text_model text NOT NULL,
 memory_context jsonb NOT NULL DEFAULT '[]',renderer_image text NOT NULL CHECK(renderer_image ~ '^sha256:[a-f0-9]{64}$'),
 request_key text NOT NULL,request_hash text NOT NULL,plan jsonb CHECK(octet_length(plan::text)<=100000),output_version_id uuid,canceled boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,brand_id,job_id),UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.carousel_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,thread_id) REFERENCES app.canvas_threads(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id,output_version_id) REFERENCES app.carousel_versions(organization_id,brand_id,project_id,id)
);
CREATE TABLE app.carousel_children (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,parent_job_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 9),generation_job_id uuid NOT NULL UNIQUE,export_job_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(parent_job_id,position),FOREIGN KEY(organization_id,brand_id,parent_job_id) REFERENCES app.carousel_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,generation_job_id) REFERENCES app.jobs(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,export_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.carousel_versions ADD COLUMN generation_job_id uuid UNIQUE,ADD FOREIGN KEY(organization_id,brand_id,generation_job_id) REFERENCES app.jobs(organization_id,brand_id,id);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['carousel_requests','carousel_children'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;END $$;
GRANT SELECT,INSERT ON app.carousel_requests,app.carousel_children TO desvio_app;
GRANT UPDATE(canceled) ON app.carousel_requests TO desvio_app;
CREATE POLICY request_create ON app.carousel_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND plan IS NULL AND output_version_id IS NULL AND NOT canceled AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='carousel.generate' AND j.requested_by=app.actor()));
CREATE POLICY request_cancel ON app.carousel_requests FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(canceled AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY child_create ON app.carousel_children FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=parent_job_id AND j.kind='carousel.generate' AND j.requested_by=app.actor()) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=generation_job_id AND j.kind='creative.generate' AND j.requested_by=app.actor()) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=export_job_id AND j.kind='creative.export' AND j.requested_by=app.actor()));
GRANT SELECT ON app.carousel_requests,app.carousel_children TO desvio_worker;
GRANT UPDATE(plan,output_version_id) ON app.carousel_requests TO desvio_worker;
CREATE POLICY worker_children ON app.carousel_children FOR SELECT TO desvio_worker USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND (app.carousel_scope(organization_id,brand_id) AND parent_job_id=app.job_context() OR generation_job_id=app.job_context() OR export_job_id=app.job_context()));
CREATE POLICY worker_request_read ON app.carousel_requests FOR SELECT TO desvio_worker USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND (app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context() OR EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.parent_job_id=job_id AND (c.generation_job_id=app.job_context() OR c.export_job_id=app.job_context()))));
CREATE POLICY worker_request_write ON app.carousel_requests FOR UPDATE TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context());
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['creative_grants','gemini_creative_grants','creative_calls','memory_lessons'] LOOP
 EXECUTE format('CREATE POLICY carousel_read ON app.%I FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id))',tab);
 END LOOP;END $$;
CREATE POLICY carousel_call_create ON app.creative_calls FOR INSERT TO desvio_worker WITH CHECK(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context() AND step IN ('plan:1','plan:2','plan:3'));
CREATE POLICY carousel_call_update ON app.creative_calls FOR UPDATE TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY carousel_child_request ON app.creative_requests FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.parent_job_id=app.job_context() AND c.generation_job_id=job_id));
CREATE POLICY carousel_child_version ON app.creative_versions FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.parent_job_id=app.job_context() AND c.generation_job_id=job_id));
CREATE POLICY carousel_child_project ON app.creative_projects FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_requests r WHERE r.project_id=creative_projects.id));
CREATE POLICY carousel_child_export ON app.creative_exports FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.parent_job_id=app.job_context() AND c.export_job_id=job_id));
GRANT INSERT ON app.creative_export_requests TO desvio_worker;
-- Bind the exact child output without reading versions here: version read policies refer
-- back to export requests. ExportJobs verifies the immutable source hash before rendering.
CREATE POLICY carousel_export_request ON app.creative_export_requests FOR INSERT TO desvio_worker WITH CHECK(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_children c JOIN app.creative_requests r ON r.job_id=c.generation_job_id JOIN app.carousel_requests cr ON cr.job_id=c.parent_job_id WHERE c.parent_job_id=app.job_context() AND c.export_job_id=creative_export_requests.job_id AND r.output_version_id=creative_export_requests.version_id AND cr.renderer_image=creative_export_requests.renderer_image));
CREATE POLICY carousel_export_request_read ON app.creative_export_requests FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_children c WHERE c.parent_job_id=app.job_context() AND c.export_job_id=job_id));
GRANT SELECT,INSERT ON app.carousel_versions,app.carousel_pages TO desvio_worker;
GRANT SELECT,UPDATE(latest_version_id) ON app.carousel_projects TO desvio_worker;
CREATE POLICY carousel_project_read ON app.carousel_projects FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_requests r WHERE r.job_id=app.job_context() AND r.project_id=id));
CREATE POLICY carousel_project_update ON app.carousel_projects FOR UPDATE TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_requests r WHERE r.job_id=app.job_context() AND r.project_id=id)) WITH CHECK(EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=latest_version_id AND v.generation_job_id=app.job_context()));
CREATE POLICY carousel_version_read ON app.carousel_versions FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND generation_job_id=app.job_context());
CREATE POLICY carousel_version_create ON app.carousel_versions FOR INSERT TO desvio_worker WITH CHECK(app.carousel_scope(organization_id,brand_id) AND generation_job_id=app.job_context() AND parent_id IS NULL AND status='draft' AND review_revision=1 AND reviewed_by IS NULL AND EXISTS(SELECT 1 FROM app.jobs j JOIN app.carousel_requests r ON r.job_id=j.id WHERE j.id=app.job_context() AND r.project_id=carousel_versions.project_id AND j.requested_by=created_by));
CREATE POLICY carousel_page_read ON app.carousel_pages FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=carousel_version_id AND v.generation_job_id=app.job_context()));
CREATE POLICY carousel_page_create ON app.carousel_pages FOR INSERT TO desvio_worker WITH CHECK(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=carousel_version_id AND v.generation_job_id=app.job_context() AND v.status='draft') AND EXISTS(SELECT 1 FROM app.carousel_children c JOIN app.creative_requests r ON r.job_id=c.generation_job_id JOIN app.creative_exports e ON e.job_id=c.export_job_id WHERE c.parent_job_id=app.job_context() AND c.position=carousel_pages.position AND r.output_version_id=carousel_pages.creative_version_id AND e.id=carousel_pages.export_id AND e.version_id=carousel_pages.creative_version_id));
