-- A selection that expired before its Page mutation can be safely superseded by
-- a later acknowledged selection. An uncertain mutation remains pending.
ALTER TABLE app.facebook_connection_observations DROP CONSTRAINT facebook_connection_observations_phase_check;
ALTER TABLE app.facebook_connection_observations DROP CONSTRAINT facebook_connection_observations_check;
ALTER TABLE app.facebook_connection_observations ADD COLUMN settled_at timestamptz;
UPDATE app.facebook_connection_observations o SET settled_at=j.updated_at FROM app.jobs j WHERE j.id=o.job_id AND o.phase='verified';
ALTER TABLE app.facebook_connection_observations ADD CONSTRAINT facebook_connection_observations_phase_check CHECK(phase IN ('pending','abandoned','verified'));
ALTER TABLE app.facebook_connection_observations ADD CONSTRAINT facebook_connection_observations_check CHECK(
 phase='pending' OR (settled_at IS NOT NULL AND remote_id IS NOT NULL AND (phase='abandoned' OR page_id IS NOT NULL))
);
UPDATE app.facebook_connection_observations o SET phase='abandoned',settled_at=j.updated_at
FROM app.jobs j WHERE j.id=o.job_id AND o.phase='pending' AND o.remote_id IS NOT NULL AND j.error_code='SOCIAL_AUTHORIZATION_EXPIRED';
GRANT UPDATE(settled_at) ON app.facebook_connection_observations TO desvio_worker;
CREATE INDEX facebook_observation_lookup ON app.facebook_connection_observations(organization_id,brand_id,account_revision,remote_id);
