CREATE TABLE app.dismissed_prompt_ideas (
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),
 PRIMARY KEY (organization_id,brand_id,actor_id),
 FOREIGN KEY (organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.dismissed_prompt_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dismissed_prompt_ideas FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.dismissed_prompt_ideas TO desvio_app;
CREATE POLICY own_prompt_preference ON app.dismissed_prompt_ideas TO desvio_app
 USING(actor_id=app.actor() AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false) AND app.can_access(organization_id,false))
 WITH CHECK(actor_id=app.actor() AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND app.can_access(organization_id,true));
