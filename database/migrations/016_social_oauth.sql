ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','social.sync','social.authorize','social.connect'));
CREATE TABLE app.social_authorizations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,requested_by uuid NOT NULL,session_id uuid NOT NULL,
 account_revision integer NOT NULL CHECK(account_revision>0),provider text NOT NULL CHECK(provider='linkedin'),request_key text NOT NULL,
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','starting','awaiting_consent','succeeded','unknown','rejected','canceled')),
 authorization_url text, state_hash text CHECK(state_hash ~ '^[a-f0-9]{64}$'),encrypted_state bytea,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.postiz_accounts(organization_id,brand_id)
);
CREATE TABLE app.social_callbacks (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,authorization_id uuid NOT NULL UNIQUE,
 state_hash text NOT NULL,request_hash text NOT NULL,encrypted_code bytea,denied boolean NOT NULL,timezone text NOT NULL CHECK(timezone ~ '^-?[0-9]{1,4}$' AND abs(timezone::int)<=840),
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','exchanging','verifying','succeeded','unknown','rejected','canceled')),
 remote_id text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((denied AND encrypted_code IS NULL) OR (NOT denied AND encrypted_code IS NOT NULL) OR phase IN ('verifying','succeeded','unknown','rejected','canceled')),
 FOREIGN KEY(organization_id,brand_id,authorization_id) REFERENCES app.social_authorizations(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.social_authorizations ENABLE ROW LEVEL SECURITY;ALTER TABLE app.social_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.social_callbacks ENABLE ROW LEVEL SECURITY;ALTER TABLE app.social_callbacks FORCE ROW LEVEL SECURITY;
CREATE FUNCTION app.oauth_session() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('app.oauth_session',true),'')::uuid $$;
REVOKE ALL ON FUNCTION app.oauth_session() FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.oauth_session() TO desvio_app;
CREATE POLICY own_authorization ON app.social_authorizations FOR SELECT TO desvio_app USING(app.social_manager(organization_id,brand_id) AND requested_by=app.actor() AND session_id=app.oauth_session());
CREATE POLICY create_authorization ON app.social_authorizations FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND requested_by=app.actor() AND session_id=app.oauth_session() AND phase='queued' AND authorization_url IS NULL AND state_hash IS NULL AND encrypted_state IS NULL AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=social_authorizations.id AND j.kind='social.authorize' AND j.requested_by=app.actor()));
CREATE POLICY own_callback ON app.social_callbacks FOR SELECT TO desvio_app USING(EXISTS(SELECT 1 FROM app.social_authorizations a WHERE a.id=authorization_id));
CREATE POLICY create_callback ON app.social_callbacks FOR INSERT TO desvio_app WITH CHECK(phase='queued' AND remote_id IS NULL AND EXISTS(SELECT 1 FROM app.social_authorizations a WHERE a.id=authorization_id AND a.phase='awaiting_consent' AND a.state_hash=social_callbacks.state_hash AND a.expires_at>now()) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='social.connect' AND j.requested_by=app.actor()));
GRANT SELECT(id,organization_id,brand_id,requested_by,session_id,account_revision,provider,request_key,phase,authorization_url,state_hash,expires_at,created_at),INSERT(id,organization_id,brand_id,requested_by,session_id,account_revision,provider,request_key) ON app.social_authorizations TO desvio_app;
GRANT SELECT(job_id,organization_id,brand_id,authorization_id,request_hash,phase,created_at),INSERT(job_id,organization_id,brand_id,authorization_id,state_hash,request_hash,encrypted_code,denied,timezone) ON app.social_callbacks TO desvio_app;
CREATE POLICY worker_callback ON app.social_callbacks TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.connect')) WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.connect'));
CREATE POLICY worker_authorization ON app.social_authorizations TO desvio_worker USING((id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.authorize')) OR (app.intake_scope(organization_id,brand_id,'social.connect') AND EXISTS(SELECT 1 FROM app.social_callbacks c WHERE c.authorization_id=social_authorizations.id))) WITH CHECK(organization_id=app.tenant() AND app.brand_matches(brand_id));
GRANT SELECT ON app.social_authorizations,app.social_callbacks TO desvio_worker;
GRANT UPDATE(phase,authorization_url,state_hash,encrypted_state) ON app.social_authorizations TO desvio_worker;
GRANT UPDATE(phase,encrypted_code,remote_id) ON app.social_callbacks TO desvio_worker;
CREATE POLICY worker_oauth_account ON app.postiz_accounts FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.authorize') OR app.intake_scope(organization_id,brand_id,'social.connect'));
CREATE POLICY worker_oauth_channel_read ON app.social_channels FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.connect'));
CREATE POLICY worker_oauth_channel_create ON app.social_channels FOR INSERT TO desvio_worker WITH CHECK(app.intake_scope(organization_id,brand_id,'social.connect') AND last_job_id=app.job_context());
CREATE POLICY worker_oauth_channel_update ON app.social_channels FOR UPDATE TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.connect')) WITH CHECK(last_job_id=app.job_context());
-- Only a narrow boolean query can inspect session liveness. No runtime worker
-- can SELECT auth sessions, bearer tokens, passwords or verification records.
CREATE ROLE desvio_oauth_guard NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA app,auth TO desvio_oauth_guard;
GRANT SELECT(id,"userId","expiresAt") ON auth.session TO desvio_oauth_guard;
GRANT SELECT(id,organization_id,brand_id,requested_by,kind) ON app.jobs TO desvio_oauth_guard;
CREATE POLICY oauth_guard_job ON app.jobs FOR SELECT TO desvio_oauth_guard USING(id=app.job_context() AND organization_id=app.tenant() AND app.brand_matches(brand_id) AND kind IN ('social.authorize','social.connect'));
GRANT EXECUTE ON FUNCTION app.job_context(),app.tenant(),app.brand_matches(uuid) TO desvio_oauth_guard;
CREATE FUNCTION app.oauth_session_live(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.session s JOIN app.jobs j ON j.requested_by=s."userId" WHERE j.id=app.job_context() AND s.id=target AND s."expiresAt">now())
$$;
ALTER FUNCTION app.oauth_session_live(uuid) OWNER TO desvio_oauth_guard;
REVOKE ALL ON FUNCTION app.oauth_session_live(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.oauth_session_live(uuid) TO desvio_worker;
