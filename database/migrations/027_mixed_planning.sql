-- Editable planning concepts are never generation or publication approvals.
ALTER TABLE app.content_slots ADD COLUMN video_draft jsonb,
 ADD CHECK(video_draft IS NULL OR format='video' AND jsonb_typeof(video_draft)='object' AND octet_length(video_draft::text)<=12000),
 ADD COLUMN request_key text, ADD COLUMN request_hash text,
 ADD CHECK((request_key IS NULL)=(request_hash IS NULL)),
 ADD UNIQUE(organization_id,brand_id,created_by,request_key);
GRANT UPDATE(video_draft) ON app.content_slots TO desvio_app;
ALTER TABLE app.video_requests ADD COLUMN slot_id uuid, ADD COLUMN slot_revision integer,
 ADD CHECK((slot_id IS NULL)=(slot_revision IS NULL)), ADD CHECK(slot_revision>0),
 ADD FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id);
CREATE POLICY video_slot_read ON app.content_slots FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.video_requests r WHERE r.job_id=app.job_context() AND r.slot_id=content_slots.id));
CREATE POLICY video_slot_attach ON app.content_slots FOR UPDATE TO desvio_worker
 USING(app.video_scope(organization_id,brand_id) AND format='video' AND approved_by IS NULL AND state NOT IN ('approved','cancelled') AND EXISTS(SELECT 1 FROM app.video_requests r WHERE r.job_id=app.job_context() AND r.slot_id=content_slots.id AND r.slot_revision=content_slots.revision))
 WITH CHECK(app.video_scope(organization_id,brand_id) AND format='video' AND state='draft_ready' AND approved_by IS NULL AND approved_at IS NULL AND creative_version_id IS NULL AND EXISTS(SELECT 1 FROM app.video_requests r JOIN app.video_versions v ON v.id=r.output_version_id WHERE r.job_id=app.job_context() AND r.slot_id=content_slots.id AND content_slots.revision=r.slot_revision+1 AND v.id=content_slots.video_version_id AND v.sha256=content_slots.video_sha256));
GRANT UPDATE(video_version_id,video_sha256,revision,state,updated_at) ON app.content_slots TO desvio_worker;
CREATE POLICY video_slot_event ON app.content_slot_events FOR INSERT TO desvio_worker WITH CHECK(app.video_scope(organization_id,brand_id) AND action='creative_attached' AND EXISTS(SELECT 1 FROM app.video_requests r JOIN app.jobs j ON j.id=r.job_id JOIN app.content_slots s ON s.id=r.slot_id WHERE r.job_id=app.job_context() AND s.id=content_slot_events.slot_id AND s.revision=content_slot_events.revision AND s.video_version_id=content_slot_events.video_version_id AND j.requested_by=content_slot_events.actor_id AND s.video_sha256=content_slot_events.video_sha256));
