-- Provenance for the knowledge-graph context pack a plan request was given: the graph nodes that reached the
-- planner. Written once by the API with the request; read by the planning worker. Not part of the prompt.
ALTER TABLE app.planning_requests ADD COLUMN used_node_ids uuid[] NOT NULL DEFAULT '{}'
 CHECK (cardinality(used_node_ids)<=600);
