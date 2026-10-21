CREATE TABLE app.business_onboarding (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,step integer NOT NULL DEFAULT 2 CHECK(step IN (2,3)),revision integer NOT NULL DEFAULT 1,
 goal text NOT NULL DEFAULT 'awareness' CHECK(goal IN ('awareness','traffic','leads','sales')),
 timezone text NOT NULL DEFAULT 'UTC',cadence integer NOT NULL DEFAULT 3 CHECK(cadence BETWEEN 1 AND 30),
 channels jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(channels)='array'),must_avoid text NOT NULL DEFAULT '' CHECK(length(must_avoid)<=2000),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.business_onboarding ENABLE ROW LEVEL SECURITY;ALTER TABLE app.business_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_read ON app.business_onboarding FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY onboarding_insert ON app.business_onboarding FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY onboarding_update ON app.business_onboarding FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
GRANT SELECT,INSERT ON app.business_onboarding TO desvio_app;
GRANT UPDATE(step,revision,goal,timezone,cadence,channels,must_avoid,updated_at) ON app.business_onboarding TO desvio_app;
