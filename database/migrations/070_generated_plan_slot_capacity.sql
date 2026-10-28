-- Match the planner's validated 90-post maximum, including daily images plus reels.
-- Keep the unique per-plan slot index and all tenant/worker policies intact.
ALTER TABLE app.content_slots DROP CONSTRAINT content_slots_strategy_slot_index_check;
ALTER TABLE app.content_slots ADD CONSTRAINT content_slots_strategy_slot_index_check
 CHECK(strategy_slot_index BETWEEN 0 AND 89);
