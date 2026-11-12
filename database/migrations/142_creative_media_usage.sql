-- Rolling creative storage usage for one business, computed without per-row policy checks.
-- Counting through the worker's row-level policies made the archived-project check scale
-- badly and hit the 10 s statement timeout, failing every image in a monthly batch.
-- The caller must already be scoped to the business: an app session for it, or a job of it.
CREATE INDEX IF NOT EXISTS creative_media_brand_created ON app.creative_media(organization_id,brand_id,created_at);
CREATE INDEX IF NOT EXISTS creative_versions_media ON app.creative_versions(media_id);

CREATE FUNCTION app.creative_media_used(org uuid, brand uuid, window_days integer) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF window_days IS NULL OR window_days<1 OR window_days>366 THEN
  RAISE EXCEPTION 'Invalid storage window' USING ERRCODE='22023';
 END IF;
 IF NOT ((app.tenant()=org AND app.brand_matches(brand))
   OR EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=app.job_context() AND j.organization_id=org AND j.brand_id=brand)) THEN
  RAISE EXCEPTION 'Storage usage unavailable' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT COALESCE(sum(m.bytes),0)::bigint FROM app.creative_media m
  WHERE m.organization_id=org AND m.brand_id=brand AND m.created_at>now()-make_interval(days=>window_days)
  AND NOT EXISTS(SELECT 1 FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id
   WHERE v.media_id=m.id AND p.archived_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION app.creative_media_used(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.creative_media_used(uuid,uuid,integer) TO desvio_app,desvio_worker;
