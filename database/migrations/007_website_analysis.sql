ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze'));
ALTER TABLE app.jobs ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE app.jobs ADD CONSTRAINT job_asset_kind CHECK((kind IN ('asset.validate','document.extract'))=(asset_id IS NOT NULL));
ALTER TABLE app.jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE app.jobs ADD CONSTRAINT jobs_status_check CHECK(status IN ('queued','running','retrying','succeeded','rejected','failed','canceled','unknown'));

CREATE TABLE app.intake_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),request_hash text NOT NULL,
 website_url text CHECK(length(website_url)<=2048),result jsonb CHECK(octet_length(result::text)<=200000),
 UNIQUE(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
-- Provisioned only by trusted operations after owner approval; neither API nor worker can grant spend.
CREATE TABLE app.analysis_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),expires_at timestamptz NOT NULL,
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 input_micros_per_token numeric NOT NULL CHECK(input_micros_per_token>0 AND input_micros_per_token<=1000),
 output_micros_per_token numeric NOT NULL CHECK(output_micros_per_token>0 AND output_micros_per_token<=1000),
 approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.analysis_calls (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,review_revision integer NOT NULL,
 model text NOT NULL,reserved_micros bigint NOT NULL CHECK(reserved_micros>0),input_sha256 text NOT NULL,
 status text NOT NULL CHECK(status IN ('submitted','succeeded','rejected','unknown')),
 response_id text,result jsonb CHECK(octet_length(result::text)<=150000),usage jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE TABLE app.onboarding_recommendations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,
 review_revision integer NOT NULL,model text NOT NULL,recommendation jsonb NOT NULL CHECK(octet_length(recommendation::text)<=32000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE FUNCTION app.intake_scope(org uuid,brand uuid,target_kind text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND kind=target_kind AND organization_id=org AND brand_id=brand)
$$;
REVOKE ALL ON FUNCTION app.intake_scope(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.intake_scope(uuid,uuid,text) TO desvio_worker;

ALTER TABLE app.brand_sources DROP CONSTRAINT brand_sources_kind_check;
ALTER TABLE app.brand_sources DROP CONSTRAINT brand_sources_check;
ALTER TABLE app.brand_sources ADD COLUMN website_url text;
ALTER TABLE app.brand_sources ADD CONSTRAINT source_kind CHECK((kind='manual' AND asset_id IS NULL AND website_url IS NULL) OR (kind='document' AND asset_id IS NOT NULL AND website_url IS NULL) OR (kind='website' AND asset_id IS NULL AND website_url IS NOT NULL AND length(website_url) BETWEEN 1 AND 2048));
CREATE UNIQUE INDEX website_source_dedup ON app.brand_sources(organization_id,brand_id,website_url,sha256,parser_version) WHERE kind='website';
ALTER TABLE app.brand_findings DROP CONSTRAINT brand_findings_extraction_type_check;
ALTER TABLE app.brand_findings ADD CONSTRAINT finding_extraction CHECK(extraction_type IN ('literal_label','manual','ai_suggestion'));
ALTER TABLE app.brand_findings ADD COLUMN evidence_quote text CHECK(length(evidence_quote) BETWEEN 1 AND 4000);
ALTER TABLE app.brand_findings ADD COLUMN analysis_job_id uuid;
ALTER TABLE app.brand_findings ADD FOREIGN KEY(organization_id,brand_id,analysis_job_id) REFERENCES app.jobs(organization_id,brand_id,id);
ALTER TABLE app.brand_findings ADD CONSTRAINT ai_provenance CHECK(extraction_type<>'ai_suggestion' OR (analysis_job_id IS NOT NULL AND evidence_quote IS NOT NULL));

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['intake_requests','analysis_grants','analysis_calls','onboarding_recommendations'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY app_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON app.intake_requests,app.onboarding_recommendations TO desvio_app;
GRANT INSERT ON app.intake_requests TO desvio_app;
CREATE POLICY intake_create ON app.intake_requests FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY worker_intake ON app.intake_requests TO desvio_worker USING(job_id=app.job_context() AND (app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze'))) WITH CHECK(job_id=app.job_context() AND (app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze')));
GRANT SELECT,UPDATE(result) ON app.intake_requests TO desvio_worker;
CREATE POLICY worker_grant ON app.analysis_grants FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'brand.analyze'));
GRANT SELECT ON app.analysis_grants TO desvio_worker;
CREATE POLICY worker_call_read ON app.analysis_calls FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY worker_call_write ON app.analysis_calls FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY worker_call_update ON app.analysis_calls FOR UPDATE TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze')) WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
GRANT SELECT,INSERT ON app.analysis_calls TO desvio_worker;
GRANT UPDATE(status,response_id,result,usage) ON app.analysis_calls TO desvio_worker;
CREATE POLICY worker_recommendation ON app.onboarding_recommendations FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'brand.analyze'));
GRANT INSERT ON app.onboarding_recommendations TO desvio_worker;
CREATE POLICY intake_review ON app.brand_review_state TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze')) WITH CHECK(app.intake_scope(organization_id,brand_id,'website.extract') OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY website_source_read ON app.brand_sources FOR SELECT TO desvio_worker USING((kind='website' AND app.intake_scope(organization_id,brand_id,'website.extract')) OR app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY website_source_insert ON app.brand_sources FOR INSERT TO desvio_worker WITH CHECK(kind='website' AND app.intake_scope(organization_id,brand_id,'website.extract'));
CREATE POLICY intake_chunk_read ON app.brand_chunks FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'brand.analyze') OR (app.intake_scope(organization_id,brand_id,'website.extract') AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id AND s.kind='website')));
CREATE POLICY website_chunk_insert ON app.brand_chunks FOR INSERT TO desvio_worker WITH CHECK(app.intake_scope(organization_id,brand_id,'website.extract') AND EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.id=source_id AND s.kind='website'));
CREATE POLICY analysis_findings_read ON app.brand_findings FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'brand.analyze'));
CREATE POLICY analysis_findings_insert ON app.brand_findings FOR INSERT TO desvio_worker WITH CHECK(app.intake_scope(organization_id,brand_id,'brand.analyze') AND extraction_type='ai_suggestion' AND analysis_job_id=app.job_context() AND status='unreviewed' AND revision=1 AND reviewed_by IS NULL AND reviewed_at IS NULL);
GRANT SELECT ON app.brand_findings TO desvio_worker;

ALTER TABLE app.business_onboarding ADD COLUMN preferences_edited boolean NOT NULL DEFAULT false;
-- Existing saved goals belong to the user; an upgrade must never silently replace them.
UPDATE app.business_onboarding SET preferences_edited=true;
GRANT UPDATE(preferences_edited) ON app.business_onboarding TO desvio_app;
