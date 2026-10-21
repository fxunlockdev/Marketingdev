-- Trusted operators must audit the selected vision model's high-detail image
-- token ceiling and input rate before enabling image transmission. Zero denies it.
ALTER TABLE app.analysis_grants ADD COLUMN max_tokens_per_image integer NOT NULL DEFAULT 0 CHECK(max_tokens_per_image BETWEEN 0 AND 1000000);
