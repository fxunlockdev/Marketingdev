# Content records and channel-specific review

Status: backend implemented; ten targeted local HTTP/PostgreSQL tests pass. All 102 current-source offline/contract/security/browser checks pass at bbf1e79. Release remains blocked for missing full product/deployed/live acceptance. This is a prerequisite for the AI planner and calendar/inbox UI, not completion of those modules.

## Behavior and architecture

Migration 011 adds business-owned content plans, dated channel slots and append-only slot events to the existing Postgres/RLS architecture. The Nest service is `apps/api/src/content-plan.ts`; its routes use the existing verified-session guard. No new infrastructure or provider is introduced.

A manual plan has a title, objective, IANA timezone, 30 local calendar days and 1–120 slots. Create is idempotent per business/actor/key and does not overwrite another plan or an existing approval. A business currently allows 36 plans. Explicit UTC instants plus the IANA timezone preserve both repeated fall-back times; invalid dates and dates outside the plan's local horizon fail. A planned date is not a remote scheduled post.

Each slot binds a channel, format, brief and optional exact immutable creative version/hash. Linking an image creates a draft-ready slot. Review submission, approval, rejection, changes requested and cancellation persist independent of other channel slots and Canvas's general creative review. The next publishing workflow must use this slot approval and exact version/hash; it must not infer channel consent from a global Canvas approval.

Owners/admins decide reviews; editors may submit and edit, viewers read only. Review requests include the observed slot revision and creative version/hash. Canvas promotion and content changes share the same advisory lock order, preventing approval from racing a newer creative. Business UUID lock keys are normalized to lowercase in both Canvas and planning, matching PostgreSQL UUID equality; an actual blocked-request test covers both mixed-case paths. A newer creative is explicitly flagged in reads and cannot inherit an old slot's approval. Historical approval remains visible for its original version. Editing an approved slot needs explicit reset confirmation and creates a draft requiring review, including a date change. Rejection and change requests require feedback. Bulk approval requires explicit confirmation, up to 30 unique selections, and succeeds atomically only if every version/revision remains eligible.

Each accepted change appends an actor, timestamp, revision, exact creative and content snapshot. Failed history insertion rolls back the entire mutation. Forced RLS, composite tenant foreign keys, column-limited update privileges and no delete/update grant on history protect records. Workers have no new permissions until a generated-plan job is implemented with its own bound-job scope.

## Implemented API

- POST `/api/v1/businesses/:id/content-plans`: explicit manual plan creation, Idempotency-Key required.
- GET `/api/v1/businesses/:id/content-plan`: start/end UTC range (maximum 93 days), optional channel/state/plan_id/page. Stable 100-item pages, exact filtered totals and channel/state counts.
- PATCH `/api/v1/businesses/:id/content-slots/:slotId`: compare-and-swap editing and creative attachment.
- GET `/api/v1/businesses/:id/content-slots/:slotId/history`: persisted audit history.
- GET `/api/v1/businesses/:id/review-inbox`: date/channel/state filtered review records with actual creative design/caption/provenance, no seeded posts or connection claims.
- POST `/api/v1/businesses/:id/reviews/:slotId`: submit/approve/reject/request changes/cancel with revision and exact creative binding.
- POST `/api/v1/businesses/:id/reviews/bulk-approve`: explicit atomic selected-version approval.

## Evidence and limits

`tests/foundation/content-plan.test.mjs` exercises actual Nest/Better Auth HTTP sessions and disposable PostgreSQL. Email verification and existing creative rows are explicit setup fixtures, not live email/media claims. It proves 30-slot/two-channel persistence, idempotent concurrent creates, tenant/worker/viewer denials, independent channel review, revision races, bulk rollback, feedback history, local date/DST boundaries, stale creative protection and transactional failure recovery. Existing creative tests separately prove generation with mocked paid transports.

AI strategy generation is not yet implemented. Next: original pinned marketing-plan/social/product-marketing skills, approved Brand Brain and goals, a bounded durable generation job with provider reservations/uncertainty holds, schema/citation validation and atomic persistence of 30 distinct channel-adapted slots. Then build and test the actual month/week/list calendar and horizontal-channel Review Inbox. Campaign filters, author/assignee UI, visual references, creative-from-slot/feedback job linking, publishing/account identity, canonical exports and broader supported media remain open. No OAuth action, paid generation or publication runs through these new routes.

### Next implementation anchors

Use the original `marketing-plan` skill digest `2b75dfae852bdb61fd96eebe3d2b373f99f67c86ff830f796310f662ba8906e8`, tree digest `d3f0c84f21bf77fb851403e95bd1d0270d81ae664d61a39cd003764fe5571fd6`, from the machine-audited archive, alongside social/product-marketing. Extend the existing networkless `apps/skills/runtime.py` and typed broker with a distinct bounded planning result; do not pretend the current image-brief schema is a 30-day strategy. Its current 4,000-token / 30,000-character output limits need an explicit, cost-reserved planning limit and tests.

Snapshot the approved Brand Brain and saved `business_onboarding` goal/timezone/cadence/channels/must_avoid at request time. Add a dedicated `plan.generate` job/request/grant/call scope through the existing Temporal dispatcher/worker and schema validator. Worker writes must bind that exact request and cannot approve content. Generation inserts a new plan atomically with provenance and validated channel variants; it must never rewrite an existing approved plan. Replay, cancellation, permission loss, quota, malformed output, unsupported channel/format, and unknown paid outcomes need the same fail-closed treatment as Canvas.
