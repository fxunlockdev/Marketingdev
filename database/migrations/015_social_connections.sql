ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','social.sync'));
-- Provisioning belongs to the operator workflow. Customer/API and job roles
-- cannot write, swap or share a remote organization's credentials.
CREATE TABLE app.postiz_accounts (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,remote_organization_id text NOT NULL UNIQUE CHECK(length(remote_organization_id) BETWEEN 1 AND 128),
 encrypted_credential bytea NOT NULL CHECK(octet_length(encrypted_credential) BETWEEN 49 AND 4200),credential_fingerprint text NOT NULL UNIQUE CHECK(credential_fingerprint ~ '^[a-f0-9]{64}$'),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),enabled boolean NOT NULL DEFAULT false,
 identity_verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.social_sync_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,account_revision integer NOT NULL CHECK(account_revision>0),request_key text NOT NULL,request_hash text NOT NULL,
 UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.postiz_accounts(organization_id,brand_id)
);
CREATE TABLE app.social_channels (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,remote_id text NOT NULL UNIQUE CHECK(length(remote_id) BETWEEN 1 AND 128),provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 300),profile text,picture text,
 observed_state text NOT NULL CHECK(observed_state IN ('available','disabled','missing')),token_health text NOT NULL DEFAULT 'unknown' CHECK(token_health='unknown'),last_seen_at timestamptz NOT NULL,last_checked_at timestamptz NOT NULL,account_revision integer NOT NULL,last_job_id uuid NOT NULL,
 UNIQUE(organization_id,brand_id,id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.postiz_accounts(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id,last_job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE FUNCTION app.social_manager(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT app.can_access(org,true) AND app.brand_matches(brand) AND app.business_access(org,brand,true) AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND m.role IN ('owner','admin') AND (m.business_scope='all' OR EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND b.role='admin')))
$$;
REVOKE ALL ON FUNCTION app.social_manager(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.social_manager(uuid,uuid) TO desvio_app;
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['postiz_accounts','social_sync_requests','social_channels'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,''social.sync''))',tab);
 END LOOP;END $$;
GRANT SELECT(organization_id,brand_id,revision,enabled,identity_verified_at) ON app.postiz_accounts TO desvio_app;
GRANT SELECT ON app.social_sync_requests,app.social_channels TO desvio_app;
GRANT INSERT ON app.social_sync_requests TO desvio_app;
CREATE POLICY sync_create ON app.social_sync_requests FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='social.sync' AND j.requested_by=app.actor()));
GRANT SELECT ON app.postiz_accounts,app.social_sync_requests,app.social_channels TO desvio_worker;
CREATE POLICY channel_create ON app.social_channels FOR INSERT TO desvio_worker WITH CHECK(app.intake_scope(organization_id,brand_id,'social.sync') AND last_job_id=app.job_context());
CREATE POLICY channel_update ON app.social_channels FOR UPDATE TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.sync')) WITH CHECK(last_job_id=app.job_context());
GRANT INSERT ON app.social_channels TO desvio_worker;
GRANT UPDATE(name,provider,profile,picture,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) ON app.social_channels TO desvio_worker;
