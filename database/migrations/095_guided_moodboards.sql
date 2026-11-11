-- Onboarding previews are separate from billable campaign content.
CREATE TABLE app.guided_moodboards (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 brief_revision integer NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0),
 direction jsonb NOT NULL CHECK(jsonb_typeof(direction)='object'),
 feedback text NOT NULL DEFAULT '' CHECK(length(feedback)<=1200),
 image_job_id uuid NOT NULL, carousel_job_id uuid NOT NULL,
 request_key text NOT NULL, request_hash text NOT NULL,
 created_by uuid NOT NULL REFERENCES auth."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, approved_by uuid REFERENCES auth."user"(id),
 image_version_id uuid, carousel_version_id uuid,
 UNIQUE(organization_id,brand_id,id), UNIQUE(organization_id,brand_id,request_key),
 UNIQUE(organization_id,brand_id,ordinal),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,image_job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,carousel_job_id) REFERENCES app.jobs(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,image_version_id) REFERENCES app.creative_versions(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,carousel_version_id) REFERENCES app.carousel_versions(organization_id,brand_id,id),
 CHECK((approved_at IS NULL AND approved_by IS NULL AND image_version_id IS NULL AND carousel_version_id IS NULL) OR
 (approved_at IS NOT NULL AND approved_by IS NOT NULL AND image_version_id IS NOT NULL AND carousel_version_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_locked_moodboard ON app.guided_moodboards(organization_id,brand_id) WHERE approved_at IS NOT NULL;
ALTER TABLE app.guided_moodboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guided_moodboards FORCE ROW LEVEL SECURITY;
CREATE POLICY moodboard_read ON app.guided_moodboards FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY moodboard_create ON app.guided_moodboards FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND approved_at IS NULL);
CREATE POLICY moodboard_approve ON app.guided_moodboards FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND approved_at IS NULL) WITH CHECK(approved_by=app.actor() AND approved_at IS NOT NULL);
GRANT SELECT,INSERT ON app.guided_moodboards TO desvio_app;
GRANT UPDATE(approved_at,approved_by,image_version_id,carousel_version_id) ON app.guided_moodboards TO desvio_app;

CREATE POLICY moodboard_operator ON app.guided_moodboards TO CURRENT_USER USING(true) WITH CHECK(true);
