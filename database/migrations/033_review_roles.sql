ALTER TABLE app.business_memberships DROP CONSTRAINT business_memberships_role_check;
ALTER TABLE app.business_memberships ADD CHECK(role IN ('admin','editor','reviewer','analyst','viewer'));
ALTER TABLE app.invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE app.invitations ADD CHECK(role IN ('admin','editor','reviewer','analyst','viewer'));
ALTER TABLE app.invitations ADD CHECK(business_ids IS NOT NULL OR role IN ('admin','editor','viewer'));
DROP POLICY invite_insert ON app.invitations;
CREATE POLICY invite_insert ON app.invitations FOR INSERT TO desvio_app WITH CHECK(organization_id=app.tenant() AND invited_by=app.actor() AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all' AND (m.role='owner' OR (m.role='admin' AND invitations.role IN ('editor','reviewer','analyst','viewer')))));
CREATE OR REPLACE FUNCTION app.business_access(org uuid,brand uuid,write_access boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND
 ((m.business_scope='all' AND (NOT write_access OR m.role IN ('owner','admin','editor'))) OR
 (brand IS NOT NULL AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND (NOT write_access OR b.role IN ('admin','editor'))))))
$$;
CREATE OR REPLACE FUNCTION app.creative_reviewer(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT app.business_access(org,brand,false) AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND b.role IN ('admin','reviewer')))))
$$;
CREATE OR REPLACE FUNCTION app.social_manager(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT app.can_access(org,true) AND app.brand_matches(brand) AND app.business_access(org,brand,true) AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND b.role='admin'))))
$$;
-- Review authorization never grants general business writes or paid job creation.
CREATE FUNCTION app.review_access(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT current_setting('app.operation',true)='review' AND app.can_access(org,true) AND app.brand_matches(brand) AND app.creative_reviewer(org,brand)
$$;
REVOKE ALL ON FUNCTION app.review_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.review_access(uuid,uuid) TO desvio_app;
DROP POLICY version_review ON app.creative_versions;
CREATE POLICY version_review ON app.creative_versions FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id))) WITH CHECK((status='in_review' AND reviewed_by IS NULL) OR (app.creative_reviewer(organization_id,brand_id) AND status IN ('approved','rejected','changes_requested') AND reviewed_by=app.actor()));
DROP POLICY review_create ON app.creative_reviews;
CREATE POLICY review_create ON app.creative_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND actor_id=app.actor() AND ((decision='in_review' AND app.business_access(organization_id,brand_id,true)) OR (decision IN ('approved','rejected','changes_requested') AND app.creative_reviewer(organization_id,brand_id))));
DROP POLICY slot_change ON app.content_slots;
CREATE POLICY slot_change ON app.content_slots FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id))) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND (state NOT IN ('approved','rejected','changes_requested') OR app.creative_reviewer(organization_id,brand_id)) AND (approved_by IS NULL OR approved_by=app.actor()));
DROP POLICY event_append ON app.content_slot_events;
CREATE POLICY event_append ON app.content_slot_events FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND actor_id=app.actor() AND ((app.business_access(organization_id,brand_id,true) AND action NOT IN ('approved','rejected','changes_requested')) OR (action IN ('approved','rejected','changes_requested') AND app.creative_reviewer(organization_id,brand_id))));
DROP POLICY customer_review ON app.video_versions;
CREATE POLICY customer_review ON app.video_versions FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id))) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND (status='in_review' AND reviewed_by IS NULL OR status IN ('approved','rejected','changes_requested') AND app.creative_reviewer(organization_id,brand_id) AND reviewed_by=app.actor()));
DROP POLICY review_create ON app.video_reviews;
CREATE POLICY review_create ON app.video_reviews FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND (app.business_access(organization_id,brand_id,true) OR app.review_access(organization_id,brand_id)) AND actor_id=app.actor() AND ((decision='in_review' AND app.business_access(organization_id,brand_id,true)) OR (decision IN ('approved','rejected','changes_requested') AND app.creative_reviewer(organization_id,brand_id))));

-- A reviewer may change only review state, never content, scheduling, ownership or media.
CREATE FUNCTION app.limit_review_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE fields text[];
BEGIN
 IF current_user<>'desvio_app' THEN RETURN NEW; END IF;
 IF NOT app.business_access(OLD.organization_id,OLD.brand_id,true) THEN
  IF NOT app.review_access(OLD.organization_id,OLD.brand_id) THEN RAISE EXCEPTION 'Review access required' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='content_slots' THEN
   fields:=ARRAY['state','revision','approved_by','approved_at','updated_at'];
   IF OLD.state<>'pending_review' OR NEW.state NOT IN ('approved','rejected','changes_requested') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='42501'; END IF;
  ELSE
   fields:=ARRAY['status','review_revision','reviewed_by','reviewed_at'];
   IF OLD.status<>'in_review' OR NEW.status NOT IN ('approved','rejected','changes_requested') OR NEW.review_revision<>OLD.review_revision+1 THEN RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='42501'; END IF;
  END IF;
  IF (to_jsonb(NEW)-fields) IS DISTINCT FROM (to_jsonb(OLD)-fields) THEN RAISE EXCEPTION 'Review cannot change content' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.limit_review_update() FROM PUBLIC;
