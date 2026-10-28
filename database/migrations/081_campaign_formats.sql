-- NULL preserves legacy dimensions/placement. New explicit format specs are immutable
-- generation snapshots; changing a slot spec requires a new revision and review.
CREATE FUNCTION app.valid_creative_spec(spec jsonb,media text,channel text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF spec IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(spec)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(spec))<>3
 OR media IS NULL OR channel IS NULL OR NOT spec ?& ARRAY['placement','aspect','slide_count'] OR media NOT IN ('static','ad','video','carousel') OR channel NOT IN ('instagram','facebook','linkedin') THEN RETURN false; END IF;
 IF spec->>'placement' NOT IN ('feed','story','reel') OR spec->>'aspect' NOT IN ('square','portrait','landscape','vertical') OR spec->>'placement' IS NULL OR spec->>'aspect' IS NULL THEN RETURN false; END IF;
 IF spec->>'placement'='feed' THEN
  IF spec->>'aspect'='vertical' THEN RETURN false; END IF;
 ELSE
  IF spec->>'aspect'<>'vertical' OR channel='linkedin' OR media IN ('ad','carousel') THEN RETURN false; END IF;
 END IF;
 IF spec->>'placement'='reel' AND media<>'video' THEN RETURN false; END IF;
 IF media='carousel' THEN
  RETURN jsonb_typeof(spec->'slide_count')='number' AND (spec->>'slide_count')::numeric BETWEEN 2 AND 10 AND (spec->>'slide_count')::numeric=trunc((spec->>'slide_count')::numeric);
 END IF;
 RETURN spec->'slide_count'='null'::jsonb;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.valid_creative_spec(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.valid_creative_spec(jsonb,text,text) TO desvio_app,desvio_worker;
ALTER TABLE app.content_slots ADD COLUMN creative_spec jsonb CHECK(app.valid_creative_spec(creative_spec,format,channel));
ALTER TABLE app.creative_requests ADD COLUMN creative_spec jsonb CHECK(app.valid_creative_spec(creative_spec,format,channel));
ALTER TABLE app.video_requests ADD COLUMN creative_spec jsonb CHECK(app.valid_creative_spec(creative_spec,'video',channel));
ALTER TABLE app.carousel_requests ADD COLUMN creative_spec jsonb CHECK(app.valid_creative_spec(creative_spec,'carousel',input->>'channel')),
 ADD COLUMN max_cost_micros bigint CHECK(max_cost_micros BETWEEN 1 AND 1000000000);
GRANT UPDATE(creative_spec) ON app.content_slots TO desvio_app;

CREATE TABLE app.content_slot_carousel_generations (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,slot_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),creative_spec jsonb,
 requested_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 attachment_status text NOT NULL DEFAULT 'pending' CHECK(attachment_status IN ('pending','attached','needs_attachment')),attached_version_id uuid,
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.carousel_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,attached_version_id) REFERENCES app.carousel_versions(organization_id,brand_id,id),
 CHECK((attachment_status='attached')=(attached_version_id IS NOT NULL))
);
CREATE INDEX slot_carousel_generation_history ON app.content_slot_carousel_generations(slot_id,created_at DESC);
ALTER TABLE app.content_slot_carousel_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_slot_carousel_generations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.content_slot_carousel_generations FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_create ON app.content_slot_carousel_generations FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND requested_by=app.actor() AND attachment_status='pending' AND EXISTS(SELECT 1 FROM app.carousel_requests r JOIN app.jobs j ON j.id=r.job_id JOIN app.content_slots s ON s.id=slot_id WHERE r.job_id=content_slot_carousel_generations.job_id AND j.requested_by=app.actor() AND s.format='carousel' AND s.revision=source_revision AND s.creative_spec IS NOT DISTINCT FROM content_slot_carousel_generations.creative_spec AND r.creative_spec IS NOT DISTINCT FROM s.creative_spec));
CREATE POLICY worker_read ON app.content_slot_carousel_generations FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context());
CREATE POLICY worker_update ON app.content_slot_carousel_generations FOR UPDATE TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context()) WITH CHECK(app.carousel_scope(organization_id,brand_id) AND job_id=app.job_context() AND (attachment_status='needs_attachment' OR attachment_status='attached' AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=attached_version_id AND v.generation_job_id=app.job_context())));
GRANT SELECT,INSERT ON app.content_slot_carousel_generations TO desvio_app;
GRANT SELECT,UPDATE(attachment_status,attached_version_id) ON app.content_slot_carousel_generations TO desvio_worker;
CREATE POLICY carousel_slot_read ON app.content_slots FOR SELECT TO desvio_worker USING(app.carousel_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.content_slot_carousel_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id));
CREATE POLICY carousel_slot_attach ON app.content_slots FOR UPDATE TO desvio_worker
 USING(app.carousel_scope(organization_id,brand_id) AND format='carousel' AND approved_by IS NULL AND state NOT IN ('approved','cancelled') AND EXISTS(SELECT 1 FROM app.content_slot_carousel_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id AND g.source_revision=content_slots.revision AND g.creative_spec IS NOT DISTINCT FROM content_slots.creative_spec))
 WITH CHECK(app.carousel_scope(organization_id,brand_id) AND format='carousel' AND state='draft_ready' AND approved_by IS NULL AND approved_at IS NULL AND creative_version_id IS NULL AND video_version_id IS NULL AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=content_slots.carousel_version_id AND v.sha256=content_slots.carousel_sha256 AND v.generation_job_id=app.job_context()) AND EXISTS(SELECT 1 FROM app.content_slot_carousel_generations g WHERE g.job_id=app.job_context() AND g.slot_id=content_slots.id AND content_slots.revision=g.source_revision+1 AND g.creative_spec IS NOT DISTINCT FROM content_slots.creative_spec));
