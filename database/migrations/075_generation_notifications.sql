-- One-shot, explicitly requested email for a fixed set of campaign generation jobs.
ALTER TABLE delivery.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE delivery.outbox ADD CONSTRAINT outbox_kind_check CHECK(kind IN ('verify','reset','invite','generation'));
ALTER TABLE delivery.outbox DROP CONSTRAINT outbox_check;
ALTER TABLE delivery.outbox ADD CONSTRAINT outbox_check CHECK(
 (kind IN ('invite','generation') AND organization_id IS NOT NULL AND actor_id IS NOT NULL)
 OR (kind IN ('verify','reset') AND organization_id IS NULL));
ALTER TABLE delivery.outbox DROP CONSTRAINT outbox_status_check;
ALTER TABLE delivery.outbox ADD CONSTRAINT outbox_status_check CHECK(status IN ('waiting_generation','pending','processing','accepted','retry','failed','unknown','expired','canceled'));

CREATE TABLE app.generation_notifications (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL, plan_id uuid,
 actor_id uuid NOT NULL REFERENCES auth."user"(id), job_ids uuid[] NOT NULL,
 mail_id uuid NOT NULL UNIQUE, UNIQUE NULLS NOT DISTINCT(organization_id,brand_id,plan_id,actor_id,job_ids), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,plan_id) REFERENCES app.content_plans(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,mail_id) REFERENCES delivery.outbox(organization_id,id),
 CHECK(cardinality(job_ids) BETWEEN 1 AND 90)
);
ALTER TABLE app.generation_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.generation_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY removed_business ON app.generation_notifications AS RESTRICTIVE TO desvio_app USING(app.business_active(organization_id,brand_id)) WITH CHECK(app.business_active(organization_id,brand_id));
CREATE POLICY scoped_read ON app.generation_notifications FOR SELECT TO desvio_app USING(actor_id=app.actor() AND app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY scoped_insert ON app.generation_notifications FOR INSERT TO desvio_app WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true)
 AND NOT EXISTS(SELECT 1 FROM unnest(job_ids) j(id) WHERE NOT EXISTS(SELECT 1 FROM app.jobs x WHERE x.id=j.id AND x.organization_id=generation_notifications.organization_id AND x.brand_id=generation_notifications.brand_id AND x.kind IN ('creative.generate','creative.video'))));
CREATE POLICY mail_read ON app.generation_notifications FOR SELECT TO desvio_mail USING(true);
GRANT SELECT,INSERT ON app.generation_notifications TO desvio_app;
GRANT USAGE ON SCHEMA app TO desvio_mail;
GRANT SELECT ON app.generation_notifications TO desvio_mail;
CREATE POLICY notification_job_read ON app.jobs FOR SELECT TO desvio_mail USING(EXISTS(SELECT 1 FROM app.generation_notifications n WHERE n.organization_id=jobs.organization_id AND n.brand_id=jobs.brand_id AND jobs.id=ANY(n.job_ids)));
GRANT SELECT(id,organization_id,brand_id,status) ON app.jobs TO desvio_mail;
CREATE POLICY generation_mail_read ON delivery.outbox FOR SELECT TO desvio_app USING(kind='generation' AND actor_id=app.actor() AND app.can_access(organization_id));
CREATE POLICY generation_mail_insert ON delivery.outbox FOR INSERT TO desvio_app WITH CHECK(kind='generation' AND actor_id=app.actor() AND app.can_access(organization_id,true) AND status='waiting_generation');
CREATE POLICY generation_mail_cancel ON delivery.outbox FOR UPDATE TO desvio_app USING(kind='generation' AND actor_id=app.actor() AND app.can_access(organization_id) AND status IN ('waiting_generation','pending','retry')) WITH CHECK(kind='generation' AND actor_id=app.actor() AND app.can_access(organization_id) AND status='canceled' AND encrypted_payload IS NULL);
GRANT UPDATE(status,encrypted_payload) ON delivery.outbox TO desvio_app;

-- No identity/address access is granted to the delivery role. This narrow predicate
-- rechecks access before release to SMTP, including selected-business revocation.
GRANT EXECUTE ON FUNCTION app.business_active(uuid,uuid) TO desvio_access;
GRANT CREATE ON SCHEMA app TO desvio_access;
CREATE FUNCTION app.notification_recipient_active(org uuid,brand uuid,recipient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth."user" u JOIN app.memberships m ON m.user_id=u.id
 WHERE app.business_active(org,brand) AND u.id=recipient AND u."emailVerified" AND m.organization_id=org AND m.active
 AND (m.business_scope='all' OR EXISTS(SELECT 1 FROM app.business_memberships b WHERE b.organization_id=org AND b.brand_id=brand AND b.user_id=recipient AND b.active)))
$$;
ALTER FUNCTION app.notification_recipient_active(uuid,uuid,uuid) OWNER TO desvio_access;
REVOKE CREATE ON SCHEMA app FROM desvio_access;
REVOKE ALL ON FUNCTION app.notification_recipient_active(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notification_recipient_active(uuid,uuid,uuid) TO desvio_mail;
