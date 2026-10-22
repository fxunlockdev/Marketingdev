# Business-bound Postiz transport and durable account refresh

Date: 2026-10-22. Status: implemented locally; no upstream live acceptance.

## Scope and decision

Use a distinct Postiz organization credential for each Desvio business. Do not use groups as tenant isolation or send `x-postiz-org` overrides. Keep publishing behind the canonical creative approval boundary. This PR provides the audited server transport and durable connection-refresh path; it does not expose unfinished OAuth or publication controls.

`PostizClient` is checked against pinned upstream commit 651876e24317c2d8e717262cf98267ec6f699180 and official public API documentation. Each operation first calls `/public/v1/me` and compares the authenticated organization to the persisted business binding. Request headers are constructed internally; cookies, browser headers and privileged overrides are not forwarded. Redirects are disabled; requests and JSON responses are bounded; provider bodies and credentials are excluded from errors. The first typed create path is one LinkedIn static post. Other platforms remain in the full product scope and require their provider-specific settings/workflows.

Transport methods cover organization identity, account list, LinkedIn authorization URL and callback contracts, exact hash-checked PNG multipart upload, one-post scheduling and date-bounded status reconciliation. The configured API base is an operator-controlled backend base (for the self-hosted nginx service, `/api`). Media outputs must use explicitly configured origins. Callback URLs must exactly match the Desvio origin and audited provider route. No arbitrary remote endpoint or customer-selected URL is accepted.

Scheduling returns `accepted`, never `published`. Source has no proven create-post idempotency contract, so transport retries are disabled. A lost/malformed/5xx scheduling response has outcome `unknown`; a durable publisher must persist the attempt before submitting, retain unknown outcomes and never automatically resubmit. Reconciliation uses the real dated list, actual integration ID and upstream state. `PUBLISHED` without a release identity stays unknown. No generic GET post/:id endpoint is invented.

## Persistence and runtime

Migration 015 adds `postiz_accounts`, `social_sync_requests`, `social_channels` and `social.sync` jobs. Global unique remote-organization and credential fingerprints prevent business reuse. Credentials use AES-256-GCM bound to organization, business, remote organization and credential revision. The API role cannot read encrypted credentials; it can only read safe binding metadata. Both API and worker are denied credential writes. Provisioning belongs to the later restricted operator workflow, not customer requests.

Authenticated GET `/api/v1/businesses/:id/connections` returns saved safe account metadata and actual job state. POST `/connections/refresh` requires an owner/admin (and an admin grant when business-scoped), an idempotency key and an enabled verified binding. It atomically queues a revision-bound request and dispatch record, coalesces concurrent work and enforces a per-business check limit. POST `/connections/jobs/:job/cancel` requests cancellation.

Temporal `syncSocialWorkflow` performs only read-only Postiz operations. Credential decryption stays in the worker. The worker rechecks permission, cancellation and binding revision before promotion. Actual accounts are recorded as available, disabled or missing based on a successful list. Token health remains unknown because the public list does not prove provider token validity. Failed reads retain previous observations. Snapshot promotion is transactional, and retrying read-only checks cannot duplicate publication. Retry-After is respected within the configured bound; attempts are bounded. A remote ID collision with another business fails under forced RLS rather than moving that account.

## Configuration and acceptance limits

API: `POSTIZ_ENABLED=true` makes the implemented connection APIs available when a verified binding exists. Worker: `POSTIZ_ENABLED`, `POSTIZ_BASE_URL`, comma-separated exact `POSTIZ_MEDIA_ORIGINS`, exact `POSTIZ_CALLBACK_ORIGIN`, and a separate 32-byte hex `POSTIZ_ENCRYPTION_KEY`. Per-business Postiz API keys are encrypted in the database, never a shared frontend/global customer key. No actual keys were added in this PR.

Ten transport tests use an explicitly MOCK local HTTP server. Seven integration tests use actual local auth, PostgreSQL forced RLS and Temporal, with that MOCK upstream. These prove local boundaries and persistence, not real OAuth, token health or publication. `make verify-social` generates source-bound evidence separately from the full security gate, which remains blocked by local Docker disk capacity.

Remaining: automatic operator-controlled organization provisioning and uncertain-provision recovery; real deployment/source equivalence and license review; session-bound one-time OAuth state and callback workflow; provider page/account selection and reconnect semantics; connection UI; durable exact-approved-image upload/publish/unknown-outcome reconciliation; authorized live acceptance. Current Postiz reconnect documentation says integration ID, while pinned callback code compares a remote/internal identity; do not ship reconnect until runtime behavior is proven. No interface asks customers to use Postiz.
