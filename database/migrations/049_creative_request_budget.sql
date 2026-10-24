-- Optional immutable request-level ceiling, in addition to the business grant.
-- Customer/worker roles have no UPDATE privilege on this column.
ALTER TABLE app.creative_requests ADD COLUMN max_cost_micros bigint
 CHECK(max_cost_micros BETWEEN 1 AND 1000000000);
