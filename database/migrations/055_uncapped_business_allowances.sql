-- Explicit operator opt-in: NULL means no lifetime spend ceiling.
-- Missing, disabled and expired grants still deny generation. No existing grant changes.
ALTER TABLE app.analysis_grants ALTER COLUMN budget_micros DROP NOT NULL;
ALTER TABLE app.creative_grants ALTER COLUMN budget_micros DROP NOT NULL;
ALTER TABLE app.gemini_creative_grants ALTER COLUMN budget_micros DROP NOT NULL;
ALTER TABLE app.planning_grants ALTER COLUMN budget_micros DROP NOT NULL;
ALTER TABLE app.insight_grants ALTER COLUMN budget_micros DROP NOT NULL;
ALTER TABLE app.video_grants ALTER COLUMN budget_micros DROP NOT NULL;
