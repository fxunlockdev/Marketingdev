ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export'));
CREATE TABLE app.creative_export_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,version_id uuid NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),renderer_image text NOT NULL CHECK(renderer_image ~ '^sha256:[a-f0-9]{64}$'),
 request_key text NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,version_id) REFERENCES app.creative_versions(organization_id,brand_id,id)
);
CREATE TABLE app.creative_exports (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,version_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),renderer_image text NOT NULL CHECK(renderer_image ~ '^sha256:[a-f0-9]{64}$'),media_sha256 text NOT NULL CHECK(media_sha256 ~ '^[a-f0-9]{64}$'),
 object_key text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 20971520),width integer NOT NULL CHECK(width IN (1024,1536)),height integer NOT NULL CHECK(height IN (1024,1536)),manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=20000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,version_id,renderer_image),FOREIGN KEY(job_id) REFERENCES app.creative_export_requests(job_id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id,version_id) REFERENCES app.creative_versions(organization_id,brand_id,id)
);
CREATE TABLE app.creative_export_approvals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,export_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),
 context_id uuid NOT NULL,context_type text NOT NULL CHECK(context_type IN ('canvas','slot')),context_revision integer NOT NULL CHECK(context_revision>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(export_id,actor_id,context_type,context_id,context_revision),FOREIGN KEY(organization_id,brand_id,export_id) REFERENCES app.creative_exports(organization_id,brand_id,id)
);
CREATE FUNCTION app.export_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'creative.export') $$;
REVOKE ALL ON FUNCTION app.export_scope(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.export_scope(uuid,uuid) TO desvio_worker;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['creative_export_requests','creative_exports','creative_export_approvals'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON app.creative_export_requests,app.creative_exports,app.creative_export_approvals TO desvio_app;
GRANT INSERT ON app.creative_export_requests,app.creative_export_approvals TO desvio_app;
CREATE POLICY export_request_create ON app.creative_export_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='creative.export' AND j.requested_by=app.actor()));
CREATE POLICY export_approval_create ON app.creative_export_approvals FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.creative_reviewer(organization_id,brand_id) AND actor_id=app.actor() AND EXISTS(
 SELECT 1 FROM app.creative_exports e JOIN app.creative_versions v ON v.id=e.version_id JOIN app.creative_projects p ON p.id=v.project_id WHERE e.id=export_id AND p.latest_version_id=v.id AND e.source_sha256=v.sha256 AND (
 (context_type='canvas' AND context_id=v.id AND context_revision=v.review_revision AND v.status='approved') OR
 (context_type='slot' AND EXISTS(SELECT 1 FROM app.content_slots s WHERE s.id=context_id AND s.state='approved' AND s.revision=context_revision AND s.creative_version_id=v.id AND s.creative_sha256=v.sha256))
 )));
GRANT SELECT ON app.creative_export_requests,app.creative_exports TO desvio_worker;
GRANT INSERT ON app.creative_exports TO desvio_worker;
CREATE POLICY worker_request ON app.creative_export_requests FOR SELECT TO desvio_worker USING(app.export_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_export_read ON app.creative_exports FOR SELECT TO desvio_worker USING(app.export_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_export_requests r WHERE r.job_id=app.job_context() AND r.version_id=creative_exports.version_id AND r.renderer_image=creative_exports.renderer_image));
CREATE POLICY worker_export_create ON app.creative_exports FOR INSERT TO desvio_worker WITH CHECK(app.export_scope(organization_id,brand_id) AND job_id=app.job_context() AND EXISTS(SELECT 1 FROM app.creative_export_requests r WHERE r.job_id=app.job_context() AND r.version_id=creative_exports.version_id AND r.source_sha256=creative_exports.source_sha256 AND r.renderer_image=creative_exports.renderer_image));
CREATE POLICY export_version_read ON app.creative_versions FOR SELECT TO desvio_worker USING(app.export_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_export_requests r WHERE r.job_id=app.job_context() AND r.version_id=creative_versions.id));
CREATE POLICY export_media_read ON app.creative_media FOR SELECT TO desvio_worker USING(app.export_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_versions v WHERE v.media_id=creative_media.id));
