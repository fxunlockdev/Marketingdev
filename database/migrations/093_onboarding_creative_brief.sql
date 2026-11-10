ALTER TABLE app.business_onboarding ADD COLUMN creative_brief jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(creative_brief) = 'object');
GRANT UPDATE(creative_brief) ON app.business_onboarding TO desvio_app;
