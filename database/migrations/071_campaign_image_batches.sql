CREATE TABLE app.campaign_image_batches (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,plan_id uuid NOT NULL,
 request_key text NOT NULL,request_hash text NOT NULL,job_ids uuid[] NOT NULL,
 requested_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,plan_id) REFERENCES app.content_plans(organization_id,brand_id,id),
 CHECK(cardinality(job_ids) BETWEEN 1 AND 90)
);
ALTER TABLE app.campaign_image_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.campaign_image_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON app.campaign_image_batches FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_create ON app.campaign_image_batches FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND requested_by=app.actor());
GRANT SELECT,INSERT ON app.campaign_image_batches TO desvio_app;
