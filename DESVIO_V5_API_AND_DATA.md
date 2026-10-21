# DESVIO V5 — Backend Data / API / State Contracts

Companion to `DESVIO_UI_V5_PRODUCT_SPEC.md`. All paths are **DESVIO-owned proposed APIs**, NOT promises about existing Postiz endpoints. Codex must compare to the actual application checkout, adopt existing implemented contracts when compatible, and generate OpenAPI schemas, validators, migrations and typed frontend client from the final contracts. Examples omit pagination metadata and standard auth error envelope for brevity.

## Auth, tenancy, entitlements

- All routes require real authentication (except invitation acceptance and auth callback endpoints governed by identity provider). Enforce `(account_id, business_id, actor_id)` from a verified user session, not a browser-provided tenant assertion.
- Account creation yields **0 actual businesses**. `max_active_businesses` entitlement defaults to 3 for the configured consumer plan. Seat invitations do not multiply this quota.
- Business create is a database transaction locking the entitlement counter; archive/restore/delete/upgrade concurrent with create rechecks business count. Return `409 BUSINESS_LIMIT_REACHED` with `{limit:3,active:3,upgrade_available:true}`.
- Use a permission engine/server middleware for `business.read/manage`, `knowledge.review`, `creative.create/edit`, `creative.approve`, `content.schedule`, `publishing.execute`, `channels.manage`, `insights.read`, `learning.approve`, `team.manage`, `billing.manage`, `profile.manage`, `operator.configure`. Use business-scoped grants in join table, not roles stored only in browser.
- Aggregate `Overview?scope=all` must filter businesses in authorization query before aggregating.

## Normalized database schema (indicative names)

| Table | Key fields, unique constraints, audit rules |
|---|---|
| `users`, `accounts`, `account_memberships` | identity provider IDs, account settings, membership and security audit |
| `plan_entitlements` | account_id, plan, `max_active_businesses`, seat cap, feature flags, source_subscription_id, version |
| `businesses` | id, account_id, name, domain, timezone, locale, lifecycle, `brand_profile_version_id`, created_by; unique account+normalized domain where applicable |
| `business_memberships` | account_id, business_id, user_id, role, permissions, status; indexed and RLS/guarded |
| `business_onboarding_sessions` | business_id, step, status, source_url, checkpoint, extraction job, skipped fields, created/updated |
| `crawl_sources`, `crawl_jobs` | business_id, canonical_url, source hash, crawl status, access constraints, collected_at, page metadata |
| `source_documents` | business_id, original name, storage key, MIME, size/hash, upload scan, parse state, page/slide citations |
| `brand_findings`, `finding_evidence` | business_id, field, suggested value, confidence, evidence IDs, state, reviewed value/user, revision |
| `brand_conflicts` | business_id, competing source/value IDs, resolution and reason |
| `brand_profile_versions` | business_id, immutable approved JSON and approver, created_at, superseded_at; no destructive overwrite |
| `product_catalog`, `audience_segments` | verified product facts and audience metadata with source and review state |
| `campaigns`, `content_plans`, `content_slots` | objective, 30-day period, channel, scheduled_at_utc + zone, state, brief, creative linkage |
| `threads`, `messages`, `ai_runs`, `tool_executions` | business_id, actor, role, message, skill digests, provider status/cost, idempotency key and error |
| `creative_projects`, `creative_versions`, `assets` | business_id, owner, editable project JSON, version graph, immutable output, storage keys, format |
| `review_requests`, `review_decisions`, `review_feedback` | approved version ID, action, actor, reason, selected channel, timestamp, optimistic revision |
| `channel_connections` | business_id, platform, provider-account identity, encrypted token reference, scopes, state, connector type |
| `publication_intents`, `publication_attempts` | business_id, creative version, postiz ID, platform post ID, status, idempotency key, reconciliation evidence |
| `metric_snapshots`, `provider_raw_metrics` | business/post/provider, interval, metric definition, raw normalized, source time, sync time and availability |
| `insights`, `insight_evidence`, `experiments` | business_id, claim, status, confidence, sample size, cited metrics/creatives, approved_by |
| `business_automation_policies` | agent modes, approvals, generation caps, publishing limits; changes audit trail |
| `invitations`, `activity_events`, `notifications` | account/business roles, expirations, deliverability, event type, actor, seen_at |
| `billing_customers`, `subscriptions`, `usage_reservations`, `usage_ledger`, `invoices` | customer/subscription source IDs, idempotency/unique event IDs, cost by business, entitlement snapshot |
| `provider_configs`, `connection_test_results` | operator managed secrets references, config status, verified test evidence, never plaintext browser API keys |

