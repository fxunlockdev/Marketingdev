-- Customer accounts own one business. Existing brands and memberships are retained.
UPDATE app.account_entitlements e SET max_active_businesses=1,version=version+1
WHERE EXISTS(SELECT 1 FROM app.personal_accounts p WHERE p.organization_id=e.organization_id)
  AND e.max_active_businesses<>1;

GRANT UPDATE(max_active_businesses,version) ON app.account_entitlements TO desvio_bootstrap;

CREATE OR REPLACE FUNCTION app.ensure_personal_account() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; actor uuid:=app.actor();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account:'||actor,0));
 SELECT organization_id INTO result FROM app.personal_accounts WHERE user_id=actor;
 IF result IS NULL THEN
  result:=app.create_organization('My account');
  INSERT INTO app.personal_accounts(user_id,organization_id) VALUES(actor,result);
  INSERT INTO app.account_entitlements(organization_id,max_active_businesses) VALUES(result,1)
   ON CONFLICT(organization_id) DO UPDATE SET max_active_businesses=1,version=account_entitlements.version+1;
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.ensure_personal_account() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.ensure_personal_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_personal_account() TO desvio_app;

CREATE OR REPLACE FUNCTION app.check_business_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE quota integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-limit:'||NEW.organization_id,0));
 INSERT INTO app.account_entitlements(organization_id) VALUES(NEW.organization_id) ON CONFLICT DO NOTHING;
 SELECT max_active_businesses INTO quota FROM app.account_entitlements WHERE organization_id=NEW.organization_id;
 IF EXISTS(SELECT 1 FROM app.personal_accounts WHERE organization_id=NEW.organization_id) THEN quota:=1; END IF;
 IF (SELECT count(*) FROM app.brands WHERE organization_id=NEW.organization_id AND app.business_active(organization_id,id))>=quota THEN
  RAISE EXCEPTION 'BUSINESS_LIMIT_REACHED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.check_business_limit() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.check_business_limit() FROM PUBLIC;
