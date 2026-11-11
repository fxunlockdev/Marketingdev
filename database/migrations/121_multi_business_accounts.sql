-- One account may manage several businesses again. Migration 101 forced every
-- personal account to exactly one. The per-account limit is data, not a constant:
-- it lives in app.account_entitlements and an operator can raise or lower it.
ALTER TABLE app.account_entitlements ALTER COLUMN max_active_businesses SET DEFAULT 10;

-- Accounts that 101 reduced to one get the new default. A limit an operator set
-- above one is left alone.
UPDATE app.account_entitlements e SET max_active_businesses=10,version=version+1
WHERE EXISTS(SELECT 1 FROM app.personal_accounts p WHERE p.organization_id=e.organization_id)
  AND e.max_active_businesses=1;

CREATE OR REPLACE FUNCTION app.ensure_personal_account() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; actor uuid:=app.actor();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account:'||actor,0));
 SELECT organization_id INTO result FROM app.personal_accounts WHERE user_id=actor;
 IF result IS NULL THEN
  result:=app.create_organization('My account');
  INSERT INTO app.personal_accounts(user_id,organization_id) VALUES(actor,result);
  -- Keep an existing entitlement; a new account takes the column default.
  INSERT INTO app.account_entitlements(organization_id) VALUES(result) ON CONFLICT(organization_id) DO NOTHING;
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.ensure_personal_account() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.ensure_personal_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_personal_account() TO desvio_app;

-- The limit is enforced under a per-account lock so concurrent requests cannot exceed it.
CREATE OR REPLACE FUNCTION app.check_business_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE quota integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-limit:'||NEW.organization_id,0));
 INSERT INTO app.account_entitlements(organization_id) VALUES(NEW.organization_id) ON CONFLICT DO NOTHING;
 SELECT max_active_businesses INTO quota FROM app.account_entitlements WHERE organization_id=NEW.organization_id;
 IF (SELECT count(*) FROM app.brands WHERE organization_id=NEW.organization_id AND app.business_active(organization_id,id))>=quota THEN
  RAISE EXCEPTION 'BUSINESS_LIMIT_REACHED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.check_business_limit() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.check_business_limit() FROM PUBLIC;
