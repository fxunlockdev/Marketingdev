-- A business's creative direction for social posts, set from the looks picked in onboarding and
-- changed later in Brand Kit. It replaces the paid mood board as the approved direction.
-- Every change is a new immutable version; generators read the latest version that existed when
-- their job was created, so a change affects only posts generated afterwards.
CREATE TABLE app.brand_creative_directions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 source text NOT NULL CHECK(source IN ('onboarding','brand_kit')),
 look_ids text[] NOT NULL DEFAULT '{}' CHECK(cardinality(look_ids)<=3),
 direction jsonb NOT NULL CHECK(jsonb_typeof(direction)='object' AND length(direction::text)<=20000),
 -- Onboarding inputs (looks, research job, owner notes) that produced this version, for idempotency.
 source_hash text CHECK((source='onboarding')=(source_hash IS NOT NULL)),
 created_by uuid NOT NULL REFERENCES auth."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id), UNIQUE(organization_id,brand_id,version),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE INDEX brand_creative_direction_latest ON app.brand_creative_directions(organization_id,brand_id,version DESC);
ALTER TABLE app.brand_creative_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brand_creative_directions FORCE ROW LEVEL SECURITY;
CREATE POLICY creative_direction_read ON app.brand_creative_directions FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- Onboarding is saved by whoever runs it with write access; a Brand Kit change needs an owner or admin.
CREATE POLICY creative_direction_create ON app.brand_creative_directions FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
  AND created_by=app.actor() AND (source<>'brand_kit' OR app.social_manager(organization_id,brand_id)));
GRANT SELECT,INSERT ON app.brand_creative_directions TO desvio_app;
-- Image and carousel jobs read the direction of their own business while they run. Read-only.
GRANT SELECT ON app.brand_creative_directions TO desvio_worker;
CREATE POLICY creative_direction_generation_read ON app.brand_creative_directions FOR SELECT TO desvio_worker
 USING(app.creative_scope(organization_id,brand_id) OR app.carousel_scope(organization_id,brand_id));
CREATE POLICY creative_direction_operator ON app.brand_creative_directions TO CURRENT_USER USING(true) WITH CHECK(true);

-- A guided monthly plan now follows a creative direction version; plans made from an approved
-- mood board keep their link to it.
ALTER TABLE app.guided_campaigns ALTER COLUMN moodboard_id DROP NOT NULL,
 ADD COLUMN direction_id uuid,
 ADD CONSTRAINT guided_campaign_direction FOREIGN KEY(organization_id,brand_id,direction_id) REFERENCES app.brand_creative_directions(organization_id,brand_id,id),
 ADD CONSTRAINT guided_campaign_direction_source CHECK(num_nonnulls(moodboard_id,direction_id)=1);
