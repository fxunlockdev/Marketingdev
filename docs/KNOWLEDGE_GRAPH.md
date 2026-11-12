# Knowledge graph

Each business has a private graph of what Desvio knows about it: the business, its offers, audiences, personas, pains, angles, proof points, competitors, pillars, visual directions, assets, posts, results and lessons, and how they connect. Planners and generators receive a relevant slice (a "context pack") instead of the flat fact list in `brand_brain_versions.snapshot.facts`.

Decision record: `docs/adr/0053-knowledge-graph.md`.

## What exists

| Part | File | State |
|---|---|---|
| Tables, RLS, grants | `database/migrations/111_knowledge_graph.sql`, `112_knowledge_worker_access.sql` | Tested on disposable Postgres |
| Repository and merge rules | `apps/api/src/knowledge-graph.ts` | Unit and database tested |
| Extraction contract, request builder, brand-profile importer | `apps/api/src/knowledge-extract.ts` | Unit tested; model request mock-tested only |
| Context packs | `apps/api/src/knowledge-context.ts` | Unit and database tested |
| Graphify importer | `apps/api/src/knowledge-graphify-import.ts` | Unit tested against captured output |

Nothing in the running product calls these yet. See "Wiring still needed".

## Data model

- **Node**: `type`, `key`, `label`, bounded `properties`, `status` (`suggested`, `approved`, `rejected`), `origin` (`extracted`, `inferred`, `owner`), `confidence` 0–1, `version`, `first_seen`, `last_seen`, `superseded_by`, reviewer and review time. Unique per (organisation, business, type, key).
- **Edge**: `from_node`, `to_node`, `relation`, plus the same status, origin, confidence and review fields. Unique per (from, to, relation).
- **Evidence**: points at one node or one edge, and at a stored source (`brand_sources`), a URL, or the job that produced it, with a short excerpt. The same reference is stored once.

Node types: business, offer, audience, persona, pain, angle, proof_point, competitor, pillar, format, visual_direction, voice, positioning, rule, brand_element, asset, post, result, lesson.

Relations: offers, targets, belongs_to, has_pain, solves, differentiates_from, proves, expresses, constrains, used_in, performed, learned_from, contradicts, supersedes, related_to.

## Rules

1. Anything read from the web or inferred by a model is stored as `suggested`. Only a reviewer of the business can approve or reject. The database enforces this for the worker role; the extraction validator enforces it on model output.
2. Reviewed knowledge is never overwritten by a suggestion. A differing suggestion is reported as a conflict to the caller, and its evidence is still attached.
3. A quote outranks a guess: an `inferred` finding does not rewrite an `extracted` one.
4. `version` counts content changes. Seeing the same thing again only moves `last_seen`.
5. A rejected node stays rejected, and edges to it are not recorded.
6. A superseded node keeps its row and gains a `supersedes` edge, but leaves context packs and graph walks.

## Who can do what

| Role | Read | Write |
|---|---|---|
| Viewer | Own business | Nothing |
| Editor | Own business | Add and refine suggestions, attach evidence |
| Owner or admin (reviewer) | Own business | Also approve, reject, correct, supersede |
| Worker | Only inside a job of that business, of kind website.extract, document.extract, brand.analyze, plan.generate, creative.generate, carousel.generate, creative.video or insight.generate | Suggestions only; evidence may cite only the running job |

No role can delete.

## Filling the graph

**Existing businesses, no model call.** `fromBrandBrainSnapshot(snapshot)` maps approved facts to approved nodes (brand_name → business, offering and products → offer, audience, voice, positioning, prohibited_claims → rule, colours, fonts and CTA → brand_element, each `visual_direction_*` → visual_direction) and the obvious edges between them. It must be applied by a reviewer, because the result is approved. Running it twice changes nothing.

