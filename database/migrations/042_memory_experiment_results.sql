-- Human-reported experiment records never promote a hypothesis to a brand fact.
CREATE TABLE app.memory_experiments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL, lesson_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id), lesson_revision integer NOT NULL CHECK(lesson_revision>0),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128), request_hash text NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 method text NOT NULL CHECK(length(method) BETWEEN 10 AND 2000),
 outcome text NOT NULL CHECK(outcome IN ('supported','not_supported','inconclusive')),
 results text NOT NULL CHECK(length(results) BETWEEN 10 AND 4000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lesson_id,request_key), FOREIGN KEY(organization_id,brand_id,lesson_id) REFERENCES app.memory_lessons(organization_id,brand_id,id)
);
ALTER TABLE app.memory_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_experiments FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.memory_experiments TO desvio_app;
CREATE POLICY scoped_read ON app.memory_experiments FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_append ON app.memory_experiments FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.social_manager(organization_id,brand_id) AND actor_id=app.actor() AND EXISTS(SELECT 1 FROM app.memory_lessons l WHERE l.id=lesson_id AND l.state='testing' AND l.revision=lesson_revision));
