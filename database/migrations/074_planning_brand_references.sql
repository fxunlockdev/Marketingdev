-- A planning job may read approved photo metadata only within its job's brand.
-- These SELECT policies do not authorize approving references or modifying media.
CREATE POLICY planning_brand_reference ON app.brand_references FOR SELECT TO desvio_worker
 USING(app.planning_scope(organization_id,brand_id) AND revoked_at IS NULL);
CREATE POLICY planning_reference_website ON app.website_visuals FOR SELECT TO desvio_worker
 USING(app.planning_scope(organization_id,brand_id) AND EXISTS(
 SELECT 1 FROM app.brand_references r WHERE r.website_visual_id=website_visuals.id AND r.revoked_at IS NULL));
CREATE POLICY planning_reference_document ON app.document_visuals FOR SELECT TO desvio_worker
 USING(app.planning_scope(organization_id,brand_id) AND EXISTS(
 SELECT 1 FROM app.brand_references r WHERE r.document_visual_id=document_visuals.id AND r.revoked_at IS NULL));
CREATE POLICY planning_reference_upload ON app.uploaded_visuals FOR SELECT TO desvio_worker
 USING(app.planning_scope(organization_id,brand_id) AND EXISTS(
 SELECT 1 FROM app.brand_references r WHERE r.uploaded_visual_id=uploaded_visuals.id AND r.revoked_at IS NULL));