**Research and analysis.** `extractionRequest()` builds a request for the `check` model (or `brief`) with a strict JSON schema. `validateExtraction()` refuses unknown types, dangling references, oversize payloads, extra fields and any attempt to state a status. An "extracted" item whose quote is not found in the supplied source is downgraded to a low-confidence guess. Posts, results, assets and lessons cannot be created this way; they come from production records.

**Production records.** A generation job records a post node and `used_in` edges from the angle, format, pillar, asset or visual direction it used. These feed the ledger.

## Context packs

`buildContextPack(db, scope, {kind, input, budgetBytes?})` for kinds `plan`, `creative`, `carousel`, `video`, `insights` returns:

- `items`: approved rules first, then approved knowledge, then suggestions with confidence of at least 0.6 marked `unproven`. Within each group, ordered by a fixed weight per task and type plus word overlap with the task input. Each item lists its relations to other items in the pack.
- `ledger`: what posts in the last 45 days were built from, with use counts, so the next plan varies.
- `used_node_ids`, `used_edge_ids`: provenance for the run record.
- `bytes`, `budget_bytes`, `truncated`: the notice, items and ledger never exceed the budget (default 6,000 bytes).

Ranking is lexical and deterministic: the same graph and task give the same pack. There is no embeddings dependency. Its limit is that it matches words, not meaning, so "cheap" will not find "affordable".

## Graphify evaluation

Tested on 12 Nov 2026: `graphifyy` 0.9.106 from PyPI in a throwaway virtual environment, run with an empty environment (no API keys, private HOME) on Markdown notes about an invented dog-grooming business. No model or API call was made.

### What it produces for Markdown without a model

`graphify update <dir>` ran without a key and wrote `graph.json`, `graph.html` and `GRAPH_REPORT.md`.

- Nodes: one per file ("page") and one per Markdown heading. Nothing else.
- Edges: `contains` (page → heading → sub-heading) and `references` (page → page, from Markdown links). All tagged `EXTRACTED`, score 1.0.
- Not captured: paragraph text, bullet lists, bold terms, and the JSON file in the corpus (counted as one "code" file, zero nodes). One of the Markdown links, inside a deep heading, produced no edge.
- Communities: present, with names taken from a heading or file name. Naming them properly is a model step.
- The report states "100% EXTRACTED, 0% INFERRED".

In a free-form corpus of five files this gave 19 nodes and 20 edges, all of them document outline. It did not find one offer, pain or competitor relationship, although the text stated several.

`graphify extract <dir>` (the full pass) stopped with "no LLM API key found (4 doc/paper/image file(s) need semantic extraction)".

### Output format

NetworkX node-link JSON: top-level `directed`, `multigraph`, `graph`, `nodes`, `links`, `hyperedges`.

- Node: `id`, `label`, `file_type`, `node_kind` (page or heading), `source_file`, `source_location` (line), `community`, `community_name`.
- Link: `source`, `target`, `relation`, `confidence` (EXTRACTED, INFERRED, AMBIGUOUS), `confidence_score`, `source_file`, `source_location`, `weight`.

### Runtime

| Corpus | Result | Wall time |
|---|---|---|
| 5 files, about 360 words | 19 nodes, 20 edges, 5 communities | about 2.3 s first run, 1.0 s later |
| 300 generated Markdown files | 4,200 nodes, 5,700 edges, 317 communities | about 3.9 s |

Two runs over the same corpus gave identical `graph.json`. Install took about 2 s and pulled in networkx, numpy, rapidfuzz, pyyaml and about 40 tree-sitter grammar packages.

### What the model pass would add (read from the package source, not run)

Its extraction prompt asks for nodes of kind code, document, paper, image, rationale or concept, and relations calls, implements, references, cites, conceptually_related_to, shares_data_with or semantically_similar_to, each tagged EXTRACTED, INFERRED or AMBIGUOUS. That vocabulary is built for codebases. It supports Gemini, Kimi, Claude, OpenAI, DeepSeek and Ollama backends through its own key handling.

