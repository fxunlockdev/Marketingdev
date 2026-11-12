-- Worker access to the knowledge graph, only inside a job of the same business.
-- Research and analysis jobs record findings; planning and generation jobs read context and record what they used.
-- A worker can never approve, reject, or touch reviewed knowledge: it writes 'suggested' rows that are not owner statements.
CREATE FUNCTION app.knowledge_scope(org uuid,brand uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT org=app.tenant() AND app.brand_matches(brand) AND EXISTS(SELECT 1 FROM app.jobs WHERE id=app.job_context() AND organization_id=org AND brand_id=brand
  AND kind IN ('website.extract','document.extract','brand.analyze','plan.generate','creative.generate','carousel.generate','creative.video','insight.generate'))
$$;
REVOKE ALL ON FUNCTION app.knowledge_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.knowledge_scope(uuid,uuid) TO desvio_worker;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['knowledge_nodes','knowledge_edges'] LOOP
  EXECUTE format('CREATE POLICY worker_read ON app.%I FOR SELECT TO desvio_worker USING(app.knowledge_scope(organization_id,brand_id))',tab);
  EXECUTE format('CREATE POLICY worker_suggest ON app.%I FOR INSERT TO desvio_worker WITH CHECK(app.knowledge_scope(organization_id,brand_id) AND status=''suggested'' AND origin<>''owner'')',tab);
  EXECUTE format('CREATE POLICY worker_refine ON app.%I FOR UPDATE TO desvio_worker USING(app.knowledge_scope(organization_id,brand_id) AND status=''suggested'' AND origin<>''owner'') WITH CHECK(app.knowledge_scope(organization_id,brand_id) AND status=''suggested'' AND origin<>''owner'')',tab);
 END LOOP;
END $$;
CREATE POLICY worker_read ON app.knowledge_evidence FOR SELECT TO desvio_worker USING(app.knowledge_scope(organization_id,brand_id));
CREATE POLICY worker_cite ON app.knowledge_evidence FOR INSERT TO desvio_worker WITH CHECK(app.knowledge_scope(organization_id,brand_id) AND (job_id IS NULL OR job_id=app.job_context()));
GRANT SELECT,INSERT ON app.knowledge_nodes,app.knowledge_edges,app.knowledge_evidence TO desvio_worker;
GRANT UPDATE(label,properties,origin,confidence,version,last_seen) ON app.knowledge_nodes TO desvio_worker;
GRANT UPDATE(properties,origin,confidence,last_seen) ON app.knowledge_edges TO desvio_worker;
