-- Delegated business administrators cannot grant account access or manage other admins.
GRANT CREATE ON SCHEMA app TO desvio_access;
CREATE FUNCTION app.invitation_authorized(org uuid,actor uuid,brands uuid[],target_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=org AND m.user_id=actor AND m.active AND (
  (m.business_scope='all' AND (m.role='owner' OR (m.role='admin' AND target_role IN ('editor','reviewer','analyst','viewer')))) OR
  (m.business_scope='selected' AND target_role IN ('editor','reviewer','analyst','viewer') AND cardinality(brands) BETWEEN 1 AND 1000
   AND array_position(brands,NULL) IS NULL AND NOT EXISTS(SELECT 1 FROM unnest(brands) b WHERE NOT EXISTS(
    SELECT 1 FROM app.business_memberships bm JOIN app.brands br ON br.organization_id=bm.organization_id AND br.id=bm.brand_id
    WHERE bm.organization_id=org AND bm.brand_id=b AND bm.user_id=actor AND bm.active AND bm.role='admin')))
 )),false)
$$;
ALTER FUNCTION app.invitation_authorized(uuid,uuid,uuid[],text) OWNER TO desvio_access;
REVOKE ALL ON FUNCTION app.invitation_authorized(uuid,uuid,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_authorized(uuid,uuid,uuid[],text) TO desvio_app;
CREATE FUNCTION app.invitation_businesses(org uuid,brands uuid[]) RETURNS TABLE(id uuid,name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.id,b.name FROM app.brands b WHERE b.organization_id=org AND b.id=ANY(brands) AND org=app.tenant()
 AND app.invitation_authorized(org,app.actor(),brands,'editor') ORDER BY b.name,b.id
$$;
ALTER FUNCTION app.invitation_businesses(uuid,uuid[]) OWNER TO desvio_access;
REVOKE ALL ON FUNCTION app.invitation_businesses(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_businesses(uuid,uuid[]) TO desvio_app;
CREATE FUNCTION app.invitation_daily_count() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(*) FROM app.invitations WHERE organization_id=app.tenant() AND created_at>now()-interval '1 day'
 AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=app.tenant() AND user_id=app.actor() AND active)
$$;
ALTER FUNCTION app.invitation_daily_count() OWNER TO desvio_access;
REVOKE ALL ON FUNCTION app.invitation_daily_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_daily_count() TO desvio_app;
DROP POLICY invite_read ON app.invitations;
CREATE POLICY invite_read ON app.invitations FOR SELECT TO desvio_app USING(organization_id=app.tenant() AND (
 EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=app.tenant() AND user_id=app.actor() AND active AND business_scope='all' AND role IN ('owner','admin'))
 OR app.invitation_authorized(organization_id,app.actor(),business_ids,role)));
DROP POLICY invite_insert ON app.invitations;
CREATE POLICY invite_insert ON app.invitations FOR INSERT TO desvio_app WITH CHECK(organization_id=app.tenant() AND invited_by=app.actor() AND app.invitation_authorized(organization_id,app.actor(),business_ids,role));
DROP POLICY client_mail ON delivery.outbox;
CREATE POLICY client_mail ON delivery.outbox TO desvio_app USING(kind='invite' AND app.can_access(organization_id))
 WITH CHECK(kind='invite' AND app.can_access(organization_id,true) AND actor_id=app.actor() AND (
 EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=app.tenant() AND user_id=app.actor() AND active AND business_scope='all' AND role IN ('owner','admin'))
 OR EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=app.tenant() AND bm.user_id=app.actor() AND bm.active AND bm.role='admin')));
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
  IF NOT app.invitation_authorized(invite.organization_id,invite.invited_by,invite.business_ids,invite.role) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002';
  END IF;
  IF invite.business_ids IS NOT NULL THEN
    IF (SELECT count(*) FROM app.brands b WHERE b.organization_id=invite.organization_id AND b.id=ANY(invite.business_ids))<>cardinality(invite.business_ids) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
    IF NOT app.invitation_authorized(invite.organization_id,invite.invited_by,invite.business_ids,'admin') AND EXISTS(SELECT 1 FROM app.business_memberships bm WHERE bm.organization_id=invite.organization_id AND bm.user_id=actor AND bm.brand_id=ANY(invite.business_ids) AND bm.role='admin') THEN RAISE EXCEPTION 'Only an owner can change an admin' USING ERRCODE='23505'; END IF;
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
 IF actor_role IS NULL AND app.invitation_authorized(app.tenant(),app.actor(),ARRAY[target_brand],'editor') THEN actor_role:='admin'; END IF;
 IF actor_role IS NULL OR new_role IS NULL OR new_active IS NULL OR new_role NOT IN ('admin','editor','reviewer','analyst','viewer') OR actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Role change denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.business_memberships b JOIN app.memberships m ON m.organization_id=b.organization_id AND m.user_id=b.user_id WHERE b.organization_id=app.tenant() AND b.brand_id=target_brand AND b.user_id=target_user AND m.active AND m.business_scope='selected' AND (actor_role='owner' OR (b.role<>'admin' AND new_role<>'admin'))) THEN RAISE EXCEPTION 'Manage account-wide members at account level' USING ERRCODE='42501'; END IF;
 UPDATE app.business_memberships SET role=new_role,active=new_active WHERE organization_id=app.tenant() AND brand_id=target_brand AND user_id=target_user;
 INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES(app.tenant(),target_brand,app.actor(),CASE WHEN new_active THEN 'business.member_changed' ELSE 'business.member_removed' END,target_user);
END $$;
CREATE OR REPLACE FUNCTION app.revoke_invitation(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target_role text; target_businesses uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
  SELECT i.role,i.business_ids INTO target_role,target_businesses FROM app.invitations i WHERE i.organization_id=app.tenant() AND i.id=target AND i.status='pending' FOR UPDATE;
  IF target_role IS NULL OR NOT app.invitation_authorized(app.tenant(),app.actor(),target_businesses,target_role) THEN
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

-- Keep delegated request replays separate from account-wide idempotency responses.
CREATE TABLE app.business_invitation_requests (
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),
 operation text NOT NULL CHECK(operation='invitation.create'),
 key text NOT NULL,
 request_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id,actor_id,operation,key),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.business_invitation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.business_invitation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY own_business_request ON app.business_invitation_requests TO desvio_app
 USING(organization_id=app.tenant() AND app.brand_matches(brand_id) AND actor_id=app.actor() AND app.invitation_authorized(organization_id,app.actor(),ARRAY[brand_id],'editor'))
 WITH CHECK(organization_id=app.tenant() AND app.brand_matches(brand_id) AND actor_id=app.actor() AND app.invitation_authorized(organization_id,app.actor(),ARRAY[brand_id],'editor'));
GRANT SELECT,INSERT ON app.business_invitation_requests TO desvio_app;
