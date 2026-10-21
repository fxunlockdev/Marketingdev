-- Run with the migration credential only. Runtime roles never own application tables.
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO desvio_app, desvio_bootstrap;

CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  created_by uuid NOT NULL REFERENCES auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  user_id uuid NOT NULL REFERENCES auth."user"(id),
  role text NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user ON app.memberships(user_id, organization_id) WHERE active;

CREATE FUNCTION app.actor() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app.tenant() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
CREATE FUNCTION app.brand_matches(brand uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.brand_id', true), '') IS NULL
    OR brand = nullif(current_setting('app.brand_id', true), '')::uuid $$;
CREATE FUNCTION app.can_access(org uuid, write_access boolean DEFAULT false) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT org = app.tenant() AND EXISTS (SELECT 1 FROM app.memberships m
      WHERE m.organization_id = org AND m.user_id = app.actor() AND m.active
      AND (NOT write_access OR m.role IN ('owner','admin','editor')))
  $$;

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON app.memberships FOR SELECT TO desvio_app USING (user_id = app.actor());
ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON app.organizations FOR SELECT TO desvio_app USING (
  EXISTS (SELECT 1 FROM app.memberships m WHERE m.organization_id = id AND m.active AND m.user_id = app.actor()));

CREATE TABLE app.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  website text CHECK (char_length(website) <= 2048),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX brands_tenant ON app.brands(organization_id, created_at, id);
ALTER TABLE app.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brands FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_read ON app.brands FOR SELECT TO desvio_app USING (app.can_access(organization_id) AND app.brand_matches(id));
CREATE POLICY brand_insert ON app.brands FOR INSERT TO desvio_app WITH CHECK (app.can_access(organization_id, true) AND app.brand_matches(id));
CREATE POLICY brand_update ON app.brands FOR UPDATE TO desvio_app USING (app.can_access(organization_id, true) AND app.brand_matches(id)) WITH CHECK (app.can_access(organization_id, true) AND app.brand_matches(id));

CREATE TABLE app.idempotency (
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  operation text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, operation, key)
);
ALTER TABLE app.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_read ON app.idempotency FOR SELECT TO desvio_app USING (app.can_access(organization_id, true));
CREATE POLICY idempotency_insert ON app.idempotency FOR INSERT TO desvio_app WITH CHECK (app.can_access(organization_id, true));

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  brand_id uuid,
  actor_id uuid NOT NULL REFERENCES auth."user"(id),
  action text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, brand_id) REFERENCES app.brands(organization_id,id)
);
CREATE INDEX audit_tenant ON app.audit_events(organization_id, brand_id, created_at);
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON app.audit_events FOR SELECT TO desvio_app USING (app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY audit_insert ON app.audit_events FOR INSERT TO desvio_app WITH CHECK (app.can_access(organization_id, true) AND app.brand_matches(brand_id) AND actor_id = app.actor());

CREATE TABLE app.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  event_type text NOT NULL,
  resource_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  FOREIGN KEY (organization_id,brand_id) REFERENCES app.brands(organization_id,id),
  UNIQUE (organization_id,brand_id,event_type,resource_revision)
);
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_read ON app.outbox FOR SELECT TO desvio_app USING (app.can_access(organization_id) AND app.brand_matches(brand_id));
CREATE POLICY outbox_insert ON app.outbox FOR INSERT TO desvio_app WITH CHECK (app.can_access(organization_id, true) AND app.brand_matches(brand_id));

-- A narrow provisioning capability, not a generally privileged application role.
-- Its NOLOGIN/BYPASSRLS owner has access only to these three tables.
GRANT SELECT, INSERT ON app.organizations, app.memberships, app.audit_events TO desvio_bootstrap;
GRANT CREATE ON SCHEMA app TO desvio_bootstrap;
CREATE FUNCTION app.create_organization(workspace_name text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE org uuid; actor uuid := app.actor();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE = '42501'; END IF;
  IF workspace_name IS NULL OR char_length(btrim(workspace_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid workspace name' USING ERRCODE = '22023';
  END IF;
  -- Serializes per-user workspace limits even across API replicas.
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace:' || actor, 0));
  IF (SELECT count(*) FROM app.organizations WHERE created_by = actor) >= 100 THEN
    RAISE EXCEPTION 'Workspace limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO app.organizations(name, created_by) VALUES (btrim(workspace_name), actor) RETURNING id INTO org;
  INSERT INTO app.memberships VALUES (org, actor, 'owner', true);
  INSERT INTO app.audit_events(organization_id, actor_id, action, resource_id) VALUES (org, actor, 'workspace.created', org);
  RETURN org;
END $$;
ALTER FUNCTION app.create_organization(text) OWNER TO desvio_bootstrap;
REVOKE CREATE ON SCHEMA app FROM desvio_bootstrap;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor() TO desvio_bootstrap;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO desvio_app;
GRANT SELECT ON app.organizations, app.memberships TO desvio_app;
GRANT SELECT, INSERT, UPDATE ON app.brands TO desvio_app;
GRANT SELECT, INSERT ON app.idempotency, app.audit_events, app.outbox TO desvio_app;
