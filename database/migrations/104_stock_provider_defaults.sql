-- Extend administrator-approved defaults to stock. No grants are enabled by this migration.
CREATE OR REPLACE FUNCTION app.inherit_provider_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy app.workspace_provider_defaults; grant_value jsonb; target_table text; payload jsonb;
BEGIN
 SELECT * INTO policy FROM app.workspace_provider_defaults WHERE organization_id=NEW.organization_id FOR SHARE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 FOR grant_value IN SELECT value FROM jsonb_array_elements(policy.grants) LOOP
  target_table:=CASE grant_value->>'kind'
   WHEN 'onboarding' THEN 'analysis_grants' WHEN 'creative' THEN 'creative_grants'
   WHEN 'gemini_creative' THEN 'gemini_creative_grants' WHEN 'planning' THEN 'planning_grants'
   WHEN 'stock' THEN 'stock_grants' WHEN 'insights' THEN 'insight_grants' WHEN 'video' THEN 'video_grants' ELSE NULL END;
  IF target_table IS NULL THEN RAISE EXCEPTION 'Unsupported workspace provider capability'; END IF;
  -- Expiry is absolute: creating another business never extends authorization.
  IF (grant_value->>'expires_at')::timestamptz<=now() THEN CONTINUE; END IF;
  payload:=jsonb_build_object('max_tokens_per_image',0)||grant_value||jsonb_build_object(
   'organization_id',NEW.organization_id,'brand_id',NEW.id,
   'approved_by',policy.operator_reference,'operator_reference',policy.operator_reference,'approved_at',now());
  EXECUTE format('INSERT INTO app.%I SELECT * FROM jsonb_populate_record(NULL::app.%I,$1)',target_table,target_table) USING payload;
 END LOOP;
 INSERT INTO app.business_provider_inheritance(organization_id,brand_id,change_id) VALUES(NEW.organization_id,NEW.id,policy.change_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.inherit_provider_defaults() FROM PUBLIC,desvio_app,desvio_worker,desvio_dispatcher,desvio_auth,desvio_mail,desvio_provisioner;
