-- Existing account-wide invitations remain explicit; new business seats are selected-only.
ALTER TABLE app.invitations ADD COLUMN business_ids uuid[] CHECK(business_ids IS NULL OR (cardinality(business_ids) BETWEEN 1 AND 1000 AND array_ndims(business_ids)=1 AND array_position(business_ids,NULL) IS NULL));
GRANT SELECT ON app.brands TO desvio_access;
GRANT SELECT,INSERT,UPDATE ON app.business_memberships TO desvio_access;
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
  IF inviter_role IS NULL OR NOT (inviter_role='owner' OR (inviter_role='admin' AND invite.role IN ('editor','viewer'))) THEN
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

ALTER FUNCTION app.accept_invitation(text) OWNER TO desvio_access;
REVOKE ALL ON FUNCTION app.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_invitation(text) TO desvio_app;
REVOKE CREATE ON SCHEMA app FROM desvio_access;

-- Effective business administration does not confer account administration.
CREATE OR REPLACE FUNCTION app.creative_reviewer(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT app.business_access(org,brand,true) AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=app.actor() AND m.active AND ((m.business_scope='all' AND m.role IN ('owner','admin')) OR (m.business_scope='selected' AND EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=app.actor() AND b.active AND b.role='admin'))))
$$;
CREATE OR REPLACE FUNCTION app.social_manager(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT app.can_access(org,true) AND app.brand_matches(brand) AND app.creative_reviewer(org,brand) $$;
GRANT CREATE ON SCHEMA app TO desvio_access;
CREATE FUNCTION app.business_team(target_brand uuid) RETURNS TABLE(user_id uuid,name text,email text,role text,active boolean,scope text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.brands WHERE organization_id=app.tenant() AND id=target_brand) OR NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND (m.business_scope='all' OR EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=m.organization_id AND b.brand_id=target_brand AND b.user_id=m.user_id AND b.active))) THEN RAISE EXCEPTION 'Business unavailable' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT m.user_id,u.name,u.email,CASE WHEN m.business_scope='all' THEN m.role ELSE b.role END,m.active AND coalesce(b.active,true),m.business_scope FROM app.memberships m JOIN auth."user" u ON u.id=m.user_id LEFT JOIN app.business_memberships b ON b.organization_id=m.organization_id AND b.brand_id=target_brand AND b.user_id=m.user_id WHERE m.organization_id=app.tenant() AND (m.business_scope='all' OR b.user_id IS NOT NULL) ORDER BY u.name,m.user_id LIMIT 1000;
END $$;
CREATE FUNCTION app.change_business_member(target_brand uuid,target_user uuid,new_role text,new_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
 SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all';
 IF actor_role IS NULL OR new_role IS NULL OR new_active IS NULL OR new_role NOT IN ('admin','editor','viewer') OR actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Role change denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.business_memberships b JOIN app.memberships m ON m.organization_id=b.organization_id AND m.user_id=b.user_id WHERE b.organization_id=app.tenant() AND b.brand_id=target_brand AND b.user_id=target_user AND m.active AND m.business_scope='selected' AND (actor_role='owner' OR (b.role<>'admin' AND new_role<>'admin'))) THEN RAISE EXCEPTION 'Manage account-wide members at account level' USING ERRCODE='42501'; END IF;
 UPDATE app.business_memberships SET role=new_role,active=new_active WHERE organization_id=app.tenant() AND brand_id=target_brand AND user_id=target_user;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES(app.tenant(),target_brand,app.actor(),CASE WHEN new_active THEN 'business.member_changed' ELSE 'business.member_removed' END,target_user);
END $$;
ALTER FUNCTION app.business_team(uuid) OWNER TO desvio_access;
ALTER FUNCTION app.change_business_member(uuid,uuid,text,boolean) OWNER TO desvio_access;
REVOKE ALL ON FUNCTION app.business_team(uuid),app.change_business_member(uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.business_team(uuid),app.change_business_member(uuid,uuid,text,boolean) TO desvio_app;
REVOKE CREATE ON SCHEMA app FROM desvio_access;

-- Account-level authority must never be inferred from a selected seat.
GRANT CREATE ON SCHEMA app TO desvio_access;
CREATE OR REPLACE FUNCTION app.team_members() RETURNS TABLE(user_id uuid,name text,email text,role text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all') THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT m.user_id,u.name,u.email,m.role,m.active FROM app.memberships m JOIN auth."user" u ON u.id=m.user_id
    WHERE m.organization_id=app.tenant() ORDER BY u.name,m.user_id LIMIT 1000;
END $$;

CREATE OR REPLACE FUNCTION app.change_member(target uuid,new_role text,new_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
  SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND m.business_scope='all';
  SELECT m.role INTO target_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=target AND m.active AND m.business_scope='all';
  IF actor_role IS NULL OR target_role IS NULL OR new_role IS NULL OR new_active IS NULL OR new_role NOT IN ('owner','admin','editor','viewer')
    OR NOT (actor_role='owner' OR (actor_role='admin' AND target_role IN ('editor','viewer') AND new_role IN ('editor','viewer'))) THEN
    RAISE EXCEPTION 'Role change not permitted' USING ERRCODE='42501';
  END IF;
  IF target_role='owner' AND (NOT new_active OR new_role<>'owner')
    AND (SELECT count(*) FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.role='owner' AND m.active AND m.business_scope='all')<=1 THEN
    RAISE EXCEPTION 'Keep at least one workspace owner' USING ERRCODE='23514';
  END IF;
  UPDATE app.memberships m SET role=new_role,active=new_active WHERE m.organization_id=app.tenant() AND m.user_id=target;
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(app.tenant(),app.actor(),'membership.changed',target);
END $$;

ALTER FUNCTION app.team_members() OWNER TO desvio_access;
ALTER FUNCTION app.change_member(uuid,text,boolean) OWNER TO desvio_access;
REVOKE CREATE ON SCHEMA app FROM desvio_access;
