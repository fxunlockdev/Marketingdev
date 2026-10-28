-- Extend content provenance and approval to Facebook Page feed posts.
ALTER TABLE app.content_slots DROP CONSTRAINT content_slots_channel_check;
ALTER TABLE app.content_slots ADD CONSTRAINT content_slots_channel_check CHECK(channel IN ('linkedin','instagram','facebook'));
ALTER TABLE app.creative_requests DROP CONSTRAINT creative_requests_channel_check;
ALTER TABLE app.creative_requests ADD CONSTRAINT creative_requests_channel_check CHECK(channel IN ('linkedin','instagram','facebook'));
ALTER TABLE app.video_requests DROP CONSTRAINT video_requests_channel_check;
ALTER TABLE app.video_requests ADD CONSTRAINT video_requests_channel_check CHECK(channel IN ('linkedin','instagram','facebook'));
ALTER TABLE app.carousel_versions DROP CONSTRAINT carousel_versions_channel_check;
ALTER TABLE app.carousel_versions ADD CONSTRAINT carousel_versions_channel_check CHECK(channel IN ('linkedin','instagram','facebook'));
ALTER TABLE app.publication_requests DROP CONSTRAINT publication_requests_provider_check;
ALTER TABLE app.publication_requests ADD CONSTRAINT publication_requests_provider_check CHECK(provider IN ('linkedin','instagram-standalone','facebook'));
ALTER TABLE app.publication_requests DROP CONSTRAINT instagram_media_kind;
ALTER TABLE app.publication_requests ADD CONSTRAINT instagram_media_kind CHECK(provider<>'instagram-standalone' OR carousel_version_id IS NULL);
