-- What the customer did with each creative: approvals, rejections with a reason, edits, regenerations and stock swaps.
-- Append-only evidence for per-business preferences. Never model output, never shared across businesses.
CREATE TABLE app.creative_signals(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,
 slot_id uuid,creative_version_id uuid,version_kind text CHECK(version_kind IN ('creative','carousel','video')),
 kind text NOT NULL CHECK(kind IN ('approved','rejected','edited','regenerated','stock_swapped')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=1000),
 diff jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(diff)='object' AND octet_length(diff::text)<=8000),
 context jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=2000),
 actor_id uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(slot_id IS NOT NULL OR creative_version_id IS NOT NULL),
 CHECK((creative_version_id IS NULL)=(version_kind IS NULL)),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,slot_id) REFERENCES app.content_slots(organization_id,brand_id,id)
);
CREATE INDEX creative_signals_recent ON app.creative_signals(organization_id,brand_id,created_at DESC);
ALTER TABLE app.creative_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.creative_signals FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.creative_signals TO desvio_app;
CREATE POLICY scoped_read ON app.creative_signals FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
-- Anyone who can edit or review this business's creatives may record what they did, only as themselves.
CREATE POLICY signal_append ON app.creative_signals FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id)
 AND (app.business_access(organization_id,brand_id,true) OR app.creative_reviewer(organization_id,brand_id)) AND actor_id=app.actor());
CREATE POLICY removed_business ON app.creative_signals AS RESTRICTIVE TO desvio_app USING(app.business_active(organization_id,brand_id)) WITH CHECK(app.business_active(organization_id,brand_id));
