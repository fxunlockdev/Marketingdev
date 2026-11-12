-- Variants: two or three alternatives made from one brief in the Create canvas. Each alternative is its own
-- creative project in the same conversation, grouped under the project it was made from, so the owner can
-- compare them and keep one. Same tenant row, same row-level security as the project itself.
ALTER TABLE app.creative_projects ADD COLUMN variant_of uuid REFERENCES app.creative_projects(id);
ALTER TABLE app.creative_projects ADD CONSTRAINT creative_projects_variant_not_self CHECK(variant_of IS DISTINCT FROM id);
CREATE INDEX creative_projects_variants ON app.creative_projects(variant_of) WHERE variant_of IS NOT NULL;
