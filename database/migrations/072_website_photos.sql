-- Photos remain distinguishable from viewport screenshots and owner-approved references.
ALTER TABLE app.website_visuals DROP CONSTRAINT website_visuals_viewport_check;
ALTER TABLE app.website_visuals ADD CONSTRAINT website_visuals_viewport_check CHECK(viewport IN ('desktop','mobile','visible','fullpage','photo'));
ALTER TABLE app.website_visuals DROP CONSTRAINT website_visuals_source_id_viewport_parser_version_key;
CREATE UNIQUE INDEX website_capture_unique ON app.website_visuals(source_id,viewport,parser_version) WHERE viewport<>'photo';
CREATE UNIQUE INDEX website_photo_unique ON app.website_visuals(source_id,sha256) WHERE viewport='photo';
