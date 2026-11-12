-- Every planned post carries a storyline the customer reads and edits before generation.
-- strategy_ref names the persona, pain and angle of the approved brand strategy it serves.
-- Both are optional so plans saved before this migration stay valid.
ALTER TABLE app.content_slots ADD COLUMN storyline jsonb,
 ADD CHECK(storyline IS NULL OR jsonb_typeof(storyline)='object' AND octet_length(storyline::text)<=16000),
 ADD COLUMN strategy_ref jsonb,
 ADD CHECK(strategy_ref IS NULL OR jsonb_typeof(strategy_ref)='object' AND octet_length(strategy_ref::text)<=400);
GRANT UPDATE(storyline) ON app.content_slots TO desvio_app;
