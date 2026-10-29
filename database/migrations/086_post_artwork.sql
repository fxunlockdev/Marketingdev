-- Explicit per-post typography is stored with the existing immutable format snapshot.
CREATE FUNCTION app.valid_post_artwork(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE part jsonb; family text; weight integer;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'text' IS NULL OR v->>'text' NOT IN ('headline','none') OR (v - ARRAY['text','typography'])<>'{}'::jsonb THEN RETURN false; END IF;
 IF v ? 'typography' THEN
  IF jsonb_typeof(v->'typography') IS DISTINCT FROM 'object' OR NOT (v->'typography') ?& ARRAY['headline','body'] OR ((v->'typography') - ARRAY['headline','body'])<>'{}'::jsonb THEN RETURN false; END IF;
  FOR part IN SELECT value FROM jsonb_each(v->'typography') LOOP
   IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR NOT part ?& ARRAY['family','weight'] OR (part - ARRAY['family','weight'])<>'{}'::jsonb OR jsonb_typeof(part->'weight') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   family:=part->>'family'; weight:=(part->>'weight')::integer;
   IF (part->>'weight')::numeric<>weight OR weight%100<>0 OR NOT (CASE family WHEN 'DM Sans' THEN weight BETWEEN 100 AND 900 WHEN 'DM Serif Display' THEN weight=400 WHEN 'Playfair Display' THEN weight BETWEEN 400 AND 900 WHEN 'Montserrat' THEN weight BETWEEN 100 AND 900 WHEN 'Lora' THEN weight BETWEEN 400 AND 700 WHEN 'Oswald' THEN weight BETWEEN 200 AND 700 ELSE false END) THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.valid_post_artwork(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.valid_post_artwork(jsonb) TO desvio_app,desvio_worker;
-- NULL preserves legacy dimensions/placement. New explicit format specs are immutable
-- generation snapshots; changing a slot spec requires a new revision and review.
CREATE OR REPLACE FUNCTION app.valid_creative_spec(spec jsonb,media text,channel text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF spec IS NULL THEN RETURN true; END IF;
 IF spec ? 'artwork' AND (media='video' OR NOT app.valid_post_artwork(spec->'artwork')) THEN RETURN false; END IF;
 IF jsonb_typeof(spec)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(spec - 'artwork'))<>3
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