**Tenant isolation:** enforce both application row-level permission queries and database constraints/foreign keys. Consider Postgres RLS for tenant-owned tables. Signed S3/R2 URLs must verify business authorization before issuance, be short lived, and apply to original and derived assets. Vector searches must include validated `business_id` filter.

## API surface, proposed

**Account / businesses**

```text
GET    /api/v1/me
GET    /api/v1/accounts/current/entitlements
GET    /api/v1/businesses                       # only permitted businesses
POST   /api/v1/businesses                       # transactional 3-business cap
GET    /api/v1/businesses/{businessId}
PATCH  /api/v1/businesses/{businessId}
POST   /api/v1/businesses/{businessId}/archive
POST   /api/v1/businesses/{businessId}/restore  # recheck limit
GET    /api/v1/overview?scope=all|{businessId}&period=...
GET    /api/v1/notifications
POST   /api/v1/notifications/{notificationId}/read
```

**Onboarding / brand intelligence**

```text
POST   /api/v1/businesses/{businessId}/onboarding/analyze
GET    /api/v1/businesses/{businessId}/onboarding
GET    /api/v1/businesses/{businessId}/onboarding/jobs/{jobId}
GET    /api/v1/businesses/{businessId}/findings?status=...
PATCH  /api/v1/businesses/{businessId}/findings/{findingId}
POST   /api/v1/businesses/{businessId}/documents/upload-url
POST   /api/v1/businesses/{businessId}/documents/complete
GET    /api/v1/businesses/{businessId}/conflicts
POST   /api/v1/businesses/{businessId}/conflicts/{conflictId}/resolve
POST   /api/v1/businesses/{businessId}/brand-profile/activate
GET    /api/v1/businesses/{businessId}/brand-profile/versions
POST   /api/v1/businesses/{businessId}/brand-profile/versions/{version}/restore
```

**Canvas / skills / content plan / review**

```text
POST   /api/v1/businesses/{businessId}/canvas/threads
GET    /api/v1/businesses/{businessId}/canvas/threads
GET    /api/v1/businesses/{businessId}/canvas/threads/{threadId}
POST   /api/v1/businesses/{businessId}/canvas/threads/{threadId}/messages
POST   /api/v1/businesses/{businessId}/creatives/generate
POST   /api/v1/businesses/{businessId}/creatives/{creativeId}/edit
GET    /api/v1/businesses/{businessId}/jobs/{jobId}
POST   /api/v1/businesses/{businessId}/jobs/{jobId}/cancel
GET    /api/v1/businesses/{businessId}/assets?query=...&format=...
POST   /api/v1/businesses/{businessId}/assets/upload-url
POST   /api/v1/businesses/{businessId}/creative-projects/{projectId}/versions
POST   /api/v1/businesses/{businessId}/creative-projects/{projectId}/render
GET    /api/v1/businesses/{businessId}/content-plan?start=...&end=...&channel=...
POST   /api/v1/businesses/{businessId}/content-plan/generate
PATCH  /api/v1/businesses/{businessId}/content-slots/{slotId}
GET    /api/v1/businesses/{businessId}/review-inbox?channel=...&status=...&start=...&end=...
POST   /api/v1/businesses/{businessId}/reviews/{reviewId}/approve
POST   /api/v1/businesses/{businessId}/reviews/{reviewId}/reject
POST   /api/v1/businesses/{businessId}/reviews/{reviewId}/request-changes
POST   /api/v1/businesses/{businessId}/reviews/bulk-approve
```

**Publishing / analytics / memory**

```text
GET    /api/v1/businesses/{businessId}/connections
POST   /api/v1/businesses/{businessId}/connections/{platform}/start
GET    /api/v1/connections/oauth/callback/{provider}    # signed OAuth state
POST   /api/v1/businesses/{businessId}/connections/{connectionId}/disconnect
POST   /api/v1/businesses/{businessId}/connections/{connectionId}/refresh
POST   /api/v1/businesses/{businessId}/publications/schedule
POST   /api/v1/businesses/{businessId}/publications/{publicationId}/cancel
POST   /api/v1/businesses/{businessId}/publications/{publicationId}/retry
GET    /api/v1/businesses/{businessId}/publications?state=...
GET    /api/v1/businesses/{businessId}/analytics?from=...&to=...&channel=...
GET    /api/v1/businesses/{businessId}/insights?status=...
POST   /api/v1/businesses/{businessId}/insights/{insightId}/approve
POST   /api/v1/businesses/{businessId}/insights/{insightId}/reject
GET    /api/v1/businesses/{businessId}/memory?tab=brand|creative|performance|sources|experiments
POST   /api/v1/businesses/{businessId}/automation-policy
```

**Team / billing / profile**

