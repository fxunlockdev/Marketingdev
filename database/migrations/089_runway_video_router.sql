-- Owner-directed video provider migration. Retain historical operations and output;
-- never rewrite encrypted paid requests or pretend old jobs belong to Runway.
ALTER TABLE app.video_grants DROP CONSTRAINT video_grants_models_check;
ALTER TABLE app.video_grants ADD CONSTRAINT video_grants_models_check CHECK(cardinality(models) BETWEEN 1 AND 3 AND models <@ ARRAY['runway/router','kling-video/v3.0/std/image-to-video','kling-video/o3/video-edit']::text[]);
UPDATE app.video_grants SET models=ARRAY['runway/router'];
UPDATE app.workspace_provider_defaults d SET grants=(
 SELECT jsonb_agg(CASE WHEN g->>'kind'='video' THEN jsonb_set(g,'{models}','["runway/router"]'::jsonb) ELSE g END ORDER BY n)
 FROM jsonb_array_elements(d.grants) WITH ORDINALITY AS v(g,n)
);
ALTER TABLE app.video_operations ADD COLUMN provider text NOT NULL DEFAULT 'higgsfield' CHECK(provider IN ('higgsfield','runway'));
ALTER TABLE app.video_operations ADD COLUMN routing jsonb CHECK(routing IS NULL OR (jsonb_typeof(routing)='object' AND octet_length(routing::text)<4096));
ALTER TABLE app.video_operations ADD COLUMN progress double precision CHECK(progress BETWEEN 0 AND 1);
GRANT UPDATE(routing,progress) ON app.video_operations TO desvio_worker;
GRANT SELECT(provider,routing,progress) ON app.video_operations TO desvio_app;
