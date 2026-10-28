-- Public integration lists include intermediate Facebook logins. Keep a separate,
-- secret-free record of acknowledged Page selection before reporting availability.
ALTER TABLE app.social_channels DROP CONSTRAINT social_channels_observed_state_check;
ALTER TABLE app.social_channels ADD CONSTRAINT social_channels_observed_state_check CHECK(observed_state IN ('available','disabled','missing','unconfirmed'));
CREATE TABLE app.facebook_connection_observations (
 job_id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 account_revision integer NOT NULL CHECK(account_revision>0),
 remote_id text, page_id text, phase text NOT NULL DEFAULT 'pending' CHECK(phase IN ('pending','verified')),
 CHECK(phase='pending' OR (remote_id IS NOT NULL AND page_id IS NOT NULL)),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.facebook_connection_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.facebook_connection_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_observation_read ON app.facebook_connection_observations FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.sync') OR app.intake_scope(organization_id,brand_id,'social.connect'));
CREATE POLICY worker_observation_create ON app.facebook_connection_observations FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND phase='pending' AND app.intake_scope(organization_id,brand_id,'social.connect'));
CREATE POLICY worker_observation_update ON app.facebook_connection_observations FOR UPDATE TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.connect')) WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.connect'));
GRANT SELECT,INSERT ON app.facebook_connection_observations TO desvio_worker;
GRANT UPDATE(remote_id,page_id,phase) ON app.facebook_connection_observations TO desvio_worker;
-- Previously acknowledged local selections may be retained; incomplete exchanges
-- are deliberately not inferred from a remote listing.
INSERT INTO app.facebook_connection_observations(job_id,organization_id,brand_id,account_revision,remote_id,page_id,phase)
SELECT c.job_id,c.organization_id,c.brand_id,a.account_revision,c.remote_id,c.internal_id,
 CASE WHEN c.phase='succeeded' AND c.remote_id IS NOT NULL AND c.internal_id IS NOT NULL THEN 'verified' ELSE 'pending' END
FROM app.social_callbacks c JOIN app.social_authorizations a ON a.id=c.authorization_id
WHERE a.provider='facebook' AND NOT c.denied AND c.phase<>'queued';