```text
GET    /api/v1/businesses/{businessId}/team
POST   /api/v1/accounts/current/invitations
POST   /api/v1/accounts/current/invitations/{invitationId}/revoke
PATCH  /api/v1/businesses/{businessId}/members/{userId}
GET    /api/v1/accounts/current/billing
POST   /api/v1/accounts/current/billing/checkout
POST   /api/v1/accounts/current/billing/portal
GET    /api/v1/accounts/current/usage?group_by=business
POST   /api/v1/webhooks/billing/{provider}               # signature checked + replay-safe
GET    /api/v1/profile
PATCH  /api/v1/profile
POST   /api/v1/profile/export
POST   /api/v1/profile/sessions/revoke
POST   /api/v1/profile/delete-request
```

## Data contracts (shape examples)

```json
{
  "business": {"id":"biz_01","name":"Acme Skincare","status":"active","timezone":"Asia/Kuala_Lumpur"},
  "account_entitlements": {"max_active_businesses":3,"active_businesses":1,"can_create_business":true},
  "authorized_actions": ["creative.create","creative.edit","creative.approve"],
  "brand_profile": {"version":2,"approved_at":"2026-10-21T11:00:00Z"}
}
```

```json
{
  "review": {
    "id":"review_3","business_id":"biz_01","channel":"instagram",
    "account_identity":"@acme","creative_version_id":"cv_7",
    "scheduled_at":"2026-10-29T10:00:00Z","time_zone":"Asia/Kuala_Lumpur",
    "status":"pending_review","revision":3,
    "qa":{"blockers":[],"warnings":["headline_near_safe_area"]}
  }
}
```

```json
{
  "job": {
    "id":"job_2","business_id":"biz_01","type":"higgsfield_video",
    "status":"RUNNING","stage":"rendering","progress_percent":null,
    "provider_request_id":"redacted_or_opaque","estimated_cost_minor":250,
    "retryable":false,"created_at":"2026-10-21T11:00:00Z"
  }
}
```

## Critical state machine semantics

- `brand_onboarding`: `CREATED → DISCOVERING → AWAITING_REVIEW → ACTIVATING → ACTIVE` with recoverable `FAILED` and `SUSPENDED`.
- `creative_run`: `QUEUED → RUNNING → NEEDS_INPUT / COMPLETED / FAILED / CANCELLED`; external video jobs cannot be assumed cancelable by provider; cancellation must mark desired state and reconcile potential late success.
- `creative`: `DRAFT → IN_REVIEW → CHANGES_REQUESTED / REJECTED / APPROVED`; approving **exact version** only.
- `publication`: `NOT_READY → READY → SCHEDULED → SUBMITTED → PUBLISHED / FAILED / UNKNOWN`; `SUBMITTED` is not `PUBLISHED`. Unknown provider response reconciled by ID to avoid duplicate.
- `learning`: `PROPOSED → TESTING → VALIDATED / REJECTED / RETIRED`. Source data cannot directly override immutable approved brand rules.
- `social connection`: `NOT_CONNECTED → AUTH_PENDING → CONNECTED / NEEDS_REAUTH / REVOKED / ERROR`; store scopes and expiry.

## Platform connector guardrails

Postiz adapter is behind interface `SocialPublishingPort` with methods `getCapabilities`, `startConnection` (if supported by current checkout), `uploadMedia`, `createScheduledPost`, `getPost`, `cancelPost` (if supported), `getMetrics`, `reconcileStatus`. If missing capabilities, add compatible backend extension or mark unsupported honestly. Explicit identity mapping is essential: `(business_id, channel_connection_id, postiz_integration_id)` must not map across brands erroneously. Rate limits are back-pressured per provider, with respect for postiz server configuration.

For image, `ImageGenerationPort.generate/edit`, OpenAI SDK adapter; for video, `VideoGenerationPort.submit/status/receive`, Higgsfield adapter; models routed by safe validated capability declarations. Avoid inventing generic Higgsfield endpoint paths in implementation; use audited official SDK version.

## Design-to-code contractual tests

Frontend must use generated API client/types, not local arrays masquerading as live state. All UI mutations have optimistic revision token or idempotency where needed. Tests cover 401/403/404/409/422/429/502/timeouts; user-facing errors describe a meaningful next step and never claim operation succeeded when server failed. Every long-running operation exposes persisted status and retry/resume. Async results are tied to original immutable business ID, not current selector.

## API verification and production launch

Create `docs/INTEGRATION_EVIDENCE.json` with `provider, adapter_commit, test_id, credential_scope, test_account, evidence_artifact, status` per integration, no secret values. Gate as `NOT_IMPLEMENTED`, `MOCKED`, `ADAPTER_READY`, `LIVE_VERIFIED`, `LAUNCH_READY`. Test against pinned OpenAI/Higgsfield/Postiz versions, with explicit spend ceilings. License review is required for production Postiz use.
