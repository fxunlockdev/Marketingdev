-- Business administrators can approve only their own business, never sibling brands.
DROP POLICY brain_approve ON app.brand_brain_versions;
CREATE POLICY brain_approve ON app.brand_brain_versions FOR INSERT TO desvio_app
 WITH CHECK(app.social_manager(organization_id,brand_id) AND approved_by=app.actor());

-- One local publication hold covers both adapters. Published versions remain immutable.
CREATE FUNCTION app.slot_has_publication(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.publication_requests WHERE slot_id=target AND phase NOT IN ('rejected','canceled'))
 OR EXISTS(SELECT 1 FROM app.postforme_publications WHERE slot_id=target AND phase NOT IN ('rejected','canceled'))
$$;
REVOKE ALL ON FUNCTION app.slot_has_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.slot_has_publication(uuid) TO desvio_app;
CREATE FUNCTION app.protect_published_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF current_user='desvio_app' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') AND app.slot_has_publication(OLD.id) THEN
  RAISE EXCEPTION 'Resolve the existing publication before changing this post' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.protect_published_slot() FROM PUBLIC;
CREATE TRIGGER protect_published_slot BEFORE UPDATE ON app.content_slots FOR EACH ROW EXECUTE FUNCTION app.protect_published_slot();

-- Serialize new Postforme submissions against logical brand removal, as jobs already do.
CREATE TRIGGER active_publication_business BEFORE INSERT ON app.postforme_publications FOR EACH ROW EXECUTE FUNCTION app.active_job_business();
GRANT SELECT ON app.postforme_publications TO desvio_bootstrap;
GRANT CREATE ON SCHEMA app TO desvio_bootstrap;
CREATE OR REPLACE FUNCTION app.remove_business(org uuid,brand uuid,confirmation text,saved_revision integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record;
BEGIN
 IF org IS DISTINCT FROM app.tenant() OR NOT EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=org AND user_id=app.actor() AND active AND role='owner' AND business_scope='all') THEN RAISE EXCEPTION 'BUSINESS_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-limit:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('brand-lifecycle:'||brand,0));
 SELECT * INTO b FROM app.brands WHERE organization_id=org AND id=brand FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF b.name IS DISTINCT FROM confirmation OR b.revision IS DISTINCT FROM saved_revision THEN RAISE EXCEPTION 'BUSINESS_CONFIRMATION_CHANGED' USING ERRCODE='P0001'; END IF;
 IF NOT app.business_active(org,brand) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM app.jobs WHERE organization_id=org AND brand_id=brand AND status IN ('queued','running','retrying','unknown')) OR EXISTS(SELECT 1 FROM app.publication_requests WHERE organization_id=org AND brand_id=brand AND phase NOT IN ('rejected','canceled') AND observed_state IS DISTINCT FROM 'published') OR EXISTS(SELECT 1 FROM app.postforme_publications WHERE organization_id=org AND brand_id=brand AND phase NOT IN ('rejected','canceled') AND observed_state IS DISTINCT FROM 'published') THEN RAISE EXCEPTION 'BUSINESS_HAS_ACTIVE_WORK' USING ERRCODE='P0001'; END IF;
 UPDATE app.planning_loops SET stopped_at=COALESCE(stopped_at,now()) WHERE organization_id=org AND brand_id=brand;
 UPDATE app.postiz_accounts SET enabled=false WHERE organization_id=org AND brand_id=brand;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES(org,brand,app.actor(),'brand.removed',brand);
 INSERT INTO app.removed_brands(organization_id,brand_id,removed_by) VALUES(org,brand,app.actor());
 RETURN true;
END $$;
ALTER FUNCTION app.remove_business(uuid,uuid,text,integer) OWNER TO desvio_bootstrap;
REVOKE CREATE ON SCHEMA app FROM desvio_bootstrap;

-- Scope replay records to the business that owns the operation. Account operations
-- remain available only to account-wide seats; a forged brand cannot relabel them.
ALTER TABLE app.idempotency ADD COLUMN brand_id uuid;
ALTER TABLE app.idempotency ADD FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id);
UPDATE app.idempotency i SET brand_id=b.id FROM app.brands b
 WHERE i.organization_id=b.organization_id AND i.operation IN ('brain.manual:'||b.id,'asset.reserve:'||b.id,'document.extract:'||b.id);
ALTER TABLE app.idempotency ADD CONSTRAINT idempotency_business_operation CHECK (
 brand_id IS NULL OR operation IN ('brain.manual:'||brand_id,'asset.reserve:'||brand_id,'document.extract:'||brand_id));
DROP POLICY account_only ON app.idempotency;
CREATE POLICY replay_scope ON app.idempotency AS RESTRICTIVE TO desvio_app
 USING ((brand_id IS NOT NULL AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) OR
 (brand_id IS NULL AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=idempotency.organization_id AND user_id=app.actor() AND active AND business_scope='all')))
 WITH CHECK ((brand_id IS NOT NULL AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)) OR
 (brand_id IS NULL AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=idempotency.organization_id AND user_id=app.actor() AND active AND business_scope='all')));
