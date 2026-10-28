-- Two-step Facebook consent retains only sanitized Page IDs and names.
ALTER TABLE app.social_authorizations DROP CONSTRAINT social_authorizations_provider_check;
ALTER TABLE app.social_authorizations ADD CONSTRAINT social_authorizations_provider_check CHECK(provider IN ('linkedin','instagram-standalone','facebook'));
ALTER TABLE app.social_callbacks DROP CONSTRAINT social_callbacks_phase_check;
ALTER TABLE app.social_callbacks ADD CONSTRAINT social_callbacks_phase_check CHECK(phase IN ('queued','exchanging','awaiting_page','selecting_page','verifying','succeeded','unknown','rejected','canceled'));
ALTER TABLE app.social_callbacks DROP CONSTRAINT social_callbacks_check;
ALTER TABLE app.social_callbacks ADD CONSTRAINT social_callbacks_check CHECK((denied AND encrypted_code IS NULL) OR (NOT denied AND encrypted_code IS NOT NULL) OR phase IN ('awaiting_page','selecting_page','verifying','succeeded','unknown','rejected','canceled'));
ALTER TABLE app.social_callbacks ADD COLUMN page_choices jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(page_choices)='array' AND jsonb_array_length(page_choices)<=500);
GRANT SELECT(page_choices) ON app.social_callbacks TO desvio_app;
GRANT UPDATE(page_choices) ON app.social_callbacks TO desvio_worker;
CREATE TABLE app.social_page_selections (
 job_id uuid PRIMARY KEY REFERENCES app.social_callbacks(job_id),
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 page_id text NOT NULL CHECK(page_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.social_page_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.social_page_selections FORCE ROW LEVEL SECURITY;
CREATE POLICY own_page_selection ON app.social_page_selections FOR SELECT TO desvio_app USING(EXISTS(SELECT 1 FROM app.social_callbacks c WHERE c.job_id=social_page_selections.job_id));
CREATE POLICY choose_page ON app.social_page_selections FOR INSERT TO desvio_app WITH CHECK(
 EXISTS(SELECT 1 FROM app.social_callbacks c JOIN app.social_authorizations a ON a.id=c.authorization_id
 WHERE c.job_id=social_page_selections.job_id AND c.organization_id=social_page_selections.organization_id AND c.brand_id=social_page_selections.brand_id
 AND c.phase='awaiting_page' AND a.provider='facebook' AND a.expires_at>now()
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.page_choices) choice WHERE choice->>'id'=page_id))
);
CREATE POLICY worker_page_selection ON app.social_page_selections FOR SELECT TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.connect'));
GRANT SELECT,INSERT ON app.social_page_selections TO desvio_app;
GRANT SELECT ON app.social_page_selections TO desvio_worker;
