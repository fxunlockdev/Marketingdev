CREATE SCHEMA delivery;
REVOKE ALL ON SCHEMA delivery FROM PUBLIC;
GRANT USAGE ON SCHEMA delivery TO desvio_auth, desvio_app, desvio_mail;
CREATE TABLE delivery.outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('verify','reset','invite')),
  organization_id uuid REFERENCES app.organizations(id),
  actor_id uuid,
  dedupe_key text NOT NULL UNIQUE,
  encrypted_payload bytea,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','accepted','retry','failed','unknown','expired','canceled')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lease_id uuid,
  leased_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  CHECK ((kind='invite' AND organization_id IS NOT NULL AND actor_id IS NOT NULL) OR (kind IN ('verify','reset') AND organization_id IS NULL))
);
CREATE INDEX mail_pending ON delivery.outbox(available_at, created_at) WHERE status IN ('pending','retry');
ALTER TABLE delivery.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_mail ON delivery.outbox TO desvio_auth USING (kind IN ('verify','reset') AND organization_id IS NULL)
  WITH CHECK (kind IN ('verify','reset') AND organization_id IS NULL);
CREATE POLICY client_mail ON delivery.outbox TO desvio_app USING (kind='invite' AND app.can_access(organization_id))
  WITH CHECK (kind='invite' AND app.can_access(organization_id,true) AND actor_id=app.actor()
    AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=app.tenant() AND user_id=app.actor() AND active AND role IN ('owner','admin')));
CREATE POLICY worker_mail ON delivery.outbox TO desvio_mail USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON delivery.outbox TO desvio_auth, desvio_app;
GRANT SELECT, UPDATE ON delivery.outbox TO desvio_mail;

CREATE TABLE app.invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  email text NOT NULL CHECK (email=lower(email) AND char_length(email)<=254),
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  invited_by uuid NOT NULL REFERENCES auth."user"(id),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  accepted_by uuid REFERENCES auth."user"(id),
  expires_at timestamptz NOT NULL,
  mail_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,mail_id) REFERENCES delivery.outbox(organization_id,id)
);
CREATE INDEX invitations_tenant ON app.invitations(organization_id,created_at);
ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invite_read ON app.invitations FOR SELECT TO desvio_app USING (
  organization_id=app.tenant() AND EXISTS(SELECT 1 FROM app.memberships WHERE organization_id=app.tenant() AND user_id=app.actor() AND active AND role IN ('owner','admin')));
CREATE POLICY invite_insert ON app.invitations FOR INSERT TO desvio_app WITH CHECK (
  organization_id=app.tenant() AND invited_by=app.actor() AND EXISTS(SELECT 1 FROM app.memberships m
    WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active AND (m.role='owner' OR (m.role='admin' AND invitations.role IN ('editor','viewer')))));
GRANT SELECT, INSERT ON app.invitations TO desvio_app;

-- Dedicated NOLOGIN function owner. No auth session/account/verification access.
GRANT USAGE ON SCHEMA app, auth TO desvio_access;
GRANT USAGE ON SCHEMA delivery TO desvio_access;
GRANT SELECT(id,status),UPDATE(status,encrypted_payload) ON delivery.outbox TO desvio_access;
GRANT SELECT(id,email,"emailVerified",name) ON auth."user" TO desvio_access;
GRANT SELECT, INSERT, UPDATE ON app.memberships TO desvio_access;
GRANT SELECT, UPDATE ON app.invitations TO desvio_access;
GRANT INSERT ON app.audit_events TO desvio_access;
GRANT EXECUTE ON FUNCTION app.actor(), app.tenant() TO desvio_access;
GRANT CREATE ON SCHEMA app TO desvio_access;

