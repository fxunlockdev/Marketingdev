-- Operator-assigned plans; payment collection is outside this release.
-- One account budget covers every brand and every provider reservation.
CREATE TABLE app.generation_plans (
 organization_id uuid PRIMARY KEY REFERENCES app.organizations(id),
 monthly_price_usd integer NOT NULL CHECK(monthly_price_usd IN (500,800,1000)),
 enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE app.monthly_generation_usage (
 organization_id uuid NOT NULL REFERENCES app.organizations(id),
 month_start date NOT NULL,
 reserved_micros bigint NOT NULL CHECK(reserved_micros>=0),
 PRIMARY KEY(organization_id,month_start)
);
REVOKE ALL ON app.generation_plans,app.monthly_generation_usage FROM PUBLIC,desvio_app,desvio_worker;
ALTER TABLE app.generation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.generation_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_plan_operator ON app.generation_plans TO CURRENT_USER USING(true) WITH CHECK(true);
ALTER TABLE app.monthly_generation_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.monthly_generation_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_usage_operator ON app.monthly_generation_usage TO CURRENT_USER USING(true) WITH CHECK(true);
-- Owned by the migration role, never a runtime role. No direct runtime access.
-- Reservations are deliberately not refunded on ambiguous or failed calls.
INSERT INTO app.monthly_generation_usage(organization_id,month_start,reserved_micros)
 SELECT organization_id,date_trunc('month',created_at AT TIME ZONE 'UTC')::date,sum(reserved_micros)
 FROM (
  SELECT organization_id,created_at,reserved_micros FROM app.analysis_calls
  UNION ALL SELECT organization_id,created_at,reserved_micros FROM app.creative_calls
  UNION ALL SELECT organization_id,created_at,reserved_micros FROM app.planning_calls
  UNION ALL SELECT organization_id,created_at,reserved_micros FROM app.video_reservations
 ) reservations GROUP BY 1,2;
CREATE FUNCTION app.reserve_monthly_generation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE cap bigint; used bigint; period date;
BEGIN
 -- AFTER INSERT runs only after the source table's RLS and constraints pass.
 -- The source's unique key prevents charging an idempotent replay twice.
 period:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
 SELECT CASE WHEN enabled THEN monthly_price_usd::bigint*200000 ELSE 0 END INTO cap FROM app.generation_plans
  WHERE organization_id=NEW.organization_id FOR SHARE;
 INSERT INTO app.monthly_generation_usage(organization_id,month_start,reserved_micros)
  VALUES(NEW.organization_id,period,NEW.reserved_micros)
  ON CONFLICT(organization_id,month_start) DO UPDATE
  SET reserved_micros=app.monthly_generation_usage.reserved_micros+EXCLUDED.reserved_micros
  RETURNING reserved_micros INTO used;
 IF cap IS NOT NULL AND used>cap THEN
  RAISE EXCEPTION 'MONTHLY_GENERATION_BUDGET_EXHAUSTED' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.reserve_monthly_generation() FROM PUBLIC,desvio_app,desvio_worker;
CREATE TRIGGER monthly_analysis_reservation AFTER INSERT ON app.analysis_calls FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
CREATE TRIGGER monthly_creative_reservation AFTER INSERT ON app.creative_calls FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
CREATE TRIGGER monthly_planning_reservation AFTER INSERT ON app.planning_calls FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
CREATE TRIGGER monthly_video_reservation AFTER INSERT ON app.video_reservations FOR EACH ROW EXECUTE FUNCTION app.reserve_monthly_generation();
