-- Multi-shot reels. A reel is one video request (one allowance, one approval, one version)
-- whose shots are generated as separate Runway clips. Each shot runs on its own
-- provider-only job, so the existing durable ledger (reservation, frozen intent,
-- submission marker, unknown hold) applies to every paid clip unchanged. Shot jobs are
-- never dispatched on their own: the reel's workflow advances them in order.
ALTER TABLE app.video_requests ADD COLUMN shot_count integer NOT NULL DEFAULT 1 CHECK(shot_count BETWEEN 1 AND 5);

CREATE TABLE app.reel_shots (
 job_id uuid PRIMARY KEY,
 parent_job_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 shot_index integer NOT NULL CHECK(shot_index BETWEEN 0 AND 4),
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 3 AND 15),
 object_key text,
 sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer CHECK(bytes BETWEEN 24 AND 67108864),
 manifest jsonb CHECK(manifest IS NULL OR octet_length(manifest::text)<=16000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(parent_job_id,shot_index),
 UNIQUE(organization_id,brand_id,job_id),
 CHECK(job_id<>parent_job_id),
 CHECK(num_nonnulls(object_key,sha256,bytes,manifest) IN (0,4)),
 CHECK(object_key IS NULL OR object_key='video/'||organization_id::text||'/'||brand_id::text||'/'||parent_job_id::text||'/shot/'||shot_index::text||'/'||sha256),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,parent_job_id) REFERENCES app.video_requests(organization_id,brand_id,job_id)
);
CREATE INDEX reel_shots_parent ON app.reel_shots(parent_job_id);
ALTER TABLE app.reel_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reel_shots FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_read ON app.reel_shots FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- The requester creates the shot jobs with the reel request, in the same transaction.
CREATE POLICY customer_create ON app.reel_shots FOR INSERT TO desvio_app WITH CHECK(
 app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND object_key IS NULL
 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=reel_shots.job_id AND j.kind='creative.video' AND j.status='queued' AND NOT j.cancel_requested AND j.requested_by=app.actor())
 AND EXISTS(SELECT 1 FROM app.jobs p JOIN app.video_requests r ON r.job_id=p.id WHERE p.id=reel_shots.parent_job_id AND p.status='queued' AND p.requested_by=app.actor() AND r.plan IS NULL AND r.shot_count>reel_shots.shot_index)
);
CREATE POLICY worker_read ON app.reel_shots FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND (job_id=app.job_context() OR parent_job_id=app.job_context()));
-- A shot's canonical clip is recorded once, by the reel's own workflow.
CREATE POLICY worker_base ON app.reel_shots FOR UPDATE TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND parent_job_id=app.job_context() AND object_key IS NULL) WITH CHECK(app.video_scope(organization_id,brand_id) AND parent_job_id=app.job_context());
GRANT SELECT,INSERT ON app.reel_shots TO desvio_app;
GRANT SELECT ON app.reel_shots TO desvio_worker;
GRANT UPDATE(object_key,sha256,bytes,manifest) ON app.reel_shots TO desvio_worker;
-- A shot job re-checks its reel's calendar post (revision, format, state) before any paid call.
CREATE POLICY reel_shot_slot_read ON app.content_slots FOR SELECT TO desvio_worker USING(app.video_scope(organization_id,brand_id) AND EXISTS(
 SELECT 1 FROM app.reel_shots s JOIN app.video_requests r ON r.job_id=s.parent_job_id WHERE s.job_id=app.job_context() AND r.slot_id=content_slots.id));
