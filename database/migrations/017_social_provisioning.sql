ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','social.sync','social.authorize','social.connect','social.provision'));
CREATE ROLE desvio_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA app TO desvio_provisioner;
GRANT EXECUTE ON FUNCTION app.job_context(),app.tenant(),app.brand_matches(uuid) TO desvio_provisioner;
CREATE POLICY provision_job ON app.jobs TO desvio_provisioner USING(id=app.job_context() AND organization_id=app.tenant() AND app.brand_matches(brand_id) AND kind='social.provision') WITH CHECK(id=app.job_context() AND organization_id=app.tenant() AND app.brand_matches(brand_id) AND kind='social.provision');
GRANT SELECT ON app.jobs TO desvio_provisioner;
GRANT UPDATE(status,attempt,error_code,updated_at) ON app.jobs TO desvio_provisioner;
CREATE FUNCTION app.provision_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=app.job_context() AND j.organization_id=org AND j.brand_id=brand AND j.kind='social.provision')
$$;
REVOKE ALL ON FUNCTION app.provision_scope(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.provision_scope(uuid,uuid) TO desvio_provisioner;
CREATE POLICY provision_membership ON app.memberships FOR SELECT TO desvio_provisioner USING(organization_id=app.tenant() AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=app.job_context() AND j.requested_by=user_id));
CREATE POLICY provision_business_membership ON app.business_memberships FOR SELECT TO desvio_provisioner USING(app.provision_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=app.job_context() AND j.requested_by=user_id));
GRANT SELECT ON app.memberships,app.business_memberships TO desvio_provisioner;
CREATE TABLE app.social_provisioning (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,request_key text NOT NULL,
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','creating','verifying','succeeded','unknown','rejected','canceled')),
 remote_organization_id text,encrypted_credential bytea,credential_fingerprint text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 CHECK((remote_organization_id IS NULL AND encrypted_credential IS NULL AND credential_fingerprint IS NULL) OR (remote_organization_id IS NOT NULL AND encrypted_credential IS NOT NULL AND credential_fingerprint IS NOT NULL AND length(remote_organization_id) BETWEEN 1 AND 128 AND octet_length(encrypted_credential) BETWEEN 49 AND 4200 AND credential_fingerprint ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX one_unresolved_provision_per_business ON app.social_provisioning(organization_id,brand_id) WHERE phase NOT IN ('rejected','canceled');
ALTER TABLE app.social_provisioning ENABLE ROW LEVEL SECURITY;ALTER TABLE app.social_provisioning FORCE ROW LEVEL SECURITY;
CREATE POLICY provision_read ON app.social_provisioning FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY provision_request ON app.social_provisioning FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND phase='queued' AND remote_organization_id IS NULL AND encrypted_credential IS NULL AND credential_fingerprint IS NULL AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='social.provision' AND j.requested_by=app.actor()));
GRANT SELECT(job_id,organization_id,brand_id,request_key,phase,created_at),INSERT(job_id,organization_id,brand_id,request_key) ON app.social_provisioning TO desvio_app;
CREATE POLICY provision_work ON app.social_provisioning TO desvio_provisioner USING(job_id=app.job_context() AND app.provision_scope(organization_id,brand_id)) WITH CHECK(job_id=app.job_context() AND app.provision_scope(organization_id,brand_id));
GRANT SELECT ON app.social_provisioning TO desvio_provisioner;
GRANT UPDATE(phase,remote_organization_id,encrypted_credential,credential_fingerprint) ON app.social_provisioning TO desvio_provisioner;
CREATE POLICY provision_account_read ON app.postiz_accounts FOR SELECT TO desvio_provisioner USING(app.provision_scope(organization_id,brand_id));
CREATE POLICY provision_account_create ON app.postiz_accounts FOR INSERT TO desvio_provisioner WITH CHECK(app.provision_scope(organization_id,brand_id) AND revision=1 AND enabled AND identity_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM app.social_provisioning p WHERE p.job_id=app.job_context() AND p.phase='verifying' AND p.remote_organization_id=postiz_accounts.remote_organization_id AND p.encrypted_credential=postiz_accounts.encrypted_credential AND p.credential_fingerprint=postiz_accounts.credential_fingerprint));
GRANT SELECT,INSERT ON app.postiz_accounts TO desvio_provisioner;
-- No update/delete privilege: provisioning cannot replace or re-enable an
-- existing binding, read other businesses or touch customer content/auth data.
