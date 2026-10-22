CREATE TABLE app.content_slot_generations (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,slot_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),feedback text NOT NULL CHECK(length(feedback)<=2000),request_key text NOT NULL,request_hash text NOT NULL,
 requested_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 attachment_status text NOT NULL DEFAULT 'pending' CHECK(attachment_status IN ('pending','attached','needs_attachment')),attached_version_id uuid,
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(job_id) REFERENCES app.creative_requests(job_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,attached_version_id) REFERENCES app.creative_versions(organization_id,brand_id,id),
 CHECK((attachment_status='attached')=(attached_version_id IS NOT NULL))
);
CREATE INDEX slot_generation_history ON app.content_slot_generations(slot_id,created_at DESC);
ALTER TABLE app.content_slot_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_slot_generations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.content_slot_generations FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_create ON app.content_slot_generations FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND requested_by=app.actor() AND attachment_status='pending' AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.requested_by=app.actor() AND j.kind='creative.generate' AND j.organization_id=content_slot_generations.organization_id AND j.brand_id=content_slot_generations.brand_id));
GRANT SELECT,INSERT ON app.content_slot_generations TO desvio_app;
GRANT SELECT ON app.content_slot_generations TO desvio_worker;
CREATE POLICY worker_link ON app.content_slot_generations FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_link_update ON app.content_slot_generations FOR UPDATE TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.creative_scope(organization_id,brand_id) AND job_id=app.job_context() AND (attachment_status='needs_attachment' OR (attachment_status='attached' AND EXISTS(SELECT 1 FROM app.creative_versions v WHERE v.id=attached_version_id AND v.job_id=app.job_context()))));
GRANT UPDATE(attachment_status,attached_version_id) ON app.content_slot_generations TO desvio_worker;
CREATE POLICY creative_slot_read ON app.content_slots FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.content_slot_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id));
CREATE POLICY creative_slot_attach ON app.content_slots FOR UPDATE TO desvio_worker
 USING(app.creative_scope(organization_id,brand_id) AND approved_by IS NULL AND state NOT IN ('approved','cancelled') AND EXISTS(SELECT 1 FROM app.content_slot_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id AND g.source_revision=content_slots.revision))
 WITH CHECK(app.creative_scope(organization_id,brand_id) AND state='draft_ready' AND approved_by IS NULL AND approved_at IS NULL AND EXISTS(SELECT 1 FROM app.creative_versions v WHERE v.id=content_slots.creative_version_id AND v.sha256=content_slots.creative_sha256 AND v.job_id=app.job_context()) AND EXISTS(SELECT 1 FROM app.content_slot_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id AND content_slots.revision=g.source_revision+1));
GRANT UPDATE(creative_version_id,creative_sha256,revision,state,updated_at) ON app.content_slots TO desvio_worker;
ALTER TABLE app.content_slot_events DROP CONSTRAINT content_slot_events_action_check;
ALTER TABLE app.content_slot_events ADD CHECK(action IN ('created','edited','pending_review','approved','changes_requested','rejected','cancelled','generation_requested','creative_attached'));
CREATE POLICY creative_slot_event ON app.content_slot_events FOR INSERT TO desvio_worker WITH CHECK(app.creative_scope(organization_id,brand_id) AND action='creative_attached' AND EXISTS(SELECT 1 FROM app.content_slot_generations g JOIN app.jobs j ON j.id=g.job_id JOIN app.content_slots s ON s.id=g.slot_id WHERE g.job_id=app.job_context() AND s.id=content_slot_events.slot_id AND s.revision=content_slot_events.revision AND s.creative_version_id=content_slot_events.creative_version_id AND j.requested_by=content_slot_events.actor_id AND s.creative_sha256=content_slot_events.creative_sha256));