CREATE FUNCTION app.accept_invitation(digest text) RETURNS TABLE(organization_id uuid, role text)
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
  SELECT m.role INTO inviter_role FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=invite.invited_by AND m.active;
  IF inviter_role IS NULL OR NOT (inviter_role='owner' OR (inviter_role='admin' AND invite.role IN ('editor','viewer'))) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002';
  END IF;
  IF EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=invite.organization_id AND m.user_id=actor AND m.active) THEN
    RAISE EXCEPTION 'Already a member; ask an owner to change your role' USING ERRCODE='23505';
  END IF;
  INSERT INTO app.memberships AS m VALUES(invite.organization_id,actor,invite.role,true)
    ON CONFLICT ON CONSTRAINT memberships_pkey DO UPDATE SET role=EXCLUDED.role,active=true;
  UPDATE app.invitations i SET status='accepted',accepted_by=actor WHERE i.id=invite.id;
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(invite.organization_id,actor,'invitation.accepted',invite.id);
  RETURN QUERY SELECT invite.organization_id,invite.role;
END $$;

CREATE FUNCTION app.team_members() RETURNS TABLE(user_id uuid,name text,email text,role text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active) THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT m.user_id,u.name,u.email,m.role,m.active FROM app.memberships m JOIN auth."user" u ON u.id=m.user_id
    WHERE m.organization_id=app.tenant() ORDER BY u.name,m.user_id LIMIT 1000;
END $$;

CREATE FUNCTION app.change_member(target uuid,new_role text,new_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
  SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active;
  SELECT m.role INTO target_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=target AND m.active;
  IF actor_role IS NULL OR target_role IS NULL OR new_role IS NULL OR new_active IS NULL OR new_role NOT IN ('owner','admin','editor','viewer')
    OR NOT (actor_role='owner' OR (actor_role='admin' AND target_role IN ('editor','viewer') AND new_role IN ('editor','viewer'))) THEN
    RAISE EXCEPTION 'Role change not permitted' USING ERRCODE='42501';
  END IF;
  IF target_role='owner' AND (NOT new_active OR new_role<>'owner')
    AND (SELECT count(*) FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.role='owner' AND m.active)<=1 THEN
    RAISE EXCEPTION 'Keep at least one workspace owner' USING ERRCODE='23514';
  END IF;
  UPDATE app.memberships m SET role=new_role,active=new_active WHERE m.organization_id=app.tenant() AND m.user_id=target;
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(app.tenant(),app.actor(),'membership.changed',target);
END $$;

CREATE FUNCTION app.revoke_invitation(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_role text; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:'||app.tenant(),0));
  SELECT m.role INTO actor_role FROM app.memberships m WHERE m.organization_id=app.tenant() AND m.user_id=app.actor() AND m.active;
  SELECT i.role INTO target_role FROM app.invitations i WHERE i.organization_id=app.tenant() AND i.id=target AND i.status='pending' FOR UPDATE;
  IF actor_role IS NULL OR target_role IS NULL OR NOT (actor_role='owner' OR (actor_role='admin' AND target_role IN ('editor','viewer'))) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002';
  END IF;
  UPDATE app.invitations i SET status='revoked' WHERE i.id=target;
  UPDATE delivery.outbox m SET status='canceled',encrypted_payload=NULL WHERE m.id=(SELECT i.mail_id FROM app.invitations i WHERE i.id=target)
    AND m.status IN ('pending','retry');
  INSERT INTO app.audit_events(organization_id,actor_id,action,resource_id) VALUES(app.tenant(),app.actor(),'invitation.revoked',target);
END $$;

ALTER FUNCTION app.accept_invitation(text) OWNER TO desvio_access;
ALTER FUNCTION app.team_members() OWNER TO desvio_access;
ALTER FUNCTION app.change_member(uuid,text,boolean) OWNER TO desvio_access;
ALTER FUNCTION app.revoke_invitation(uuid) OWNER TO desvio_access;
REVOKE CREATE ON SCHEMA app FROM desvio_access;
REVOKE ALL ON FUNCTION app.accept_invitation(text),app.team_members(),app.change_member(uuid,text,boolean),app.revoke_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_invitation(text),app.team_members(),app.change_member(uuid,text,boolean),app.revoke_invitation(uuid) TO desvio_app;
