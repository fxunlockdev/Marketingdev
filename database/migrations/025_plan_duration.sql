ALTER TABLE app.content_plans ADD COLUMN duration_days integer NOT NULL DEFAULT 30 CHECK(duration_days BETWEEN 1 AND 90);
