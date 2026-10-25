ALTER TABLE app.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE app.jobs ADD CHECK(kind IN ('asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile'));
CREATE TABLE app.publication_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,channel_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 100),operator_reference text NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 500),
 PRIMARY KEY(organization_id,brand_id,channel_id),FOREIGN KEY(organization_id,brand_id,channel_id) REFERENCES app.social_channels(organization_id,brand_id,id)
);
CREATE TABLE app.publication_requests (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,slot_id uuid NOT NULL,slot_revision integer NOT NULL CHECK(slot_revision>0),
 export_id uuid NOT NULL,channel_id uuid NOT NULL,remote_channel_id text NOT NULL,account_revision integer NOT NULL CHECK(account_revision>0),
 caption text NOT NULL CHECK(length(caption) BETWEEN 1 AND 3000),scheduled_at timestamptz NOT NULL,image_sha256 text NOT NULL CHECK(image_sha256 ~ '^[a-f0-9]{64}$'),
 request_key text NOT NULL,request_hash text NOT NULL,phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','uploading','uploaded','submitting','accepted','unknown','rejected','canceled')),
 remote_media jsonb CHECK(octet_length(remote_media::text)<=4096),remote_post_id text,observed_state text NOT NULL DEFAULT 'unconfirmed' CHECK(observed_state IN ('unconfirmed','queued','published','failed','draft','unknown','missing')),
 release_id text,release_url text,last_checked_at timestamptz,check_error text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,job_id),UNIQUE(organization_id,brand_id,request_key),UNIQUE(organization_id,remote_post_id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,export_id) REFERENCES app.creative_exports(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,channel_id) REFERENCES app.social_channels(organization_id,brand_id,id)
);
CREATE UNIQUE INDEX publication_once_per_slot ON app.publication_requests(organization_id,brand_id,slot_id) WHERE phase NOT IN ('rejected','canceled');
CREATE TABLE app.publication_checks (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,publication_id uuid NOT NULL,request_key text NOT NULL,
 UNIQUE(organization_id,brand_id,request_key),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,publication_id) REFERENCES app.publication_requests(organization_id,brand_id,job_id)
);
CREATE FUNCTION app.publication_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.intake_scope(org,brand,'social.publish') OR app.intake_scope(org,brand,'social.reconcile') $$;
REVOKE ALL ON FUNCTION app.publication_scope(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.publication_scope(uuid,uuid) TO desvio_worker;
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['publication_grants','publication_requests','publication_checks'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;END $$;
GRANT SELECT ON app.publication_grants,app.publication_checks TO desvio_app;
GRANT SELECT(job_id,organization_id,brand_id,slot_id,slot_revision,export_id,channel_id,account_revision,caption,scheduled_at,image_sha256,request_key,request_hash,phase,remote_post_id,observed_state,release_id,release_url,last_checked_at,check_error,created_at) ON app.publication_requests TO desvio_app;
GRANT INSERT(job_id,organization_id,brand_id,slot_id,slot_revision,export_id,channel_id,remote_channel_id,account_revision,caption,scheduled_at,image_sha256,request_key,request_hash) ON app.publication_requests TO desvio_app;
GRANT SELECT(remote_id) ON app.social_channels TO desvio_app;
GRANT INSERT ON app.publication_checks TO desvio_app;
CREATE POLICY publish_create ON app.publication_requests FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND phase='queued' AND remote_media IS NULL AND remote_post_id IS NULL AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='social.publish' AND j.requested_by=app.actor()));
CREATE POLICY check_create ON app.publication_checks FOR INSERT TO desvio_app WITH CHECK(app.social_manager(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.kind='social.reconcile' AND j.requested_by=app.actor()));
GRANT SELECT ON app.publication_grants,app.publication_requests,app.publication_checks,app.creative_export_approvals TO desvio_worker;
CREATE POLICY worker_check ON app.publication_checks FOR SELECT TO desvio_worker USING(job_id=app.job_context() AND app.intake_scope(organization_id,brand_id,'social.reconcile'));
CREATE POLICY worker_request ON app.publication_requests FOR SELECT TO desvio_worker USING(app.publication_scope(organization_id,brand_id) AND (job_id=app.job_context() OR EXISTS(SELECT 1 FROM app.publication_checks c WHERE c.job_id=app.job_context() AND c.publication_id=publication_requests.job_id)));
CREATE POLICY worker_request_update ON app.publication_requests FOR UPDATE TO desvio_worker USING(app.publication_scope(organization_id,brand_id) AND (job_id=app.job_context() OR EXISTS(SELECT 1 FROM app.publication_checks c WHERE c.job_id=app.job_context() AND c.publication_id=publication_requests.job_id))) WITH CHECK(app.publication_scope(organization_id,brand_id));
GRANT UPDATE(phase,remote_media,remote_post_id,observed_state,release_id,release_url,last_checked_at,check_error) ON app.publication_requests TO desvio_worker;
CREATE POLICY publication_account ON app.postiz_accounts FOR SELECT TO desvio_worker USING(app.publication_scope(organization_id,brand_id));
CREATE POLICY publication_channel ON app.social_channels FOR SELECT TO desvio_worker USING(app.publication_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.channel_id=social_channels.id));
CREATE POLICY publication_grant ON app.publication_grants FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.channel_id=publication_grants.channel_id));
CREATE POLICY publication_slot ON app.content_slots FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.slot_id=content_slots.id));
CREATE POLICY publication_export ON app.creative_exports FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.export_id=creative_exports.id));
CREATE POLICY publication_version ON app.creative_versions FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.creative_exports e WHERE e.version_id=creative_versions.id));
CREATE POLICY publication_project ON app.creative_projects FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.creative_versions v WHERE v.project_id=creative_projects.id));
CREATE POLICY publication_approval ON app.creative_export_approvals FOR SELECT TO desvio_worker USING(app.intake_scope(organization_id,brand_id,'social.publish') AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.export_id=creative_export_approvals.export_id AND r.slot_id=creative_export_approvals.context_id));
-- Keep prior observations when a remote post is later missing or changed.
CREATE TABLE app.publication_observations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,publication_id uuid NOT NULL,job_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','published','failed','draft','unknown','missing')),release_id text,release_url text,checked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,publication_id) REFERENCES app.publication_requests(organization_id,brand_id,job_id),FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE app.publication_observations ENABLE ROW LEVEL SECURITY;ALTER TABLE app.publication_observations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.publication_observations TO desvio_app,desvio_worker;GRANT INSERT ON app.publication_observations TO desvio_worker;
CREATE POLICY scoped_read ON app.publication_observations FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY worker_read ON app.publication_observations FOR SELECT TO desvio_worker USING(app.publication_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.job_id=publication_id));
CREATE POLICY worker_append ON app.publication_observations FOR INSERT TO desvio_worker WITH CHECK(job_id=app.job_context() AND app.publication_scope(organization_id,brand_id) AND EXISTS(SELECT 1 FROM app.publication_requests r WHERE r.job_id=publication_id AND r.phase='accepted' AND r.remote_post_id IS NOT NULL));

CREATE INDEX publication_history ON app.publication_observations(organization_id,brand_id,publication_id,checked_at DESC);
