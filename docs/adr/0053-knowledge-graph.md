# 0053 — Per-business knowledge graph in Postgres; Graphify is optional, not the builder

Date: 2026-11-12. Owner asked for a knowledge graph per business and for Graphify to be evaluated as its builder.

## Decision

1. The graph lives in the existing Postgres under the existing tenant row-level security: `app.knowledge_nodes`, `app.knowledge_edges`, `app.knowledge_evidence` (migrations 111, 112). Postgres is the store of record.
2. The graph is filled by our own extraction step (`knowledge-extract.ts`): a strict JSON contract, validated before anything is written. Existing businesses are back-filled from their approved brand profile with no model call (`fromBrandBrainSnapshot`).
3. Graphify is **not** the builder. It may run later as an optional sandbox job whose output is imported as suggestions through `knowledge-graphify-import.ts`. That path is implemented and tested against captured output, but nothing depends on it.
4. Planners and generators read the graph through context packs (`knowledge-context.ts`), not the flat fact list.

## Why not Graphify as the builder

Measured offline on this Mac with `graphifyy` 0.9.106 and no API key (details in `docs/KNOWLEDGE_GRAPH.md`):

- Without a model, Markdown yields only document structure: pages, headings, `contains` and page-to-page `references`. Body text, bullet lists and JSON files produce no nodes. It finds no offers, pains or angles unless we already wrote them as headings, in which case we already had them.
- Its model pass has a code-oriented vocabulary (`calls`, `implements`, `references`, `cites`, `conceptually_related_to`, ...) and node kinds (`code`, `document`, `paper`, `image`, `rationale`, `concept`). A second classification step would still be needed to reach persona, pain, angle and the rest.
- That model pass calls a provider with Graphify's own prompt and key handling, outside our model policy, spend reservations and audit trail.
- It would add a Python runtime and about 40 tree-sitter packages to a worker image for a result our own single extraction call produces directly in the right vocabulary.

## Rules the schema enforces

- Every row carries organisation and business; edges and evidence use composite foreign keys, so they cannot join two businesses.
- Forced RLS on all three tables. The app role reads and writes within the tenant and business. Editors may add and refine suggestions; approving or rejecting needs a reviewer (`app.creative_reviewer`) recorded as the actor.
- The worker role reaches the graph only inside a job of the same business and of a listed kind, and can write only `suggested` rows that are not owner statements. It holds no privilege on the status or review columns.
- A node is unique per (organisation, business, type, key). Reviewed nodes are never overwritten by a later suggestion.

## Consequences

- No new runtime dependency. Migration 113 was reserved and is unused.
- Extraction quality is unproven until a live model run; only the contract and wiring are tested.
- Nothing calls these modules yet. The wiring needed in files owned by others is listed in `docs/KNOWLEDGE_GRAPH.md`.
