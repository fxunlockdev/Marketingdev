CREATE TABLE app.carousel_projects (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES auth."user"(id),
 latest_version_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.carousel_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,project_id uuid NOT NULL,parent_id uuid,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),caption text NOT NULL CHECK(length(caption) BETWEEN 1 AND 3000),channel text NOT NULL CHECK(channel IN ('linkedin','instagram')),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES auth."user"(id),request_key text NOT NULL,request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','changes_requested','rejected')),
 review_revision integer NOT NULL DEFAULT 1 CHECK(review_revision>0),reviewed_by uuid REFERENCES auth."user"(id),reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,id),UNIQUE(organization_id,brand_id,project_id,id),UNIQUE(organization_id,brand_id,created_by,request_key),
 FOREIGN KEY(organization_id,brand_id,project_id) REFERENCES app.carousel_projects(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,project_id,parent_id) REFERENCES app.carousel_versions(organization_id,brand_id,project_id,id)
);
ALTER TABLE app.carousel_projects ADD FOREIGN KEY(organization_id,brand_id,id,latest_version_id) REFERENCES app.carousel_versions(organization_id,brand_id,project_id,id);
CREATE TABLE app.carousel_pages (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,carousel_version_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 9),
 creative_version_id uuid NOT NULL,export_id uuid NOT NULL,alt_text text NOT NULL CHECK(length(alt_text) BETWEEN 1 AND 1000),
 PRIMARY KEY(carousel_version_id,position),UNIQUE(carousel_version_id,creative_version_id),
 FOREIGN KEY(organization_id,brand_id,carousel_version_id) REFERENCES app.carousel_versions(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,creative_version_id) REFERENCES app.creative_versions(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,export_id) REFERENCES app.creative_exports(organization_id,brand_id,id)
);
CREATE TABLE app.carousel_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,version_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),
 decision text NOT NULL CHECK(decision IN ('in_review','approved','changes_requested','rejected')),feedback text NOT NULL CHECK(length(feedback)<=2000),revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version_id,revision),FOREIGN KEY(organization_id,brand_id,version_id) REFERENCES app.carousel_versions(organization_id,brand_id,id)
);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['carousel_projects','carousel_versions','carousel_pages','carousel_reviews'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP; END $$;
GRANT SELECT,INSERT ON app.carousel_projects,app.carousel_versions,app.carousel_pages,app.carousel_reviews TO desvio_app;
GRANT UPDATE(latest_version_id) ON app.carousel_projects TO desvio_app;
GRANT UPDATE(status,review_revision,reviewed_by,reviewed_at) ON app.carousel_versions TO desvio_app;
CREATE POLICY project_create ON app.carousel_projects FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND latest_version_id IS NULL);
CREATE POLICY project_change ON app.carousel_projects FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY version_create ON app.carousel_versions FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND status='draft' AND review_revision=1 AND reviewed_by IS NULL);
CREATE POLICY page_create ON app.carousel_pages FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND EXISTS(SELECT 1 FROM app.carousel_versions v WHERE v.id=carousel_version_id AND v.status='draft' AND v.created_by=app.actor()));
CREATE POLICY version_review ON app.carousel_versions FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id))) WITH CHECK((status='in_review' AND reviewed_by IS NULL AND app.business_access(organization_id,brand_id,true)) OR (status IN ('approved','changes_requested','rejected') AND reviewed_by=app.actor() AND app.creative_reviewer(organization_id,brand_id)));
CREATE POLICY review_append ON app.carousel_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND actor_id=app.actor() AND ((decision='in_review' AND app.business_access(organization_id,brand_id,true)) OR (decision IN ('approved','changes_requested','rejected') AND app.creative_reviewer(organization_id,brand_id))));
