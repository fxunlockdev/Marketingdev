-- The knowledge context pack a creative or insight job was given, stored on its first attempt so every
-- retry sends the planner the same input (recorded calls are matched by hash). Bounded; written only by
-- the worker for its own running job, through the existing worker policies on these tables.
ALTER TABLE app.creative_requests ADD COLUMN knowledge_context jsonb
 CHECK (knowledge_context IS NULL OR (jsonb_typeof(knowledge_context)='object' AND octet_length(knowledge_context::text)<=65536));
GRANT UPDATE(knowledge_context) ON app.creative_requests TO desvio_worker;
ALTER TABLE app.insight_requests ADD COLUMN knowledge_context jsonb
 CHECK (knowledge_context IS NULL OR (jsonb_typeof(knowledge_context)='object' AND octet_length(knowledge_context::text)<=65536));
GRANT UPDATE(knowledge_context) ON app.insight_requests TO desvio_worker;
