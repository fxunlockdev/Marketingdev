-- Persist the customer's approved image choices with a planned post.
-- Existing content-slot RLS and revision locking cover this field; API writes
-- additionally verify that every reference belongs to this brand and is active.
ALTER TABLE app.content_slots ADD COLUMN reference_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE app.content_slots ADD CONSTRAINT content_slot_reference_count
 CHECK (cardinality(reference_ids) <= 3 AND array_position(reference_ids,NULL) IS NULL);
-- Preserve the existing least-privilege column grants. Workers consume the
-- selected references but cannot change the customer's selection.
GRANT UPDATE(reference_ids) ON app.content_slots TO desvio_app;
