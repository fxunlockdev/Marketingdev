-- Retain the destination provider on the immutable publication request.
ALTER TABLE app.publication_requests ADD COLUMN provider text NOT NULL DEFAULT 'linkedin'
 CHECK(provider IN ('linkedin','instagram-standalone'));
ALTER TABLE app.publication_requests ADD CHECK(provider='linkedin' OR (video_version_id IS NOT NULL AND export_id IS NULL AND carousel_version_id IS NULL));
GRANT SELECT(provider),INSERT(provider) ON app.publication_requests TO desvio_app;
CREATE POLICY publication_provider ON app.publication_requests AS RESTRICTIVE FOR INSERT TO desvio_app WITH CHECK(
 EXISTS(SELECT 1 FROM app.social_channels c WHERE c.id=channel_id AND c.organization_id=publication_requests.organization_id AND c.brand_id=publication_requests.brand_id AND c.provider=publication_requests.provider)
);
