-- Each generated image is inspected by a vision model (spelling of designed type, fit to the
-- brief and brand, visible defects) and may be regenerated exactly once. The report is kept
-- with the version so reviewers see why an image was flagged. NULL means the image was never
-- inspected (older versions, manual edits, or the check is not configured).
ALTER TABLE app.creative_versions ADD COLUMN qa jsonb
 CHECK(qa IS NULL OR (jsonb_typeof(qa)='object' AND octet_length(qa::text)<=60000
  AND qa->>'status' IN ('checked','unavailable') AND qa->>'verdict' IN ('pass','flag','unavailable')));
COMMENT ON COLUMN app.creative_versions.qa IS 'Vision quality report for the stored image; verdict pass, flag or unavailable.';
-- Existing table-level grants cover the new column: desvio_app reads versions, desvio_worker
-- inserts them, and neither may update it (column-level UPDATE grants do not include qa).
-- Row-level policies on creative_versions are unchanged.

-- The check and its single regeneration are budgeted and recorded like every other paid call.
ALTER TABLE app.creative_calls DROP CONSTRAINT creative_calls_step_check;
ALTER TABLE app.creative_calls ADD CONSTRAINT creative_calls_step_check
 CHECK(step IN ('plan:1','plan:2','plan:3','plan:4','plan:5','image','image:retry','qa:1','qa:2'));

-- A regenerated image is a second stored image for the same request. The first is kept for provenance.
ALTER TABLE app.creative_media DROP CONSTRAINT creative_media_job_id_key;
CREATE INDEX creative_media_job ON app.creative_media(job_id) WHERE job_id IS NOT NULL;
