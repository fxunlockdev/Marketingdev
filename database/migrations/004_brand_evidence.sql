ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract'));
ALTER TABLE app.jobs DROP CONSTRAINT jobs_organization_id_brand_id_asset_id_kind_key;
CREATE UNIQUE INDEX one_asset_validation ON app.jobs(organization_id,brand_id,asset_id) WHERE kind='asset.validate';
ALTER TABLE app.jobs ADD UNIQUE(organization_id,brand_id,id,kind);
ALTER TABLE app.job_dispatch ADD COLUMN kind text NOT NULL DEFAULT 'asset.validate';
ALTER TABLE app.job_dispatch ADD FOREIGN KEY(organization_id,brand_id,job_id,kind) REFERENCES app.jobs(organization_id,brand_id,id,kind);

CREATE TABLE app.brand_review_state (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 source_count integer NOT NULL DEFAULT 0 CHECK(source_count BETWEEN 0 AND 100),finding_count integer NOT NULL DEFAULT 0 CHECK(finding_count BETWEEN 0 AND 500),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.brand_sources (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,asset_id uuid,
 kind text NOT NULL CHECK(kind IN ('document','manual')),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 parser_version text NOT NULL,coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='object'),captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,asset_id,parser_version),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,asset_id) REFERENCES app.assets(organization_id,brand_id,id),
 CHECK((kind='manual' AND asset_id IS NULL) OR (kind='document' AND asset_id IS NOT NULL))
);
CREATE TABLE app.brand_chunks (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,source_id uuid NOT NULL,
 page integer NOT NULL CHECK(page BETWEEN 1 AND 50),anchor text NOT NULL CHECK(length(anchor)<=200),bbox jsonb,
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 12000),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,source_id,id),
 FOREIGN KEY(organization_id,brand_id,source_id) REFERENCES app.brand_sources(organization_id,brand_id,id)
);
CREATE TABLE app.brand_findings (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,source_id uuid NOT NULL,chunk_id uuid NOT NULL,
 field text NOT NULL CHECK(field IN ('brand_name','offering','audience','voice','colors','prohibited_claims','positioning','cta','fonts','products')),
 original_value text NOT NULL CHECK(length(original_value) BETWEEN 1 AND 4000),value text NOT NULL CHECK(length(value) BETWEEN 1 AND 4000),
 extraction_type text NOT NULL CHECK(extraction_type IN ('literal_label','manual')),
 status text NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','correct','wrong','edited')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),reviewed_by uuid REFERENCES auth."user"(id),reviewed_at timestamptz,
 UNIQUE(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,source_id,chunk_id) REFERENCES app.brand_chunks(organization_id,brand_id,source_id,id)
);
CREATE TABLE app.brand_brain_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,review_revision integer NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=262144),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),approved_by uuid NOT NULL REFERENCES auth."user"(id),approved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,review_revision),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);

CREATE FUNCTION app.document_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND kind='document.extract' AND organization_id=org AND brand_id=brand)
$$;
REVOKE ALL ON FUNCTION app.document_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.document_scope(uuid,uuid) TO desvio_worker;

ALTER TABLE app.brand_review_state ENABLE ROW LEVEL SECURITY;ALTER TABLE app.brand_review_state FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brand_sources ENABLE ROW LEVEL SECURITY;ALTER TABLE app.brand_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brand_chunks ENABLE ROW LEVEL SECURITY;ALTER TABLE app.brand_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brand_findings ENABLE ROW LEVEL SECURITY;ALTER TABLE app.brand_findings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brand_brain_versions ENABLE ROW LEVEL SECURITY;ALTER TABLE app.brand_brain_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY review_read ON app.brand_review_state FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY review_insert ON app.brand_review_state FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id));
CREATE POLICY review_update ON app.brand_review_state FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id));
CREATE POLICY source_read ON app.brand_sources FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY source_manual ON app.brand_sources FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND kind='manual');
CREATE POLICY chunk_read ON app.brand_chunks FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY chunk_manual ON app.brand_chunks FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id AND s.kind='manual'));
CREATE POLICY finding_read ON app.brand_findings FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY finding_manual ON app.brand_findings FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND extraction_type='manual' AND status='unreviewed' AND reviewed_by IS NULL AND reviewed_at IS NULL AND revision=1 AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id AND s.kind='manual'));
CREATE POLICY finding_review ON app.brand_findings FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND reviewed_by=app.actor() AND reviewed_at IS NOT NULL);
CREATE POLICY brain_read ON app.brand_brain_versions FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY brain_approve ON app.brand_brain_versions FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND approved_by=app.actor() AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=brand_brain_versions.organization_id AND m.user_id=app.actor() AND m.active AND m.role IN ('owner','admin')));
GRANT SELECT,INSERT ON app.brand_review_state,app.brand_sources,app.brand_chunks,app.brand_findings,app.brand_brain_versions TO desvio_app;
GRANT UPDATE(revision,source_count,finding_count) ON app.brand_review_state TO desvio_app;
GRANT UPDATE(value,status,revision,reviewed_by,reviewed_at) ON app.brand_findings TO desvio_app;
CREATE POLICY worker_review ON app.brand_review_state TO desvio_worker USING(app.document_scope(organization_id,brand_id)) WITH CHECK(app.document_scope(organization_id,brand_id));
CREATE POLICY worker_source ON app.brand_sources TO desvio_worker USING(app.document_scope(organization_id,brand_id) AND app.worker_asset(asset_id,organization_id,brand_id)) WITH CHECK(app.document_scope(organization_id,brand_id) AND app.worker_asset(asset_id,organization_id,brand_id) AND kind='document');
CREATE POLICY worker_chunks ON app.brand_chunks TO desvio_worker USING(app.document_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id)) WITH CHECK(app.document_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id));
CREATE POLICY worker_findings ON app.brand_findings FOR INSERT TO desvio_worker WITH CHECK(app.document_scope(organization_id,brand_id) AND extraction_type='literal_label' AND status='unreviewed' AND reviewed_by IS NULL AND reviewed_at IS NULL AND revision=1 AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id));
GRANT SELECT,INSERT ON app.brand_review_state,app.brand_sources,app.brand_chunks TO desvio_worker;
GRANT UPDATE(revision,source_count,finding_count) ON app.brand_review_state TO desvio_worker;
GRANT INSERT ON app.brand_findings TO desvio_worker;

-- Document parsing cannot change a validated asset or its checksum/identity.
DROP POLICY worker_asset ON app.assets;
CREATE POLICY worker_asset_read ON app.assets FOR SELECT TO desvio_worker USING(app.worker_asset(id,organization_id,brand_id));
CREATE POLICY worker_asset_validate ON app.assets FOR UPDATE TO desvio_worker USING(app.worker_asset(id,organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND kind='asset.validate')) WITH CHECK(app.worker_asset(id,organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND kind='asset.validate'));
