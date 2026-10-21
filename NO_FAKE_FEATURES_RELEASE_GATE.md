# No-fake-features release gate — HARD ACCEPTANCE CONTRACT

**Owner intent:** The finished SaaS must work after legitimate credentials, infrastructure, OAuth consent and app approvals are supplied. Codex must build the backend, setup and integration paths—not merely their UI. This document is a **specification for implementers**, not evidence that the application has already been developed.

## 0. Rule of proof

A button, screen, worker log, successful fake-provider response, or completed TypeScript interface is **not** proof that an integration works. Only repeatable staging execution, persisted results, tenant authorization checks, meaningful failure tests and recorded evidence can move an adapter from `ADAPTER_READY` to `LIVE_VERIFIED`.

- Enabled production capabilities MUST NOT use mock providers, placeholder assets, synthetic analytics, invented Postiz IDs, or client-side provider credentials.
- If test credentials are unavailable, build typed adapters, durable workflows and offline contract tests; mark the external service **`ADAPTER_READY` and BLOCKED**. Never mark it ready by fiat.
- A key alone is not a substitute for deployment, provider billing, platform OAuth/app review, social authorization, a legal/licensing decision, or a permitted public callback URL.
- Postiz is an *internal service* and must pass a two-tenant publish isolation test; no shared unscoped key may silently cross account boundaries.
- Every successful UI action must be backed by tenant-scoped API mutation/query, database record, worker/job state and a verifiable output.

## 1. Implementation priority — working vertical slice first

Ship proof in this order (small pull requests; no full UI frontend dump):

| Gate | Minimal code demonstration | Real evidence before accepting |
|---|---|---|
| G0 repo proof | Pin all OSS deps; read Postiz actual APIs/limits, check license; import owner skills with SHA-256 inventory | Compile, service health, actual upstream contract matrix and blockers |
| G1 tenancy and services | Auth, brand/org scoping, DB migrations, safe credentials, object storage, Temporal, Postiz health | Two-org isolation test, migrations/recovery, restart test |
| G2 onboarding | Domain-safe Crawl4AI, Docling PDF/PPTX, provenance, proposed facts, Correct/Wrong/Edit, conflict resolution | Two real file fixtures + permitted site + persisted approved profile |
| G3 first paid-provider slice | Load real owner social/image skills, verified Brand Brain, official OpenAI image create AND edit, Fabric layers, approval | Cost-capped staging image request and edit, asset persisted and reload/edit/export works |
| G4 real social publish | Social OAuth in own UI + proven Postiz tenant model; schedule via Postiz; reconcile remote status | Allowed real test social account + remote post ID + second tenant denied |
| G5 video | Higgsfield SDK async submit, polling/webhook, copy output to S3, FFmpeg scenes/captions, review | Cost-capped real video clip + job recovery + approved video export |
| G6 outcomes & scale | Ingest genuine metrics, link creative/skill/version, evaluated recommendation; usage billing, observability/load/security | Evidence chain creative → remote post → metrics; security and load report |

If live test is blocked, complete all non-live pieces and explicitly hand over the single external prerequisite needed. Do NOT route around blocked acceptance tests by substituting a mock in a green status.

## 2. Machine-readable integration evidence

Codex must create `docs/evidence/integration-status.json` at runtime from real tests (see `contracts/integration-status.schema.json` and `contracts/integration-status.example.json`). **Never edit statuses to green manually.**

Each enabled capability needs:

- `code_commit`, dependency version, UTC verification time, environment, tenant/test account reference (redacted).
- Contract test command, exit status, live smoke test command and result.
- Safe trace correlation ID; output asset/object key or remote published post ID (redacted as needed).
- Failure-path evidence: provider `401`, `429`, timeout, malformed output, webhook loss, retries, quota exhausted; no double charge/double publish.
- Two-tenant negative tests, resource quota and secret-handling validation.
- Redacted artifacts under `docs/evidence/`, referenced from a non-secret evidence manifest.

`LAUNCH_READY` requires verified external calls plus completed tenancy, RBAC, cost ceilings, failure recovery, security scanning and legal/operations prerequisites.

## 3. Executable commands — Codex must implement them

These are required *outputs of development*, not commands that this documentation ZIP can magically run:

```bash
make dev                   # Local Postiz, app, DB, worker, storage, dev-only mocks
make verify-offline        # Honest dev fixtures; green does NOT imply live integration
make verify-contracts      # Pinned SDK and upstream schema validation
make verify-live           # Opt-in, cost-capped, allowlisted staging real-provider calls
make verify-security       # Tenant, credential, SSRF, OAuth, file and skill sandbox tests
make verify-load           # Reproducible workload report with queue saturation and quotas
make release-gate          # Exit nonzero if any *enabled* production capability not ready
```

`make verify-live` must require `APP_MODE=staging`, a billing/spend cap, and an allowlist of test brands and accounts. Live social publishing is NEVER attempted on an arbitrary customer account. `make release-gate` must fail closed when evidence is missing, stale or untrusted, or a mock adapter appears in production routes.

## 4. No frontend theatre — strict review checklist

Reject: a generated dashboard with fake metrics; success notices when nothing persisted; disconnected mock canvas; fake 'Connected' flags; frontend API keys; Postiz iframe instead of custom UI; no-op buttons; an 'AI-generated' image pulled from a fixture; static fake comments or CTR; deployment instructions that tell operator to manually implement missing SDK methods.

Accept: a path from actual frontend button through validated backend API and tenant isolation → durable job → official provider or Postiz → persistent asset/state → retry/error controls → user review and genuine outcome, with test evidence.

## 5. Minimal proof Codex must show at handover

1. Fresh brand signup → allowed website crawl → PDF and PPTX upload → source-backed corrections → approved Brand Brain.
2. One prompt → actual owner `social` / `image` / `ad-creative` skills load (content digests logged), official OpenAI image generated/edited → editable Fabric project saved and reloaded.
3. Approved creative → actual tenant-authorized Postiz publish to consented test social account, tracked remote ID, reconciled status; second tenant cannot access it.
4. A Higgsfield real video is generated by async job → result copied to our S3 store → FFmpeg export survives restart.
5. A real analytics snapshot → source attribution → evidence-linked recommendation. Missing metrics show **unknown**, never fake zero/success.
6. Operator can configure provider credentials safely in `/setup`, run readiness checks and switch from staging to production after gates pass; no code edits for normal credentials/callback configuration.
7. Load/test plan validates queue/backpressure and quotas for thousands of registered customers; never assert concurrency or SLA that wasn't measured.

**Until these pass with real vendor access, say `implementation in progress`, not `fully working platform`.**
