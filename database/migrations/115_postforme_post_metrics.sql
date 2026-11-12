-- Scheduled Post for Me metric snapshots, one per published post and checkpoint.
-- Each row is the provider's lifetime total at collection time; rows are never summed or differenced.
CREATE TABLE app.postforme_post_metrics(
 publication_id uuid NOT NULL REFERENCES app.postforme_publications(id),organization_id uuid NOT NULL,brand_id uuid NOT NULL,account_id uuid NOT NULL,
 checkpoint text NOT NULL CHECK(checkpoint IN ('1h','24h','72h','7d','30d')),
 state text NOT NULL CHECK(state IN ('available','missing')),
 metrics jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metrics)='object' AND octet_length(metrics::text)<=8000),
 posted_at timestamptz,collected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(publication_id,checkpoint),
 CHECK(state='available' OR metrics='{}'::jsonb),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,account_id) REFERENCES app.postforme_accounts(organization_id,brand_id,id)
);
CREATE INDEX postforme_post_metrics_brand ON app.postforme_post_metrics(organization_id,brand_id,collected_at);
ALTER TABLE app.postforme_post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.postforme_post_metrics FORCE ROW LEVEL SECURITY;
-- Customers read their own business's snapshots; only the scheduled collector writes them.
GRANT SELECT ON app.postforme_post_metrics TO desvio_app;
CREATE POLICY member_read ON app.postforme_post_metrics FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY removed_business ON app.postforme_post_metrics AS RESTRICTIVE TO desvio_app USING(app.business_active(organization_id,brand_id)) WITH CHECK(app.business_active(organization_id,brand_id));
-- The collector runs on the worker's timer with no user. It sees only published posts on connected
-- accounts of active businesses, only the columns needed to match a feed post, and can only append snapshots.
GRANT SELECT(id,organization_id,brand_id,account_id,caption,scheduled_at,release_url,phase,observed_state) ON app.postforme_publications TO desvio_dispatcher;
CREATE POLICY learning_sync_read ON app.postforme_publications FOR SELECT TO desvio_dispatcher USING(phase='accepted' AND observed_state='published' AND app.business_active(organization_id,brand_id));
GRANT SELECT(id,organization_id,brand_id,remote_id,status) ON app.postforme_accounts TO desvio_dispatcher;
CREATE POLICY learning_sync_read ON app.postforme_accounts FOR SELECT TO desvio_dispatcher USING(status='connected' AND app.business_active(organization_id,brand_id));
GRANT SELECT,INSERT ON app.postforme_post_metrics TO desvio_dispatcher;
CREATE POLICY learning_sync_read ON app.postforme_post_metrics FOR SELECT TO desvio_dispatcher USING(true);
CREATE POLICY learning_sync_append ON app.postforme_post_metrics FOR INSERT TO desvio_dispatcher WITH CHECK(EXISTS(
 SELECT 1 FROM app.postforme_publications p WHERE p.id=publication_id AND p.organization_id=postforme_post_metrics.organization_id
  AND p.brand_id=postforme_post_metrics.brand_id AND p.account_id=postforme_post_metrics.account_id));
