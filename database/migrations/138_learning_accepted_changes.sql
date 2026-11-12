-- Monthly review: the changes an owner or administrator accepted for next month ("Use this for next month").
-- The text is copied from the review's own proposal; planners read the active rows (learning-context.ts).
CREATE TABLE app.learning_accepted_changes(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 action text NOT NULL CHECK(action IN ('do_more','do_less','respect_preference','collect_more')),
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 400),basis text NOT NULL CHECK(length(basis)<=400),
 sample_size integer NOT NULL CHECK(sample_size>=0),label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 accepted_by uuid NOT NULL REFERENCES auth."user"(id),accepted_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_by uuid REFERENCES auth."user"(id),withdrawn_at timestamptz,
 UNIQUE(organization_id,brand_id,month,text),
 CHECK((withdrawn_at IS NULL)=(withdrawn_by IS NULL)),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE INDEX learning_accepted_changes_active ON app.learning_accepted_changes(organization_id,brand_id,month) WHERE withdrawn_at IS NULL;
ALTER TABLE app.learning_accepted_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.learning_accepted_changes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.learning_accepted_changes TO desvio_app;
GRANT UPDATE(withdrawn_by,withdrawn_at) ON app.learning_accepted_changes TO desvio_app;
CREATE POLICY member_read ON app.learning_accepted_changes FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY manager_accept ON app.learning_accepted_changes FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND accepted_by=app.actor() AND withdrawn_at IS NULL);
CREATE POLICY manager_withdraw ON app.learning_accepted_changes FOR UPDATE TO desvio_app
 USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND withdrawn_at IS NULL)
 WITH CHECK(app.social_manager(organization_id,brand_id) AND withdrawn_by=app.actor());
CREATE POLICY removed_business ON app.learning_accepted_changes AS RESTRICTIVE TO desvio_app
 USING(app.business_active(organization_id,brand_id)) WITH CHECK(app.business_active(organization_id,brand_id));
