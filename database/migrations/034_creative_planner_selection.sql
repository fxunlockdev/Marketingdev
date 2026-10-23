-- OpenAI's existing creative grant continues to fund OpenAI text + image calls.
-- Gemini creative planning has an independent allowance, not a calendar grant.
CREATE TABLE app.gemini_creative_grants (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 text_model text NOT NULL CHECK(text_model ~ '^gemini-[a-zA-Z0-9._-]{1,90}$'),
 expires_at timestamptz NOT NULL,budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000),
 input_micros_per_token numeric NOT NULL CHECK(input_micros_per_token>0 AND input_micros_per_token<=1000),
 output_micros_per_token numeric NOT NULL CHECK(output_micros_per_token>0 AND output_micros_per_token<=1000),
 approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id),FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id)
);
ALTER TABLE app.gemini_creative_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gemini_creative_grants FORCE ROW LEVEL SECURITY;
GRANT SELECT ON app.gemini_creative_grants TO desvio_app,desvio_worker;
CREATE POLICY customer_read ON app.gemini_creative_grants FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY worker_read ON app.gemini_creative_grants FOR SELECT TO desvio_worker USING(app.creative_scope(organization_id,brand_id) OR app.video_scope(organization_id,brand_id));
ALTER TABLE app.creative_requests ADD COLUMN text_provider text NOT NULL DEFAULT 'openai' CHECK(text_provider IN ('openai','gemini')), ADD COLUMN selected_text_model text CHECK(length(selected_text_model) BETWEEN 1 AND 100);
ALTER TABLE app.video_requests ADD COLUMN text_provider text NOT NULL DEFAULT 'openai' CHECK(text_provider IN ('openai','gemini')), ADD COLUMN selected_text_model text CHECK(length(selected_text_model) BETWEEN 1 AND 100);
UPDATE app.creative_requests r SET selected_text_model=g.text_model FROM app.creative_grants g WHERE g.organization_id=r.organization_id AND g.brand_id=r.brand_id;
UPDATE app.video_requests r SET selected_text_model=g.text_model FROM app.creative_grants g WHERE g.organization_id=r.organization_id AND g.brand_id=r.brand_id;
ALTER TABLE app.creative_calls ADD COLUMN provider text NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai','gemini'));
ALTER TABLE app.creative_calls ADD CHECK(step<>'image' OR provider='openai');
-- API submission snapshots only the active approved model; grants remain operator-owned.
GRANT SELECT (organization_id,brand_id,enabled,expires_at,text_model) ON app.creative_grants TO desvio_app;
