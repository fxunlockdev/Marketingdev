-- Audited standalone Instagram is single-step; Facebook/page selectors remain separate.
ALTER TABLE app.social_authorizations DROP CONSTRAINT social_authorizations_provider_check;
ALTER TABLE app.social_authorizations ADD CONSTRAINT social_authorizations_provider_check CHECK(provider IN ('linkedin','instagram-standalone'));
-- Reconnect remains bound to the stored provider as well as both account identities.
DROP POLICY reconnect_target ON app.social_authorizations;
CREATE POLICY reconnect_target ON app.social_authorizations AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(
 target_remote_id IS NULL OR EXISTS(SELECT 1 FROM app.social_channels c
 WHERE c.organization_id=social_authorizations.organization_id
 AND c.brand_id=social_authorizations.brand_id AND c.remote_id=target_remote_id
 AND c.internal_id=target_internal_id AND c.provider=social_authorizations.provider
 AND c.account_revision=social_authorizations.account_revision)
);
