-- Explicit consent to send an exact approved Canvas image to the video provider.
-- Video-to-video source bindings will use canonical video versions when that
-- schema exists; never accept a caller-supplied URL as a substitute.
ALTER TABLE app.creative_export_approvals ADD UNIQUE(organization_id,brand_id,id);
CREATE TABLE app.video_references (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 export_id uuid NOT NULL,approval_id uuid NOT NULL,version_id uuid NOT NULL,project_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 export_sha256 text NOT NULL CHECK(export_sha256 ~ '^[a-f0-9]{64}$'),
 review_revision integer NOT NULL CHECK(review_revision>0),consented_by uuid NOT NULL REFERENCES auth."user"(id),consented_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,export_id) REFERENCES app.creative_exports(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,approval_id) REFERENCES app.creative_export_approvals(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id,version_id) REFERENCES app.creative_versions(organization_id,brand_id,project_id,id)
);
CREATE TABLE app.video_reference_leases (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 object_key text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 20971520),
 encrypted_url bytea NOT NULL CHECK(octet_length(encrypted_url) BETWEEN 30 AND 8192),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','active','revoking','revoked')),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.video_references(organization_id,brand_id,job_id),
 CHECK(object_key='video-reference/'||organization_id::text||'/'||brand_id::text||'/'||job_id::text||'/'||sha256)
);
ALTER TABLE app.video_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_references FORCE ROW LEVEL SECURITY;
ALTER TABLE app.video_reference_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_reference_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_read ON app.video_references FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY customer_read ON app.video_reference_leases FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY customer_bind ON app.video_references FOR INSERT TO desvio_app WITH CHECK(
 app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND consented_by=app.actor()
 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='creative.video' AND j.status='queued' AND NOT j.cancel_requested AND j.requested_by=app.actor())
 AND EXISTS(SELECT 1 FROM app.creative_exports e JOIN app.creative_versions v ON v.id=e.version_id JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_export_approvals a ON a.export_id=e.id
 WHERE e.id=video_references.export_id AND a.id=video_references.approval_id AND a.context_type='canvas' AND a.context_id=v.id AND a.context_revision=v.review_revision
 AND v.status='approved' AND v.reviewed_by IS NOT NULL AND p.latest_version_id=v.id AND v.id=video_references.version_id AND p.id=video_references.project_id
 AND v.sha256=video_references.source_sha256 AND e.source_sha256=v.sha256 AND e.sha256=video_references.export_sha256 AND v.review_revision=video_references.review_revision)
);
CREATE POLICY worker_read ON app.video_references FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_read ON app.video_reference_leases FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_insert ON app.video_reference_leases FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context() AND state='prepared' AND expires_at>now() AND expires_at<=now()+interval '8 hours' AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=video_reference_leases.job_id AND r.export_sha256=video_reference_leases.sha256));
CREATE POLICY worker_update ON app.video_reference_leases FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.video_scope(organization_id,brand_id) AND job_id=app.job_context());
GRANT SELECT,INSERT ON app.video_references TO desvio_app;
GRANT SELECT(job_id,organization_id,brand_id,sha256,bytes,expires_at,created_at,state) ON app.video_reference_leases TO desvio_app;
GRANT SELECT ON app.video_references,app.video_reference_leases TO desvio_worker;
GRANT INSERT ON app.video_reference_leases TO desvio_worker;
GRANT UPDATE(state) ON app.video_reference_leases TO desvio_worker;
GRANT SELECT ON app.creative_export_approvals TO desvio_worker;
CREATE POLICY video_reference_export ON app.creative_exports FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=app.job_context() AND r.export_id=creative_exports.id));
CREATE POLICY video_reference_approval ON app.creative_export_approvals FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=app.job_context() AND r.approval_id=creative_export_approvals.id));
CREATE POLICY video_reference_version ON app.creative_versions FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=app.job_context() AND r.version_id=creative_versions.id));
CREATE POLICY video_reference_project ON app.creative_projects FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_references r WHERE r.job_id=app.job_context() AND r.project_id=creative_projects.id));
