-- Keep the reviewed slot revisions and explicit generation ceiling alongside the
-- idempotent batch, so reconnects do not depend on browser session storage.
ALTER TABLE app.campaign_image_batches
 ADD COLUMN reviewed_slots jsonb,
 ADD COLUMN credit_cap integer;
ALTER TABLE app.campaign_image_batches
 ADD CONSTRAINT campaign_reviewed_slots_check CHECK(reviewed_slots IS NULL OR (jsonb_typeof(reviewed_slots)='array' AND jsonb_array_length(reviewed_slots) BETWEEN 1 AND 90)),
 ADD CONSTRAINT campaign_credit_cap_check CHECK(credit_cap IS NULL OR credit_cap BETWEEN 1 AND 100000);

-- Scoped read only: server computes capacity; these rates are never sent to browsers.
GRANT SELECT(max_image_request_micros,input_micros_per_token,output_micros_per_token) ON app.creative_grants TO desvio_app;
