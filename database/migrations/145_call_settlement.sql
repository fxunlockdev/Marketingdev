-- Settle text calls at their reported cost.
-- Every paid call reserves a worst-case amount before it is sent, and nothing lowered that
-- reservation afterwards, so budgets ran out at several times the real spend. After a call
-- succeeds and the provider reports its token usage, the worker records the actual cost in
-- settled_micros. Budgets count COALESCE(settled_micros,reserved_micros): a call without a
-- usage report (submitted, unknown, rejected, image calls) keeps its full reservation.
-- reserved_micros is never changed; it stays the safety bound written before the call.
ALTER TABLE app.creative_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT creative_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));
ALTER TABLE app.planning_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT planning_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));
ALTER TABLE app.analysis_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT analysis_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));
ALTER TABLE app.insight_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT insight_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));
ALTER TABLE app.market_research_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT market_research_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));
ALTER TABLE app.knowledge_extraction_calls ADD COLUMN settled_micros bigint,
 ADD CONSTRAINT knowledge_extraction_calls_settled_check CHECK(settled_micros IS NULL OR (settled_micros>=0 AND settled_micros<=reserved_micros));

-- A row is inserted unsettled and settled at most once, only when it has succeeded.
CREATE FUNCTION app.settle_call_once() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.settled_micros IS NOT NULL THEN RAISE EXCEPTION 'CALL_SETTLEMENT_REQUIRES_SUCCESS' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.settled_micros IS NOT NULL AND NEW.settled_micros IS DISTINCT FROM OLD.settled_micros THEN
  RAISE EXCEPTION 'CALL_ALREADY_SETTLED' USING ERRCODE='23514';
 END IF;
 IF OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL AND NEW.status<>'succeeded' THEN
  RAISE EXCEPTION 'CALL_SETTLEMENT_REQUIRES_SUCCESS' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.settle_call_once() FROM PUBLIC,desvio_app,desvio_worker;
CREATE TRIGGER creative_call_settle_once BEFORE INSERT OR UPDATE ON app.creative_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();
CREATE TRIGGER planning_call_settle_once BEFORE INSERT OR UPDATE ON app.planning_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();
CREATE TRIGGER analysis_call_settle_once BEFORE INSERT OR UPDATE ON app.analysis_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();
CREATE TRIGGER insight_call_settle_once BEFORE INSERT OR UPDATE ON app.insight_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();
CREATE TRIGGER market_research_call_settle_once BEFORE INSERT OR UPDATE ON app.market_research_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();
CREATE TRIGGER knowledge_extraction_call_settle_once BEFORE INSERT OR UPDATE ON app.knowledge_extraction_calls FOR EACH ROW EXECUTE FUNCTION app.settle_call_once();

-- The shared monthly budget (068) is a running counter charged by app.reserve_monthly_generation()
-- when a reservation is inserted; it never summed the ledgers. Settling returns the unused part of
-- the reservation to the month that was charged. That function is left as it was: it also serves
-- app.video_reservations, which has its own held/released lifecycle and no settlement.
-- The counter is charged at insert time, in the month of the insert; created_at is set by the
-- same insert, so the release goes to the same month. It never drops below zero.
CREATE FUNCTION app.settle_monthly_generation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.monthly_generation_usage
  SET reserved_micros=GREATEST(0,reserved_micros-(NEW.reserved_micros-NEW.settled_micros))
  WHERE organization_id=NEW.organization_id AND month_start=date_trunc('month',NEW.created_at AT TIME ZONE 'UTC')::date;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.settle_monthly_generation() FROM PUBLIC,desvio_app,desvio_worker;
CREATE TRIGGER monthly_creative_settlement AFTER UPDATE OF settled_micros ON app.creative_calls FOR EACH ROW
 WHEN (OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL) EXECUTE FUNCTION app.settle_monthly_generation();
CREATE TRIGGER monthly_planning_settlement AFTER UPDATE OF settled_micros ON app.planning_calls FOR EACH ROW
 WHEN (OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL) EXECUTE FUNCTION app.settle_monthly_generation();
CREATE TRIGGER monthly_analysis_settlement AFTER UPDATE OF settled_micros ON app.analysis_calls FOR EACH ROW
 WHEN (OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL) EXECUTE FUNCTION app.settle_monthly_generation();
CREATE TRIGGER monthly_market_research_settlement AFTER UPDATE OF settled_micros ON app.market_research_calls FOR EACH ROW
 WHEN (OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL) EXECUTE FUNCTION app.settle_monthly_generation();
CREATE TRIGGER monthly_knowledge_extraction_settlement AFTER UPDATE OF settled_micros ON app.knowledge_extraction_calls FOR EACH ROW
 WHEN (OLD.settled_micros IS NULL AND NEW.settled_micros IS NOT NULL) EXECUTE FUNCTION app.settle_monthly_generation();
-- insight_calls was never part of the monthly budget (068), so it has no monthly settlement.

-- The worker writes the settlement, under the existing row-level update policies of each ledger.
GRANT UPDATE(settled_micros) ON app.creative_calls,app.planning_calls,app.analysis_calls,app.insight_calls,app.market_research_calls,app.knowledge_extraction_calls TO desvio_worker;
-- The application reads planning_calls column by column (085) for the shared planning credit.
GRANT SELECT(settled_micros) ON app.planning_calls TO desvio_app;
