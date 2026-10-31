-- Private, persistent conversations; generated artifacts retain normal business access.
CREATE TABLE app.chat_conversations (
 id uuid PRIMARY KEY REFERENCES app.canvas_threads(id),
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 140),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 UNIQUE(organization_id,brand_id,id)
);
CREATE TABLE app.chat_turns (
 job_id uuid PRIMARY KEY REFERENCES app.planning_requests(job_id),
 organization_id uuid NOT NULL,
 brand_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth."user"(id),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
 action_result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,brand_id,conversation_id) REFERENCES app.chat_conversations(organization_id,brand_id,id)
);
CREATE INDEX chat_conversations_recent ON app.chat_conversations(organization_id,brand_id,actor_id,updated_at DESC);
CREATE INDEX chat_turns_conversation ON app.chat_turns(conversation_id,created_at);
ALTER TABLE app.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.chat_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_turns FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON app.chat_conversations,app.chat_turns TO desvio_app;
CREATE POLICY own_conversations ON app.chat_conversations TO desvio_app
 USING(actor_id=app.actor() AND app.can_access(organization_id,false) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false))
 WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
CREATE POLICY own_chat_turns ON app.chat_turns TO desvio_app
 USING(actor_id=app.actor() AND app.can_access(organization_id,false) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false))
 WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));

-- The exact unsent envelope survives reloads and ambiguous HTTP responses.
CREATE TABLE app.chat_outbox (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
 body jsonb NOT NULL CHECK(octet_length(body::text)<=20000),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id,actor_id),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.chat_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_outbox FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON app.chat_outbox TO desvio_app;
CREATE POLICY own_chat_outbox ON app.chat_outbox TO desvio_app
 USING(actor_id=app.actor() AND app.can_access(organization_id,false) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false))
 WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));

-- Only routing metadata crosses the background dispatcher boundary. The actual
-- action is re-read and authorized as its original actor under ordinary RLS.
CREATE TABLE delivery.chat_actions (
 job_id uuid PRIMARY KEY,organization_id uuid NOT NULL,brand_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES auth."user"(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),error_code text,
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
ALTER TABLE delivery.chat_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery.chat_actions FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA delivery TO desvio_worker;
GRANT INSERT,SELECT ON delivery.chat_actions TO desvio_worker;
CREATE POLICY enqueue_chat_action ON delivery.chat_actions TO desvio_worker
 USING(app.intake_scope(organization_id,brand_id,'plan.generate') AND job_id=app.job_context())
 WITH CHECK(app.intake_scope(organization_id,brand_id,'plan.generate') AND job_id=app.job_context() AND status='queued' AND attempts=0 AND EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.requested_by=actor_id));
GRANT SELECT,UPDATE ON delivery.chat_actions TO desvio_mail;
CREATE POLICY dispatch_chat_action ON delivery.chat_actions TO desvio_mail USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE(status,error_code) ON delivery.chat_actions TO desvio_app;
CREATE POLICY own_chat_action ON delivery.chat_actions TO desvio_app
 USING(actor_id=app.actor() AND app.can_access(organization_id,false) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,false))
 WITH CHECK(actor_id=app.actor() AND app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));

-- Defense in depth: legacy business-wide readers cannot reveal private chat input.
CREATE POLICY private_chat_threads ON app.canvas_threads AS RESTRICTIVE FOR SELECT TO desvio_app
 USING(request_key NOT LIKE 'chat:%' OR created_by=app.actor());
CREATE POLICY private_chat_planning ON app.planning_requests AS RESTRICTIVE FOR SELECT TO desvio_app
 USING(NOT(input ? 'chat') OR EXISTS(SELECT 1 FROM app.jobs j WHERE j.id=job_id AND j.requested_by=app.actor()));
CREATE POLICY private_chat_messages ON app.canvas_messages AS RESTRICTIVE FOR SELECT TO desvio_app
 USING(EXISTS(SELECT 1 FROM app.canvas_threads t WHERE t.id=thread_id));
