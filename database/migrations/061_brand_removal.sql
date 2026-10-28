-- Logical removal preserves audit/provider reconciliation records; not an erasure claim.
CREATE TABLE app.removed_brands (
 organization_id uuid NOT NULL, brand_id uuid PRIMARY KEY,
 removed_by uuid NOT NULL REFERENCES auth."user"(id), removed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.removed_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.removed_brands FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON app.removed_brands TO desvio_bootstrap;
GRANT CREATE ON SCHEMA app TO desvio_bootstrap;
GRANT EXECUTE ON FUNCTION app.tenant() TO desvio_bootstrap;
CREATE FUNCTION app.business_active(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM app.removed_brands r WHERE r.organization_id=org AND r.brand_id=brand)
$$;
ALTER FUNCTION app.business_active(uuid,uuid) OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.business_active(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.business_active(uuid,uuid) TO desvio_app,desvio_worker,desvio_dispatcher,desvio_provisioner;
-- Restrict every existing customer business surface, including legacy direct reads.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='app' AND column_name='brand_id' AND table_name<>'removed_brands' LOOP
  EXECUTE format('CREATE POLICY removed_business ON app.%I AS RESTRICTIVE TO desvio_app USING(app.business_active(organization_id,brand_id)) WITH CHECK(app.business_active(organization_id,brand_id))',t.table_name);
 END LOOP;
END $$;
CREATE POLICY removed_business ON app.brands AS RESTRICTIVE TO desvio_app USING(app.business_active(organization_id,id)) WITH CHECK(app.business_active(organization_id,id));
-- Serialize job insertion against removal, including background recurring jobs.
CREATE FUNCTION app.active_job_business() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-lifecycle:'||NEW.brand_id,0));
 IF NOT app.business_active(NEW.organization_id,NEW.brand_id) THEN RAISE EXCEPTION 'BUSINESS_REMOVED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.active_job_business() OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.active_job_business() FROM PUBLIC;
CREATE TRIGGER active_job_business BEFORE INSERT ON app.jobs FOR EACH ROW EXECUTE FUNCTION app.active_job_business();
GRANT SELECT ON app.jobs,app.publication_requests TO desvio_bootstrap;
GRANT UPDATE ON app.brands TO desvio_bootstrap;
GRANT SELECT,UPDATE ON app.planning_loops,app.postiz_accounts TO desvio_bootstrap;
CREATE FUNCTION app.remove_business(org uuid,brand uuid,confirmation text,saved_revision integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;
BEGIN
 IF org IS DISTINCT FROM app.tenant() OR NOT EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=org AND user_id=app.actor() AND active AND role='owner' AND business_scope='all') THEN RAISE EXCEPTION 'BUSINESS_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-limit:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-lifecycle:'||brand,0));
 SELECT * INTO b FROM app.brands WHERE organization_id=org AND id=brand FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF b.name IS DISTINCT FROM confirmation OR b.revision IS DISTINCT FROM saved_revision THEN RAISE EXCEPTION 'BUSINESS_CONFIRMATION_CHANGED' USING ERRCODE='P0001'; END IF;
 IF NOT app.business_active(org,brand) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM app.jobs WHERE organization_id=org AND brand_id=brand AND status IN ('queued','running','retrying','unknown')) OR EXISTS(SELECT 1 FROM app.publication_requests WHERE organization_id=org AND brand_id=brand AND phase NOT IN ('rejected','canceled') AND observed_state IS DISTINCT FROM 'published') THEN RAISE EXCEPTION 'BUSINESS_HAS_ACTIVE_WORK' USING ERRCODE='P0001'; END IF;
 UPDATE app.planning_loops SET stopped_at=COALESCE(stopped_at,now()) WHERE organization_id=org AND brand_id=brand;
 UPDATE app.postiz_accounts SET enabled=false WHERE organization_id=org AND brand_id=brand;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES(org,brand,app.actor(),'brand.removed',brand);
 INSERT INTO app.removed_brands(organization_id,brand_id,removed_by) VALUES(org,brand,app.actor());
 RETURN true;
END $$;
ALTER FUNCTION app.remove_business(uuid,uuid,text,integer) OWNER TO desvio_bootstrap;
REVOKE ALL ON FUNCTION app.remove_business(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_business(uuid,uuid,text,integer) TO desvio_app;
REVOKE CREATE ON SCHEMA app FROM desvio_bootstrap;

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
