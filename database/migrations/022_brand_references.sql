CREATE TABLE app.brand_references (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 website_visual_id uuid,document_visual_id uuid,label text NOT NULL CHECK(length(label) BETWEEN 1 AND 140),
 approved_by uuid NOT NULL REFERENCES auth."user"(id),approved_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 CHECK(num_nonnulls(website_visual_id,document_visual_id)=1),
 UNIQUE(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,website_visual_id) REFERENCES app.website_visuals(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,document_visual_id) REFERENCES app.document_visuals(organization_id,brand_id,id)
);
CREATE UNIQUE INDEX active_website_reference ON app.brand_references(brand_id,website_visual_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX active_document_reference ON app.brand_references(brand_id,document_visual_id) WHERE revoked_at IS NULL;
ALTER TABLE app.creative_requests ADD UNIQUE(organization_id,brand_id,job_id);
CREATE TABLE app.creative_references (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,job_id uuid NOT NULL,reference_id uuid NOT NULL,position smallint NOT NULL CHECK(position BETWEEN 0 AND 2),
 PRIMARY KEY(job_id,position),UNIQUE(job_id,reference_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.creative_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,reference_id) REFERENCES app.brand_references(organization_id,brand_id,id)
);
ALTER TABLE app.brand_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brand_references FORCE ROW LEVEL SECURITY;
ALTER TABLE app.creative_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.creative_references FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_read ON app.brand_references FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY reference_approve ON app.brand_references FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND approved_by=app.actor() AND revoked_at IS NULL);
CREATE POLICY reference_revoke ON app.brand_references FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND revoked_at IS NULL) WITH CHECK(revoked_at IS NOT NULL);
CREATE POLICY creative_reference_read ON app.creative_references FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY creative_reference_insert ON app.creative_references FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND EXISTS(SELECT 1 FROM app.brand_references r WHERE r.id=reference_id AND r.revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.requested_by=app.actor() AND j.kind='creative.generate' AND j.status='queued')
);
GRANT SELECT,INSERT ON app.brand_references,app.creative_references TO desvio_app;
GRANT UPDATE(revoked_at) ON app.brand_references TO desvio_app;
CREATE POLICY worker_creative_reference ON app.creative_references FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_brand_reference ON app.brand_references FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.creative_references r WHERE r.reference_id=brand_references.id AND r.job_id=app.job_context()));
CREATE POLICY worker_reference_website ON app.website_visuals FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.brand_references r WHERE r.website_visual_id=website_visuals.id));
CREATE POLICY worker_reference_document ON app.document_visuals FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.brand_references r WHERE r.document_visual_id=document_visuals.id));
GRANT SELECT ON app.brand_references,app.creative_references TO desvio_worker;
