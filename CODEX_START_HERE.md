> **Mandatory:** Read `NO_FAKE_FEATURES_RELEASE_GATE.md` and `CODEX_FIRST_PROMPT.md`. No UI-only completion or fake-live integrations.

# Codex kickoff — first work session

## Required inputs

- `PRODUCT.md` (the full product spec)
- `AGENTS.md` (required engineering behavior)
- `ARCHITECTURE.md` and `diagrams/*.mmd` (13 editable Mermaid diagrams)
- `INTEGRATION_FIRST_BUILD.md` (real integrations, no mock-only acceptance)
- `CONFIGURE_AND_LAUNCH.md` (secure setup and operator prerequisites)
- `inputs/marketingskills-main.zip` (original, 52 skills; checksum under `inventory/`)
- Separately checked-out, version-pinned Postiz GitHub repo (do not assume its current API matches old examples)

## Copy/paste this prompt to Codex

> You are engineering a complete, functioning, multi-tenant Marketing OS. Read `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `INTEGRATION_FIRST_BUILD.md`, `CONFIGURE_AND_LAUNCH.md`, and the original skills ZIP. **Your job is to deliver working software, not a UI design or a prototype.** Customers use our branded UI; the 52 skills run through Deep Agents in our server-side runtime; OpenAI GPT Images generates/edits image assets; Higgsfield generates video through its asynchronous SDK; Postiz is an internal, tenant-safe social publishing engine. Implement real typed SDK/API integrations with persistence, durable workflows, auth, credits, retries, status reconciliation, QA, user approvals, observability and tests. Build one true vertical slice at a time, backend first; implement the custom UI only after the corresponding backend feature works. Use mock adapters for offline development **but never count a mocked service as done**. Pin Postiz and SDK versions, inspect their actual APIs, and prove tenant isolation. Include setup UX and infrastructure scripts such that the operator can add legitimate API keys, approved social OAuth credentials, funded accounts, domains and deployment settings and then operate the product without manually programming connectors. Verify live OpenAI/Higgsfield/Postiz staging test workflows as soon as test credentials are supplied, with explicit spending limits and test-account allowlists. Never mark a feature released without `LIVE_VERIFIED` evidence; don't hallucinate vendor capabilities. Start M0, build the most valuable live end-to-end M1–M3 slice, then implement M4–M6 sequentially, with acceptance tests and evidence per milestone. Where blocked by external credentials/platform permission/legal decision, finish all offline implementable code, report exactly what external action is necessary, and leave the release gate red. Do not stop after frontend scaffolding.

## Suggested first PRs

1. **PR-00-audit:** component/source audit, AGPL and dependency license register, Postiz capability matrix, import/safe skill registry, test fixtures.
2. **PR-01-core:** Next.js/NestJS skeleton, auth/org/brand scoping, migrations, RLS, object store, Temporal dev wiring, mocked model and Postiz adapters.
3. **PR-02-brand:** safe crawl, document parsing, Brand Brain draft, source evidence, Correct/Wrong/Edit and profile approval.
4. **PR-03-creative:** Deep Agents skills + curated tools, GPT image/mock, Fabric editor, QA and approvals.
5. **PR-04-publishing:** authenticated headless Postiz adapter, connection isolation, upload/schedule/status, idempotent reconciliation.
6. **PR-05-video-insights:** Higgsfield provider adapter, durable scene jobs/FFmpeg outputs, Postiz analytics, skill quality eval, evidence-linked learning.

**Before declaring M3 complete**, run the guarded real-provider staging suite with developer keys and an authorized test social account. If keys are unavailable, record `ADAPTER_READY` and keep the release gate red; do not report working integration until live-verified. Never expose customer secrets in code or traces. Continue with remaining implementable code and tests.
