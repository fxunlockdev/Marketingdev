-- Stock provenance remains separate from approved brand facts and image consent.
CREATE TABLE app.stock_imports (
 organization_id uuid NOT NULL,brand_id uuid NOT NULL,asset_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
 provider text NOT NULL CHECK(provider='pexels'),photo_id bigint NOT NULL CHECK(photo_id>0),
 attribution jsonb NOT NULL CHECK(jsonb_typeof(attribution)='object' AND octet_length(attribution::text)<4000),
 created_by uuid NOT NULL REFERENCES auth."user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,brand_id,request_key),
 FOREIGN KEY(organization_id,brand_id,asset_id) REFERENCES app.assets(organization_id,brand_id,id)
);
ALTER TABLE app.stock_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stock_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_import_read ON app.stock_imports FOR SELECT TO desvio_app
 USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id));
CREATE POLICY stock_import_insert ON app.stock_imports FOR INSERT TO desvio_app
 WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND created_by=app.actor());
GRANT SELECT,INSERT ON app.stock_imports TO desvio_app;
