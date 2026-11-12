-- Every customer decision is feedback: mood board and monthly plan decisions, change requests and retries too.
-- Mood boards and plans have no slot or creative version of their own, so a signal may name its subject instead.
ALTER TABLE app.creative_signals DROP CONSTRAINT creative_signals_kind_check;
ALTER TABLE app.creative_signals ADD CONSTRAINT creative_signals_kind_check
 CHECK(kind IN ('approved','rejected','changes_requested','edited','regenerated','retried','stock_swapped'));
ALTER TABLE app.creative_signals ADD COLUMN subject_kind text CHECK(subject_kind IN ('moodboard','plan')),ADD COLUMN subject_id uuid;
ALTER TABLE app.creative_signals ADD CONSTRAINT creative_signals_subject_check CHECK((subject_kind IS NULL)=(subject_id IS NULL));
ALTER TABLE app.creative_signals DROP CONSTRAINT creative_signals_check;
ALTER TABLE app.creative_signals ADD CONSTRAINT creative_signals_target_check
 CHECK(slot_id IS NOT NULL OR creative_version_id IS NOT NULL OR subject_id IS NOT NULL);
