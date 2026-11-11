-- One adjustable account plan. Calendar months are UTC; preview jobs are excluded.
CREATE TABLE app.content_allowance_plans (
 organization_id uuid PRIMARY KEY REFERENCES app.organizations(id),
 static_limit integer NOT NULL DEFAULT 20 CHECK(static_limit>=0),
 carousel_limit integer NOT NULL DEFAULT 5 CHECK(carousel_limit>=0),
 video_limit integer NOT NULL DEFAULT 5 CHECK(video_limit>=0)
);
CREATE TABLE app.content_allowance_reservations (
 organization_id uuid NOT NULL REFERENCES app.organizations(id),
 kind text NOT NULL CHECK(kind IN ('static','carousel','video')),
 project_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES app.jobs(id),
 month_start date NOT NULL, PRIMARY KEY(organization_id,kind,project_id)
);
ALTER TABLE app.content_allowance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_allowance_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE app.content_allowance_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_allowance_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_operator ON app.content_allowance_plans TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY reservation_operator ON app.content_allowance_reservations TO CURRENT_USER USING(true) WITH CHECK(true);
REVOKE ALL ON app.content_allowance_plans,app.content_allowance_reservations FROM PUBLIC,desvio_app,desvio_worker;
CREATE FUNCTION app.reserve_content_allowance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE category text; cap integer; used integer; previous_status text; period date;
BEGIN
 IF TG_TABLE_NAME='creative_requests' THEN
  -- Deferred until all batch and mood board associations exist.
  IF EXISTS(SELECT 1 FROM app.carousel_children WHERE generation_job_id=NEW.job_id) OR
     EXISTS(SELECT 1 FROM app.guided_moodboards WHERE image_job_id=NEW.job_id) THEN RETURN NEW; END IF;
  category:='static';
 ELSIF TG_TABLE_NAME='carousel_requests' THEN
  IF EXISTS(SELECT 1 FROM app.guided_moodboards WHERE carousel_job_id=NEW.job_id) THEN RETURN NEW; END IF;
  category:='carousel';
 ELSE category:='video'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('content-allowance:'||NEW.organization_id::text,0));
 period:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
 SELECT j.status INTO previous_status FROM app.content_allowance_reservations r JOIN app.jobs j ON j.id=r.job_id
  WHERE r.organization_id=NEW.organization_id AND r.kind=category AND r.project_id=NEW.project_id;
 -- Edits and transport retries of the same content item never spend another item.
 IF previous_status IS NOT NULL AND previous_status NOT IN ('failed','rejected','canceled') THEN RETURN NEW; END IF;
 SELECT CASE category WHEN 'static' THEN static_limit WHEN 'carousel' THEN carousel_limit ELSE video_limit END INTO cap
  FROM app.content_allowance_plans WHERE organization_id=NEW.organization_id FOR SHARE;
 cap:=COALESCE(cap,CASE category WHEN 'static' THEN 20 ELSE 5 END);
 SELECT count(*) INTO used FROM app.content_allowance_reservations r JOIN app.jobs j ON j.id=r.job_id
  WHERE r.organization_id=NEW.organization_id AND r.kind=category AND r.month_start=period AND j.status NOT IN ('failed','rejected','canceled');
 IF used>=cap THEN RAISE EXCEPTION 'CONTENT_ALLOWANCE_EXHAUSTED:%',category USING ERRCODE='P0001'; END IF;
 INSERT INTO app.content_allowance_reservations(organization_id,kind,project_id,job_id,month_start)
 VALUES(NEW.organization_id,category,NEW.project_id,NEW.job_id,period)
 ON CONFLICT(organization_id,kind,project_id) DO UPDATE SET job_id=EXCLUDED.job_id,month_start=EXCLUDED.month_start;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.reserve_content_allowance() FROM PUBLIC,desvio_app,desvio_worker;
CREATE CONSTRAINT TRIGGER static_content_allowance AFTER INSERT ON app.creative_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.reserve_content_allowance();
CREATE CONSTRAINT TRIGGER carousel_content_allowance AFTER INSERT ON app.carousel_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.reserve_content_allowance();
CREATE CONSTRAINT TRIGGER video_content_allowance AFTER INSERT ON app.video_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.reserve_content_allowance();
CREATE FUNCTION app.content_allowances(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result jsonb;
BEGIN
 IF NOT app.can_access(target) THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='42501'; END IF;
 SELECT jsonb_object_agg(category,jsonb_build_object('limit',cap,'used',used,'remaining',greatest(0,cap-used))) INTO result FROM (
 SELECT category,CASE category WHEN 'static' THEN COALESCE(p.static_limit,20) WHEN 'carousel' THEN COALESCE(p.carousel_limit,5) ELSE COALESCE(p.video_limit,5) END AS cap,
 (SELECT count(*) FROM app.content_allowance_reservations r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=target AND r.kind=category AND r.month_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date AND j.status NOT IN ('failed','rejected','canceled')) AS used
 FROM unnest(ARRAY['static','carousel','video']) category LEFT JOIN app.content_allowance_plans p ON p.organization_id=target
 ) counts;
 RETURN jsonb_build_object('period',to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),'items',result);
END $$;
REVOKE ALL ON FUNCTION app.content_allowances(uuid) FROM PUBLIC,desvio_worker;
GRANT EXECUTE ON FUNCTION app.content_allowances(uuid) TO desvio_app;