CREATE TRIGGER reviewer_fields BEFORE UPDATE ON app.creative_versions FOR EACH ROW EXECUTE FUNCTION app.limit_review_update();
CREATE TRIGGER reviewer_fields BEFORE UPDATE ON app.video_versions FOR EACH ROW EXECUTE FUNCTION app.limit_review_update();
CREATE TRIGGER reviewer_fields BEFORE UPDATE ON app.content_slots FOR EACH ROW EXECUTE FUNCTION app.limit_review_update();
GRANT CREATE ON SCHEMA app TO desvio_access;
CREATE OR REPLACE FUNCTION app.accept_invitation(digest text) RETURNS TABLE(organization_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invite app.invitations; actor uuid:=app.actor(); actor_email text; inviter_role text;
BEGIN
  SELECT u.email INTO actor_email FROM auth."user" u WHERE u.id=actor AND u."emailVerified";
  IF actor_email IS NULL THEN RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
  SELECT * INTO invite FROM app.invitations i WHERE i.token_hash=digest;
  IF NOT FOUND OR invite.email<>lower(actor_email) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||invite.organization_id,0));
  SELECT * INTO invite FROM app.invitations i WHERE i.id=invite.id FOR UPDATE;
  IF invite.status='accepted' AND invite.accepted_by=actor THEN
    RETURN QUERY SELECT m.organization_id,m.role FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=actor AND m.active;
    RETURN;
  END IF;
  IF invite.status<>'pending' OR invite.expires_at<=now() THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT m.role INTO inviter_role FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=invite.invited_by AND m.active AND m.business_scope='all';
  IF inviter_role IS NULL OR NOT (inviter_role='owner' OR (inviter_role='admin' AND invite.role IN ('editor','reviewer','analyst','viewer'))) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002';
  END IF;
  IF invite.business_ids IS NOT NULL THEN
    IF (SELECT count(*) FROM app.brands b WHERE b.organization_id=invite.organization_id AND b.id=ANY(invite.business_ids))<>cardinality(invite.business_ids) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
    IF EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=actor AND m.active AND m.business_scope='all') THEN RAISE EXCEPTION 'Already an account member' USING ERRCODE='23505'; END IF;
    IF NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=actor AND m.active) THEN UPDATE app.business_memberships SET active=false WHERE business_memberships.organization_id=invite.organization_id AND user_id=actor; END IF;
    INSERT INTO app.memberships(organization_id,user_id,role,active,business_scope) VALUES(invite.organization_id,actor,'editor',true,'selected') ON CONFLICT ON CONSTRAINT memberships_pkey DO UPDATE SET role='editor',active=true,business_scope='selected';
    INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role,active) SELECT invite.organization_id,b,actor,invite.role,true FROM unnest(invite.business_ids) b ON CONFLICT ON CONSTRAINT business_memberships_pkey DO UPDATE SET role=EXCLUDED.role,active=true;
    INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) SELECT invite.organization_id,b,actor,'business.member_added',actor FROM unnest(invite.business_ids) b;
  ELSE
  IF EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=actor AND m.active) THEN
    RAISE EXCEPTION 'Already a member; ask an owner to change your role' USING ERRCODE='23505';
  END IF;
  INSERT INTO app.memberships AS m(organization_id,user_id,role,active,business_scope) VALUES(invite.organization_id,actor,invite.role,true,'all')
    ON CONFLICT ON CONSTRAINT memberships_pkey DO UPDATE SET role=EXCLUDED.role,active=true,business_scope='all';
  END IF;
  UPDATE app.invitations i SET status='accepted',accepted_by=actor WHERE i.id=invite.id;
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(invite.organization_id,actor,'invitation.accepted',invite.id);
  RETURN QUERY SELECT invite.organization_id,invite.role;
END $$;

CREATE OR REPLACE FUNCTION app.change_business_member(target_brand uuid,target_user uuid,new_role text,new_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
 SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all';
 IF actor_role IS NULL OR new_role IS NULL OR new_active IS NULL OR new_role NOT IN ('admin','editor','reviewer','analyst','viewer') OR actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Role change denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.business_memberships b JOIN app.memberships m ON m.organization_id=b.organization_id AND m.user_id=b.user_id WHERE b.organization_id=app.tenant() AND b.brand_id=target_brand AND b.user_id=target_user AND m.active AND m.business_scope='selected' AND (actor_role='owner' OR (b.role<>'admin' AND new_role<>'admin'))) THEN RAISE EXCEPTION 'Manage account-wide members at account level' USING ERRCODE='42501'; END IF;
 UPDATE app.business_memberships SET role=new_role,active=new_active WHERE organization_id=app.tenant() AND brand_id=target_brand AND user_id=target_user;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES(app.tenant(),target_brand,app.actor(),CASE WHEN new_active THEN 'business.member_changed' ELSE 'business.member_removed' END,target_user);
END $$;
CREATE OR REPLACE FUNCTION app.revoke_invitation(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
  SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all';
  SELECT i.role INTO target_role FROM app.invitations i WHERE i.organization_id=app.tenant() AND i.id=target AND i.status='pending' FOR UPDATE;
  IF actor_role IS NULL OR target_role IS NULL OR NOT (actor_role='owner' OR (actor_role='admin' AND target_role IN ('editor','reviewer','analyst','viewer'))) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE app.invitations i SET status='revoked' WHERE i.id=target;
  UPDATE delivery.outbox m SET status='canceled',encrypted_payload=NULL WHERE m.id=(SELECT i.mail_id FROM app.invitations i WHERE i.id=target)
    AND m.status IN ('pending','retry');
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(app.tenant(),app.actor(),'invitation.revoked',target);
END $$;

ALTER FUNCTION app.accept_invitation(text) OWNER TO desvio_access;
ALTER FUNCTION app.change_business_member(uuid,uuid,text,boolean) OWNER TO desvio_access;
ALTER FUNCTION app.revoke_invitation(uuid) OWNER TO desvio_access;
REVOKE CREATE ON SCHEMA app FROM desvio_access;
