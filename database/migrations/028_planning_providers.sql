ALTER TABLE app.planning_grants ADD COLUMN provider text NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai','gemini'));
ALTER TABLE app.planning_grants DROP CONSTRAINT planning_grants_pkey;
ALTER TABLE app.planning_grants ADD PRIMARY KEY(organization_id,brand_id,provider);
GRANT SELECT ON app.planning_grants TO desvio_app;
CREATE POLICY customer_grant_read ON app.planning_grants FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
ALTER TABLE app.planning_requests ADD COLUMN provider text NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai','gemini')), ADD COLUMN selected_model text CHECK(length(selected_model) BETWEEN 1 AND 100);
UPDATE app.planning_requests r SET selected_model=g.model FROM app.planning_grants g WHERE g.organization_id=r.organization_id AND g.brand_id=r.brand_id AND g.provider=r.provider;
ALTER TABLE app.planning_calls ADD COLUMN provider text NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai','gemini'));
