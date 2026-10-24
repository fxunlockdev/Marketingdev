-- Read-only recovery uses a new durable job and preserves the original unknown
-- attempt. Only the isolated provisioner can read the saved credential.
ALTER TABLE app.social_provisioning ADD COLUMN candidate_saved boolean GENERATED ALWAYS AS (encrypted_credential IS NOT NULL AND remote_organization_id IS NOT NULL) STORED;
ALTER TABLE app.social_provisioning ADD UNIQUE(organization_id,brand_id,job_id);
GRANT SELECT(candidate_saved) ON app.social_provisioning TO desvio_app;
CREATE TABLE app.social_provision_checks (
 job_id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 source_job_id uuid NOT NULL, request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,source_job_id) REFERENCES app.social_provisioning(organization_id,brand_id,job_id),
 CHECK(job_id<>source_job_id)
);
CREATE INDEX provision_checks_source_latest ON app.social_provision_checks(source_job_id,created_at DESC);
ALTER TABLE app.social_provision_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.social_provision_checks FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.social_provision_checks TO desvio_app;
CREATE POLICY provision_check_read ON app.social_provision_checks FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY provision_check_request ON app.social_provision_checks FOR INSERT TO desvio_app
 WITH CHECK(app.social_manager(organization_id,brand_id)
 AND EXISTS(SELECT 1 FROM app.social_provisioning p WHERE p.job_id=social_provision_checks.source_job_id AND p.phase='unknown' AND p.candidate_saved)
 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=social_provision_checks.job_id AND j.kind='social.provision' AND j.requested_by=app.actor() AND j.status='queued'));
GRANT SELECT ON app.social_provision_checks TO desvio_provisioner;
CREATE POLICY provision_check_work ON app.social_provision_checks FOR SELECT TO desvio_provisioner
 USING(job_id=app.job_context() AND app.provision_scope(organization_id,brand_id));
CREATE POLICY provision_candidate_recheck ON app.social_provisioning FOR SELECT TO desvio_provisioner
 USING(app.provision_scope(organization_id,brand_id) AND phase='unknown'
 AND EXISTS(SELECT 1 FROM app.social_provision_checks r WHERE r.job_id=app.job_context() AND r.source_job_id=social_provisioning.job_id));
DROP POLICY provision_account_create ON app.postiz_accounts;
CREATE POLICY provision_account_create ON app.postiz_accounts FOR INSERT TO desvio_provisioner
 WITH CHECK(app.provision_scope(organization_id,brand_id) AND revision=1 AND enabled AND identity_verified_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM app.social_provisioning p WHERE
  ((p.job_id=app.job_context() AND p.phase='verifying') OR (p.phase='unknown' AND EXISTS(SELECT 1 FROM app.social_provision_checks r WHERE r.job_id=app.job_context() AND r.source_job_id=p.job_id)))
  AND p.remote_organization_id=postiz_accounts.remote_organization_id AND p.encrypted_credential=postiz_accounts.encrypted_credential AND p.credential_fingerprint=postiz_accounts.credential_fingerprint));
