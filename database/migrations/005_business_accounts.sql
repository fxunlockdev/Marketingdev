-- V5 terminology reuses organizations/accounts and brands/businesses. No data rewrite.
CREATE TABLE app.account_entitlements (
 organization_id uuid PRIMARY KEY REFERENCES app.organizations(id),
 max_active_businesses integer NOT NULL DEFAULT 3 CHECK(max_active_businesses BETWEEN 1 AND 1000),
 plan text NOT NULL DEFAULT 'standard',version integer NOT NULL DEFAULT 1
);
INSERT INTO app.account_entitlements(organization_id) SELECT id FROM app.organizations;
ALTER TABLE app.account_entitlements ENABLE ROW LEVEL SECURITY;ALTER TABLE app.account_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY entitlement_read ON app.account_entitlements FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=account_entitlements.organization_id AND user_id=app.actor() AND active AND role IN ('owner','admin')));
GRANT SELECT ON app.account_entitlements TO desvio_app;
CREATE TABLE app.personal_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth."user"(id),organization_id uuid NOT NULL UNIQUE REFERENCES app.organizations(id)
);
ALTER TABLE app.personal_accounts ENABLE ROW LEVEL SECURITY;ALTER TABLE app.personal_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_account_read ON app.personal_accounts FOR SELECT TO desvio_app USING(user_id=app.actor());
GRANT SELECT ON app.personal_accounts TO desvio_app;
GRANT SELECT,INSERT ON app.personal_accounts,app.account_entitlements TO desvio_bootstrap;
GRANT SELECT ON app.brands TO desvio_bootstrap;
GRANT CREATE ON SCHEMA app TO desvio_bootstrap;
CREATE FUNCTION app.ensure_personal_account() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; actor uuid:=app.actor();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account:'||actor,0));
 SELECT organization_id INTO result FROM app.personal_accounts WHERE user_id=actor;
 IF result IS NULL THEN
  result:=app.create_organization('My account');
  INSERT INTO app.personal_accounts(user_id,organization_id) VALUES(actor,result);
  INSERT INTO app.account_entitlements(organization_id) VALUES(result) ON CONFLICT DO NOTHING;
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.ensure_personal_account() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.ensure_personal_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_personal_account() TO desvio_app;
CREATE FUNCTION app.check_business_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE quota integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-limit:'||NEW.organization_id,0));
 INSERT INTO app.account_entitlements(organization_id) VALUES(NEW.organization_id) ON CONFLICT DO NOTHING;
 SELECT max_active_businesses INTO quota FROM app.account_entitlements WHERE organization_id=NEW.organization_id;
 IF (SELECT count(*) FROM app.brands WHERE organization_id=NEW.organization_id)>=quota THEN
  RAISE EXCEPTION 'BUSINESS_LIMIT_REACHED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.check_business_limit() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.check_business_limit() FROM PUBLIC;
CREATE TRIGGER business_limit BEFORE INSERT ON app.brands FOR EACH ROW EXECUTE FUNCTION app.check_business_limit();
REVOKE CREATE ON SCHEMA app FROM desvio_bootstrap;

-- Selected-business grants narrow existing account roles; legacy account-wide access is explicit.
ALTER TABLE app.memberships ADD COLUMN business_scope text NOT NULL DEFAULT 'all' CHECK(business_scope IN ('all','selected'));
CREATE TABLE app.business_memberships (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,user_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('admin','editor','viewer')),active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,brand_id,user_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES app.memberships(organization_id,user_id)
);
ALTER TABLE app.business_memberships ENABLE ROW LEVEL SECURITY;ALTER TABLE app.business_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_business_grant ON app.business_memberships FOR SELECT TO desvio_app USING(user_id=app.actor());
CREATE POLICY worker_business_grant ON app.business_memberships FOR SELECT TO desvio_worker USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND requested_by=business_memberships.user_id));
GRANT SELECT ON app.business_memberships TO desvio_app,desvio_worker;
CREATE FUNCTION app.business_access(org uuid,brand uuid,write_access boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND
 ((m.business_scope='all' AND (NOT write_access OR m.role IN ('owner','admin','editor'))) OR
 (brand IS NOT NULL AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND (NOT write_access OR b.role IN ('admin','editor'))))))
$$;
REVOKE ALL ON FUNCTION app.business_access(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.business_access(uuid,uuid,boolean) TO desvio_app;
CREATE POLICY business_scope ON app.brands AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,id)) WITH CHECK(app.business_access(organization_id,id,true));
CREATE POLICY business_scope ON app.assets AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.jobs AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.job_dispatch AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.brand_review_state AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.brand_sources AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.brand_chunks AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.brand_findings AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.brand_brain_versions AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.audit_events AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
CREATE POLICY business_scope ON app.outbox AS RESTRICTIVE TO desvio_app USING(app.business_access(organization_id,brand_id)) WITH CHECK(app.business_access(organization_id,brand_id,true));
-- Account-level idempotency responses must not leak another business to a selected seat.
CREATE POLICY account_only ON app.idempotency AS RESTRICTIVE TO desvio_app USING(EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=idempotency.organization_id AND user_id=app.actor() AND active AND business_scope='all')) WITH CHECK(EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=idempotency.organization_id AND user_id=app.actor() AND active AND business_scope='all'));
