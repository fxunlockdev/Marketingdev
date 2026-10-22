-- Business-owned plans and per-channel approvals. Planned time never means published/scheduled.
ALTER TABLE app.creative_versions ADD UNIQUE(organization_id,brand_id,id,sha256);
CREATE TABLE app.content_plans (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140), objective text NOT NULL CHECK(length(objective) BETWEEN 1 AND 2000),
 starts_on date NOT NULL, timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 100),
 origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 created_by uuid NOT NULL REFERENCES auth."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 request_key text NOT NULL, request_hash text NOT NULL,
 UNIQUE(organization_id,brand_id,id), UNIQUE(organization_id,brand_id,created_by,request_key),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE TABLE app.content_slots (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL, plan_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('linkedin','instagram')), planned_at timestamptz NOT NULL,
 format text NOT NULL CHECK(format IN ('static','ad')), brief text NOT NULL CHECK(length(brief) BETWEEN 1 AND 4000),
 pillar text NOT NULL CHECK(length(pillar)<=140), hook text NOT NULL CHECK(length(hook)<=500), cta text NOT NULL CHECK(length(cta)<=500),
 creative_version_id uuid, creative_sha256 text, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'content_needed' CHECK(state IN ('content_needed','draft_ready','pending_review','approved','changes_requested','rejected','cancelled')),
 approved_by uuid REFERENCES auth."user"(id), approved_at timestamptz,
 created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((creative_version_id IS NULL)=(creative_sha256 IS NULL)),
 CHECK(state IN ('content_needed','cancelled') OR creative_version_id IS NOT NULL),
 CHECK((state='approved')=(approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK((approved_by IS NULL)=(approved_at IS NULL)),
 UNIQUE(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,plan_id) REFERENCES app.content_plans(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,creative_version_id,creative_sha256) REFERENCES app.creative_versions(organization_id,brand_id,id,sha256)
);
CREATE INDEX content_slots_calendar ON app.content_slots(organization_id,brand_id,planned_at,id);
CREATE TABLE app.content_slot_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,slot_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN ('created','edited','pending_review','approved','changes_requested','rejected','cancelled')),
 actor_id uuid NOT NULL REFERENCES auth."user"(id),creative_version_id uuid,creative_sha256 text,
 feedback text NOT NULL CHECK(length(feedback)<=2000),snapshot jsonb NOT NULL CHECK(octet_length(snapshot::text)<=32000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(slot_id,revision),FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,creative_version_id,creative_sha256) REFERENCES app.creative_versions(organization_id,brand_id,id,sha256)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['content_plans','content_slots','content_slot_events'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY scoped_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON app.content_plans,app.content_slots,app.content_slot_events TO desvio_app;
CREATE POLICY plan_create ON app.content_plans FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor());
CREATE POLICY slot_create ON app.content_slots FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor() AND state IN ('content_needed','draft_ready') AND revision=1 AND approved_by IS NULL);
CREATE POLICY slot_change ON app.content_slots FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND (state NOT IN ('approved','rejected','changes_requested') OR app.creative_reviewer(organization_id,brand_id)) AND (approved_by IS NULL OR approved_by=app.actor()));
GRANT UPDATE(planned_at,brief,pillar,hook,cta,creative_version_id,creative_sha256,revision,state,approved_by,approved_at,updated_at) ON app.content_slots TO desvio_app;
CREATE POLICY event_append ON app.content_slot_events FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND actor_id=app.actor() AND (action NOT IN ('approved','rejected','changes_requested') OR app.creative_reviewer(organization_id,brand_id)));
-- No worker/dispatcher access until the generated-plan workflow adds a bound-job policy.