GRANT UPDATE(carousel_version_id,carousel_sha256) ON app.content_slots TO desvio_worker;
CREATE POLICY carousel_slot_event ON app.content_slot_events FOR INSERT TO desvio_worker WITH CHECK(app.carousel_scope(organization_id,brand_id) AND action='creative_attached' AND EXISTS(SELECT 1 FROM app.content_slot_carousel_generations g JOIN app.jobs j ON j.id=g.job_id JOIN app.content_slots s ON s.id=g.slot_id WHERE g.job_id=app.job_context() AND s.id=content_slot_events.slot_id AND s.revision=content_slot_events.revision AND s.carousel_version_id=content_slot_events.carousel_version_id AND j.requested_by=content_slot_events.actor_id AND s.carousel_sha256=content_slot_events.carousel_sha256));

-- One durable reviewed item even when video preparation still awaits approval.
ALTER TABLE app.campaign_image_batches DROP CONSTRAINT campaign_image_batches_job_ids_check;
ALTER TABLE app.campaign_image_batches ADD CHECK(cardinality(job_ids) BETWEEN 0 AND 90);
CREATE TABLE app.campaign_batch_items (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,request_key text NOT NULL,slot_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),creative_spec jsonb,format text NOT NULL CHECK(format IN ('static','ad','video','carousel')),
 job_id uuid,state text NOT NULL CHECK(state IN ('awaiting_approval','queued')),
 PRIMARY KEY(organization_id,brand_id,request_key,slot_id),
 FOREIGN KEY(organization_id,brand_id,request_key) REFERENCES app.campaign_image_batches(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 CHECK((state='queued')=(job_id IS NOT NULL)),CHECK(state<>'awaiting_approval' OR format='video')
);
ALTER TABLE app.campaign_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.campaign_batch_items FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.campaign_batch_items FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_create ON app.campaign_batch_items FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND EXISTS(SELECT 1 FROM app.campaign_image_batches b JOIN app.content_slots s ON s.plan_id=b.plan_id WHERE b.request_key=campaign_batch_items.request_key AND b.organization_id=campaign_batch_items.organization_id AND b.brand_id=campaign_batch_items.brand_id AND b.requested_by=app.actor() AND s.id=slot_id AND (s.revision=source_revision OR EXISTS(SELECT 1 FROM app.content_slot_generations g WHERE g.job_id=campaign_batch_items.job_id AND g.slot_id=s.id AND g.source_revision=campaign_batch_items.source_revision+1 AND s.revision=g.source_revision)) AND s.format=campaign_batch_items.format AND s.creative_spec IS NOT DISTINCT FROM campaign_batch_items.creative_spec));
GRANT SELECT,INSERT ON app.campaign_batch_items TO desvio_app;

-- Canonical story/reel canvases include exact 9:16 pixels, while retaining
-- every legacy 1024/1536 media size that earlier releases could persist.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.creative_media'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%width%' OR pg_get_constraintdef(oid) LIKE '%height%') LOOP
 EXECUTE format('ALTER TABLE app.creative_media DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE app.creative_media ADD CONSTRAINT creative_media_canonical_dimensions CHECK((width IN (1024,1536) AND height IN (1024,1536)) OR (width=1080 AND height=1920));
