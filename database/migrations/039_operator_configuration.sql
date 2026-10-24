-- One-shot administrator tooling only. Customer and worker roles cannot grant spend.
CREATE TABLE app.operator_configuration_changes (
 change_id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 preview_sha256 text NOT NULL CHECK(preview_sha256 ~ '^[a-f0-9]{64}$'),
 operator_reference text NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 500),
 configuration jsonb NOT NULL CHECK(octet_length(configuration::text)<=64000),
 applied_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.operator_configuration_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operator_configuration_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.operator_configuration_changes FROM PUBLIC,desvio_app,desvio_worker,desvio_dispatcher,desvio_auth,desvio_mail,desvio_provisioner;