### Mapping into our tables

Feasible, with a convention. `fromGraphify(graphJson, {jobId, sources})`:

- A heading named "Type: Label" becomes a node of that type; the key is the normalised label, so the same entity in two files merges and cites both.
- Nesting implies the relation: a pain under a persona is `has_pain`, an angle under a pain is `solves`, a competitor under the business is `differentiates_from`, and so on. Unlisted pairs become `related_to`. Untyped headings in between are skipped over.
- Model-pass edges between two entities become `related_to`, keeping Graphify's relation name as a property. EXTRACTED keeps its score, INFERRED is capped at 0.7, AMBIGUOUS at 0.3.
- Everything is `suggested`. Pages, untyped headings and page-level links are not imported. Communities are returned in the import report but not stored.

On the captured sample (two files, 21 Graphify nodes, 20 links) this gives 15 nodes and 12 edges.

The catch: to write "Type: Label" headings we must already know the entities and their types. In that mode Graphify hands back what we gave it, plus clusters.

### Recommendation

Use our own extraction step as the builder. Do not put Graphify on the critical path.

Consider Graphify later, in a sandbox job, for one thing our step does not do: clustering a large corpus into communities and proposing cross-document links for the owner to review. The importer is ready for that, and its output can only ever be suggestions.

### Not verified

- Graphify's model pass on marketing text: quality, cost, run time and whether its output is useful after mapping. No key was used.
- Images, PDFs and other non-Markdown inputs.
- Behaviour inside the worker's sandbox container (network-off, read-only file system, non-root).
- Incremental rebuilds over a changing corpus, beyond one identical re-run.
- Corpora larger than 300 small files.
- Our own extraction request against a live model. The schema uses length and range limits inside a strict JSON schema; whether the provider accepts every one of them is unconfirmed until a live call.

### Reproducing the sample

In a scratch directory outside version control: create a virtual environment, `uv pip install graphifyy`, write Markdown notes with "Type: Label" headings, and run `graphify update <dir>` with no API keys in the environment. The sample embedded in `tests/contracts/knowledge-graphify-import.test.mjs` is that run's `graph.json` reduced to the fields the importer reads.

## Wiring still needed

None of this is done; these files belong to other owners.

1. **Back-fill on profile approval** (`brand-brain.ts`, inside the approval transaction, after the `brand_brain_versions` insert): `applyMutations(db, scope, fromBrandBrainSnapshot(snapshot), {actor: userId})`. For businesses approved earlier, the same call from an owner or admin request, or an operator script run with the migration credential (an operator policy exists on all three tables).
2. **Research and analysis jobs** (`intake-jobs.ts`, `brand-analysis.ts`, registered in `worker-main.ts`): after sources are stored, call the provider with `extractionRequest(...)`, pass the answer through `validateExtraction(...)`, then `applyMutations(db, jobScope, mutations)` inside `AssetJobs.transaction`. Needs a spend reservation for the `check` model in the grant the job already uses.
3. **Planning** (`planning-jobs.ts`, `planning.ts`): `buildContextPack(db, scope, {kind: 'plan', input})`, put the pack in the planner input in place of `facts`, and store `used_node_ids` on the planning request.
4. **Creative, carousel and video** (`creative-jobs.ts`, `carousel-jobs.ts`, `video-jobs.ts`): the same with kinds `creative`, `carousel`, `video`. After a version is saved, record a post node and `used_in` edges for the angle, format, pillar and assets used.
5. **Insights** (`insight-jobs.ts`): pack of kind `insights`; write result and lesson nodes with `performed` and `learned_from` edges.
6. **Owner view** (`app.ts` routes plus a web screen): list nodes by status, with evidence, and call `reviewNode`, `reviewEdge` and `supersedeNode`.
7. **Job kinds**: if a dedicated `knowledge.build` job is wanted, a later migration must add it to `jobs_kind_check` and to `app.knowledge_scope`.
