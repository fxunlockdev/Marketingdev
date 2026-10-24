-- Provider identity is learned only from a verified OAuth callback, never a browser field.
ALTER TABLE app.social_channels ADD COLUMN internal_id text CHECK(internal_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$');
ALTER TABLE app.social_callbacks ADD COLUMN internal_id text CHECK(internal_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$');
ALTER TABLE app.social_authorizations ADD COLUMN target_remote_id text, ADD COLUMN target_internal_id text,
 ADD CHECK((target_remote_id IS NULL)=(target_internal_id IS NULL));
GRANT SELECT(internal_id) ON app.social_channels TO desvio_app;
GRANT UPDATE(internal_id) ON app.social_channels,app.social_callbacks TO desvio_worker;
GRANT SELECT(target_remote_id,target_internal_id),INSERT(target_remote_id,target_internal_id) ON app.social_authorizations TO desvio_app;
CREATE POLICY reconnect_target ON app.social_authorizations AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(
 target_remote_id IS NULL OR EXISTS(SELECT 1 FROM app.social_channels c WHERE c.organization_id=social_authorizations.organization_id AND c.brand_id=social_authorizations.brand_id AND c.remote_id=target_remote_id AND c.internal_id=target_internal_id AND c.provider='linkedin' AND c.account_revision=social_authorizations.account_revision)
);
-- A local hold survives failed/ambiguous removal and read-only account refreshes.
ALTER TABLE app.social_channels ADD COLUMN publishing_held boolean NOT NULL DEFAULT false;
GRANT UPDATE(publishing_held) ON app.social_channels TO desvio_app;
GRANT UPDATE(publishing_held) ON app.social_channels TO desvio_worker;
CREATE POLICY channel_hold ON app.social_channels FOR UPDATE TO desvio_app USING(app.social_manager(organization_id,brand_id)) WITH CHECK(app.social_manager(organization_id,brand_id));
ALTER TABLE app.social_sync_requests ADD UNIQUE(organization_id,brand_id,job_id);
CREATE TABLE app.social_disconnects (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,channel_id uuid NOT NULL,remote_id text NOT NULL,
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','removing','checking','absent','unknown','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.social_sync_requests(organization_id,brand_id,job_id),
 FOREIGN KEY(organization_id,brand_id,channel_id) REFERENCES app.social_channels(organization_id,brand_id,id)
);
ALTER TABLE app.social_disconnects ENABLE ROW LEVEL SECURITY;ALTER TABLE app.social_disconnects FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.social_disconnects TO desvio_app;
GRANT SELECT,UPDATE(phase) ON app.social_disconnects TO desvio_worker;
CREATE POLICY disconnect_read ON app.social_disconnects FOR SELECT TO desvio_app USING(app.social_manager(organization_id,brand_id));
CREATE POLICY disconnect_create ON app.social_disconnects FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND phase='queued' AND EXISTS(SELECT 1 FROM app.social_channels c WHERE c.id=channel_id AND c.remote_id=social_disconnects.remote_id AND c.publishing_held));
CREATE POLICY disconnect_worker_read ON app.social_disconnects FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.sync'));
CREATE POLICY disconnect_worker_update ON app.social_disconnects FOR UPDATE TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.sync')) WITH CHECK(app.intake_scope(organization_id,brand_id,'social.sync'));
CREATE POLICY disconnect_publication_read ON app.publication_requests FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.sync'));
CREATE POLICY disconnect_oauth_read ON app.social_disconnects FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.authorize') OR app.intake_scope(organization_id,brand_id,'social.connect'));
