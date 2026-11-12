-- A reviewed batch is reserved against the daily image cap in one step. Posts that
-- do not fit today wait as 'scheduled' items with the budget approved for them,
-- instead of rolling the whole batch back.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='app.campaign_batch_items'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%ANY%awaiting_approval%' LOOP
  EXECUTE format('ALTER TABLE app.campaign_batch_items DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE app.campaign_batch_items
 ADD COLUMN scheduled_for timestamptz,
 ADD COLUMN max_cost_micros bigint CHECK(max_cost_micros IS NULL OR max_cost_micros BETWEEN 1 AND 1000000000),
 ADD COLUMN planning_cost_micros bigint CHECK(planning_cost_micros IS NULL OR planning_cost_micros BETWEEN 1 AND 1000000000),
 ADD CONSTRAINT campaign_batch_items_state_check CHECK(state IN ('awaiting_approval','queued','scheduled')),
 ADD CONSTRAINT campaign_batch_items_schedule_check CHECK((state='scheduled')=(scheduled_for IS NOT NULL)),
 ADD CONSTRAINT campaign_batch_items_scheduled_format_check CHECK(state<>'scheduled' OR format IN ('static','carousel'));
CREATE INDEX campaign_batch_items_scheduled ON app.campaign_batch_items(scheduled_for) WHERE state='scheduled';
-- Server-only queue scan; the release rechecks the requester's access and every limit.
CREATE FUNCTION app.pending_scheduled_generation() RETURNS TABLE(brand_id uuid,plan_id uuid,requested_by uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT DISTINCT i.brand_id,b.plan_id,b.requested_by FROM app.campaign_batch_items i
 JOIN app.campaign_image_batches b ON b.organization_id=i.organization_id AND b.brand_id=i.brand_id AND b.request_key=i.request_key
 JOIN app.content_slots s ON s.id=i.slot_id
 WHERE i.state='scheduled' AND i.scheduled_for<=now() AND s.revision=i.source_revision AND s.state='content_needed'
 AND s.creative_version_id IS NULL AND s.carousel_version_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM app.campaign_batch_items n JOIN app.campaign_image_batches nb ON nb.organization_id=n.organization_id AND nb.brand_id=n.brand_id AND nb.request_key=n.request_key WHERE n.slot_id=i.slot_id AND nb.created_at>b.created_at)
 -- Another running or uncertain request would make Canvas refuse the release.
 AND NOT EXISTS(SELECT 1 FROM app.jobs j WHERE j.organization_id=i.organization_id AND j.brand_id=i.brand_id AND j.kind IN ('creative.generate','carousel.generate') AND j.status IN ('queued','running','retrying','unknown'))
 AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=i.organization_id AND m.user_id=b.requested_by AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin','editor')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=i.organization_id AND bm.brand_id=i.brand_id AND bm.user_id=b.requested_by AND bm.active AND bm.role IN ('admin','editor')))))
 LIMIT 10
$$;
REVOKE ALL ON FUNCTION app.pending_scheduled_generation() FROM PUBLIC,desvio_worker;
GRANT EXECUTE ON FUNCTION app.pending_scheduled_generation() TO desvio_app;
