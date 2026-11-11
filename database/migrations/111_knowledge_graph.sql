-- Per-business knowledge graph. Postgres is the store of record; every row is tenant and business scoped.
-- Web-derived knowledge enters as 'suggested'. Only a reviewer of the business can approve or reject it.
CREATE TABLE app.knowledge_nodes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('business','offer','audience','persona','pain','angle','proof_point','competitor','pillar','format','visual_direction','voice','positioning','rule','brand_element','asset','post','result','lesson')),
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 120 AND key=lower(key) AND key !~ '\s'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 300),
 properties jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(properties)='object' AND octet_length(properties::text)<=8192),
 status text NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','approved','rejected')),
 origin text NOT NULL CHECK(origin IN ('extracted','inferred','owner')),
 confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
 superseded_by uuid,
 reviewed_by uuid REFERENCES auth."user"(id), reviewed_at timestamptz,
 UNIQUE(organization_id,brand_id,id), UNIQUE(organization_id,brand_id,type,key),
 FOREIGN KEY(organization_id,brand_id) REFERENCES app.brands(organization_id,id),
 FOREIGN KEY(organization_id,brand_id,superseded_by) REFERENCES app.knowledge_nodes(organization_id,brand_id,id),
 CHECK(superseded_by IS NULL OR superseded_by<>id), CHECK(last_seen>=first_seen),
 CHECK((status='suggested' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'suggested' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX knowledge_nodes_pack ON app.knowledge_nodes(organization_id,brand_id,status,confidence DESC,last_seen DESC,id) WHERE superseded_by IS NULL;

CREATE TABLE app.knowledge_edges (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 from_node uuid NOT NULL, to_node uuid NOT NULL,
 relation text NOT NULL CHECK(relation IN ('offers','targets','belongs_to','has_pain','solves','differentiates_from','proves','expresses','constrains','used_in','performed','learned_from','contradicts','supersedes','related_to')),
 properties jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(properties)='object' AND octet_length(properties::text)<=4096),
 status text NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','approved','rejected')),
 origin text NOT NULL CHECK(origin IN ('extracted','inferred','owner')),
 confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES auth."user"(id), reviewed_at timestamptz,
 UNIQUE(organization_id,brand_id,id), UNIQUE(organization_id,brand_id,from_node,to_node,relation),
 FOREIGN KEY(organization_id,brand_id,from_node) REFERENCES app.knowledge_nodes(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,to_node) REFERENCES app.knowledge_nodes(organization_id,brand_id,id),
 CHECK(from_node<>to_node), CHECK(last_seen>=first_seen),
 CHECK((status='suggested' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'suggested' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX knowledge_edges_to ON app.knowledge_edges(organization_id,brand_id,to_node);
CREATE INDEX knowledge_edges_ledger ON app.knowledge_edges(organization_id,brand_id,relation,first_seen DESC);

-- Where a node or relationship came from: a stored source, a public page, or the job that produced it.
CREATE TABLE app.knowledge_evidence (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, brand_id uuid NOT NULL,
 node_id uuid, edge_id uuid, source_id uuid, source_url text CHECK(length(source_url)<=2048 AND source_url ~ '^https?://'), job_id uuid,
 excerpt text NOT NULL DEFAULT '' CHECK(length(excerpt)<=1000),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,brand_id,fingerprint),
 CHECK(num_nonnulls(node_id,edge_id)=1), CHECK(num_nonnulls(source_id,source_url,job_id)>=1),
 FOREIGN KEY(organization_id,brand_id,node_id) REFERENCES app.knowledge_nodes(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,edge_id) REFERENCES app.knowledge_edges(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,source_id) REFERENCES app.brand_sources(organization_id,brand_id,id),
 FOREIGN KEY(organization_id,brand_id,job_id) REFERENCES app.jobs(organization_id,brand_id,id)
);
CREATE INDEX knowledge_evidence_node ON app.knowledge_evidence(organization_id,brand_id,node_id) WHERE node_id IS NOT NULL;
CREATE INDEX knowledge_evidence_edge ON app.knowledge_evidence(organization_id,brand_id,edge_id) WHERE edge_id IS NOT NULL;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['knowledge_nodes','knowledge_edges','knowledge_evidence'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY knowledge_read ON app.%I FOR SELECT TO desvio_app USING(app.can_access(organization_id) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id))',tab);
  EXECUTE format('CREATE POLICY knowledge_operator ON app.%I TO CURRENT_USER USING(true) WITH CHECK(true)',tab);
 END LOOP;
 -- Editors may add and refine suggestions. Anything other than 'suggested' needs a reviewer, recorded as the actor.
 FOREACH tab IN ARRAY ARRAY['knowledge_nodes','knowledge_edges'] LOOP
  EXECUTE format('CREATE POLICY knowledge_suggest ON app.%I FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND (status=''suggested'' OR (app.creative_reviewer(organization_id,brand_id) AND reviewed_by=app.actor())))',tab);
  EXECUTE format('CREATE POLICY knowledge_refine ON app.%I FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND status=''suggested'') WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true) AND status=''suggested'')',tab);
  EXECUTE format('CREATE POLICY knowledge_review ON app.%I FOR UPDATE TO desvio_app USING(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.creative_reviewer(organization_id,brand_id)) WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.creative_reviewer(organization_id,brand_id) AND (status=''suggested'' OR reviewed_by=app.actor()))',tab);
 END LOOP;
END $$;
CREATE POLICY knowledge_cite ON app.knowledge_evidence FOR INSERT TO desvio_app WITH CHECK(app.can_access(organization_id,true) AND app.brand_matches(brand_id) AND app.business_access(organization_id,brand_id,true));
GRANT SELECT,INSERT ON app.knowledge_nodes,app.knowledge_edges,app.knowledge_evidence TO desvio_app;
GRANT UPDATE(label,properties,status,origin,confidence,version,last_seen,superseded_by,reviewed_by,reviewed_at) ON app.knowledge_nodes TO desvio_app;
GRANT UPDATE(properties,status,origin,confidence,last_seen,reviewed_by,reviewed_at) ON app.knowledge_edges TO desvio_app;
