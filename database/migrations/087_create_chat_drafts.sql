-- Private author drafts are distinct from approved Brand Brain knowledge.
CREATE TABLE app.create_chat_drafts (
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=120000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id,actor_id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.create_chat_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.create_chat_drafts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.create_chat_drafts TO desvio_app;
CREATE POLICY own_chat_draft ON app.create_chat_drafts TO desvio_app
 USING(actor_id=app.actor() AND app.can_access(organization_id,false) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false))
 WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
