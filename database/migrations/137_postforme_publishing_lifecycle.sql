-- Publishing lifecycle on Post for Me: the provider's failure reason, retries after a confirmed failure,
-- cancellation before publishing, and status checks by the worker's timer (not only while a browser is open).
ALTER TABLE app.postforme_publications
 ADD COLUMN failure_reason text CHECK(length(failure_reason)<=500),
 ADD COLUMN retry_of uuid REFERENCES app.postforme_publications(id),
 ADD COLUMN canceled_at timestamptz;
-- A failure the provider confirmed frees the post for one retry; every other outcome (including an
-- uncertain submission) still holds it, so a post is never submitted twice.
DROP INDEX app.postforme_active_slot;
CREATE UNIQUE INDEX postforme_active_slot ON app.postforme_publications(brand_id,slot_id)
 WHERE phase NOT IN ('rejected','canceled') AND observed_state<>'failed';
CREATE UNIQUE INDEX postforme_one_retry ON app.postforme_publications(retry_of) WHERE retry_of IS NOT NULL;
CREATE OR REPLACE FUNCTION app.slot_has_publication(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.publication_requests WHERE slot_id=target AND phase NOT IN ('rejected','canceled'))
 OR EXISTS(SELECT 1 FROM app.postforme_publications WHERE slot_id=target AND phase NOT IN ('rejected','canceled') AND observed_state<>'failed')
$$;
-- The status check runs on the dispatcher role with no user. It sees only accepted or uncertain submissions of
-- active businesses, only the columns needed to identify the remote post, and can change only observed status.
GRANT SELECT(remote_id,last_checked_at,error_code,failure_reason) ON app.postforme_publications TO desvio_dispatcher;
GRANT UPDATE(phase,remote_id,observed_state,release_url,error_code,failure_reason,scheduled_at,last_checked_at) ON app.postforme_publications TO desvio_dispatcher;
CREATE POLICY status_sync_read ON app.postforme_publications FOR SELECT TO desvio_dispatcher
 USING(phase IN ('accepted','unknown') AND app.business_active(organization_id,brand_id));
CREATE POLICY status_sync_update ON app.postforme_publications FOR UPDATE TO desvio_dispatcher
 USING(phase IN ('accepted','unknown') AND observed_state IN ('unconfirmed','scheduled','processing') AND app.business_active(organization_id,brand_id))
 WITH CHECK(phase IN ('accepted','unknown'));
-- Posts on an account that was later disconnected still need their outcome observed.
CREATE POLICY status_sync_account ON app.postforme_accounts FOR SELECT TO desvio_dispatcher USING(app.business_active(organization_id,brand_id));
-- The worker can only record what the provider reported: a remote id, once known, never changes, and a failure carries its reason.
CREATE FUNCTION app.guard_status_sync() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF current_user='desvio_dispatcher' AND ((OLD.remote_id IS NOT NULL AND NEW.remote_id IS DISTINCT FROM OLD.remote_id)
  OR (NEW.observed_state='failed' AND NEW.failure_reason IS NULL) OR (NEW.observed_state IN ('published','failed') AND NEW.remote_id IS NULL)) THEN
  RAISE EXCEPTION 'Status checks record only provider-confirmed outcomes' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_status_sync() FROM PUBLIC;
CREATE TRIGGER guard_status_sync BEFORE UPDATE ON app.postforme_publications FOR EACH ROW EXECUTE FUNCTION app.guard_status_sync();
