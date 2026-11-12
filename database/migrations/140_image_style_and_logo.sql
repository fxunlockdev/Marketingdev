-- Image engine reads two more things while running an image generation job for the same business.
-- Read-only; the worker cannot write either table.

-- 1. The locked mood board's carousel cover is sent to the image model as a style reference.
--    Only the pages of a carousel that is the approved mood board of this business.
CREATE POLICY moodboard_cover_page ON app.carousel_pages FOR SELECT TO desvio_worker
 USING(app.creative_scope(organization_id,brand_id) AND EXISTS(
  SELECT 1 FROM app.guided_moodboards m
  WHERE m.organization_id=carousel_pages.organization_id AND m.brand_id=carousel_pages.brand_id
   AND m.carousel_version_id=carousel_pages.carousel_version_id AND m.approved_at IS NOT NULL));

-- 2. The approved logo is composited onto the finished creative, never redrawn by the model,
--    even when the request did not attach it. Only unrevoked references labelled as a logo.
CREATE POLICY approved_logo_reference ON app.brand_references FOR SELECT TO desvio_worker
 USING(app.creative_scope(organization_id,brand_id) AND revoked_at IS NULL AND label ~* '(\mlogo|\mwordmark)');
