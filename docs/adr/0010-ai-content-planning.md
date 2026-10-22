# Durable skill-driven 30-day planning

Status: backend implemented; eight targeted local integration cases and four provider/schema contracts pass. All 114 final-source offline/contract/security/browser checks pass at edec068. Release remains BLOCKED for full product/deployed/live acceptance. No live model quality, deployment or module completion is claimed.

## Product behavior

`POST /api/v1/businesses/:id/content-plan/generate` accepts a start date and optional brief, plus an Idempotency-Key. It captures the approved Brand Brain and saved step-three goal, timezone, cadence, channels and must-avoid guidance. A genuine `plan.generate` Temporal job then executes the owner's marketing-plan/product-marketing/social skills through the existing isolated Deep Agents runtime. These remain drafts: no image generation, approval, account connection, scheduling or publication is implied.

The result must contain 30 distinct briefs/hooks, include every requested supported channel, cover all four weeks, stay inside the 30 local calendar days and cite approved fact IDs. Static image briefs are the supported initial format. Source citation membership and output constraints are checked; factual entailment and marketing usefulness still require human review and paid model quality evaluation. Cadence informs the strategy; 30 draft ideas are not an automatically authorized publishing cadence.

The worker atomically inserts a new generated plan, all 30 slots and their initial audit events. It never replaces an existing plan or approval. Generated records preserve the exact approved snapshot, original strategy/slot suggestions, skill digests, selected model, source preference revision, provider-call records and conservative reserved cost. Later owner preference edits remain untouched. Slot `strategy_slot_index` links a mutable draft back to its immutable original suggestion. Original suggestions do not automatically validate later human edits.

## Architecture and contracts

- Migration 012 adds planning requests, operator-only grants and call reservations, generated-plan provenance and bound-job RLS policies. Worker inserts are restricted to its own new content-needed slots/events; no worker approval/update privilege is granted. App users cannot manufacture generated-plan records or issue funding grants.
- `planning.ts` handles authenticated enqueue, job status, cancellation and plan detail. `planning-jobs.ts` handles conservative reservations, bounded model execution, atomic promotion and recovery. Existing dispatcher/workflow/worker paths carry the new job kind.
- `planning-contracts.ts` validates output and immutable skill pins. Original marketing-plan skill/tree hashes are retained from the audited owner archive; social/product-marketing reuse their established pins.
- `SkillRuntime.contentPlan` reuses the networkless, read-only, credential-free container and read_file-only virtual mount. It uses a distinct planning prompt/result contract; the creative brief path remains compatible. No helpers, delegation, shell or provider credentials enter the runtime.
- The official pinned OpenAI Responses SDK remains server-side, with `store:false`, no automatic retries, bounded input and 16,000 output tokens for planning (existing Canvas stays at 4,000). At most three model steps execute. A model/rate/cap grant must be explicitly enabled and unexpired before each new call.

## API and configuration

- POST `content-plan/generate` — persisted job enqueue; no local timer or fixture substitution.
- GET `content-plan/jobs` — real status, error, cancellation state and output plan ID.
- POST `planning-jobs/:jobId/cancel` — cancellation request; unknown paid outcomes cannot be cleared through cancellation.
- GET `content-plans/:planId` — original strategy, provenance and source settings.

All routes use the business prefix and verified-session guard. Existing calendar/review queries expose saved slots. Server-only OpenAI key and exact skill image digest remain required. Operator-only planning_grants contain an eligible model, expiry, per-token rates, budget and approval identity. These are internal primitives; customer/operator setup screens still need to be completed. No user is being asked to patch database rows as a finished-product setup flow.

One unresolved planning request per business and five new requests/day limit abuse. Up to 36 plans/business remains the current storage quota, rechecked under the same canonical business locks as manual plan creation. Reservations for rejected, failed and unknown requests remain counted, rather than pretending they have been settled/refunded. This is a bounded staging allowance, not the finished subscription/credit ledger.

## Recovery and evidence

Provider uncertainty is held as unknown and is never blindly resubmitted. Successful model output is persisted before plan promotion; a database failure can resume without a second model charge. Permission loss/cancellation prevents promotion, while already-consumed allowance remains auditable. Wrong job scope, changed approved input, malformed results, unsupported tools and fabricated citation IDs are rejected. Invalid shape/claims never become a fake successful plan.

Tests use actual Nest/Better Auth sessions, PostgreSQL RLS, Temporal and the isolated original skill runtime. OpenAI transport is explicitly MOCK. Fixtures are labeled TEST FIXTURE; tests use an explicit elevated test entitlement to isolate many failure scenarios without changing the product's default three-business cap. Contracts cover the official SDK request, calendar/month/year/leap boundaries and invalid outputs/pins. Backend tests cover independent funding, immutable context, 30-slot persistence, original plan preservation, recovery, cancellation/access changes, budget changes between steps and unknown outcomes.

Next: connect content slots to Canvas generation/revisions, then implement and verify the customer calendar and channel-header Review Inbox. Canonical export, OAuth/publication/reconciliation, video, metrics/learning, complete account modules and deployed/live acceptance remain part of the active end-to-end goal.
