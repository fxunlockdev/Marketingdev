# ADR 0021 — durable video provider stage

Date: 2026-10-22. Internal stage of the existing Temporal/tenant/private-media architecture. Full Canvas video remains in progress. No live provider test, customer endpoint or ordinary worker registration is enabled.

## Persistence and authorization

Migration 019 adds the creative.video job kind and four forced-RLS tables: operator-only video_grants, video_reservations, immutable-intent video_operations and append-only video_observations. Every operation belongs to one organization/business/job and a globally unique provider request key. Customer roles cannot write grants/reservations or read encrypted request/output columns. Workers cannot rewrite intent, key, model, amount or deadline. Workers can read same-business reservations for aggregate budget checks, but only their own operation/output/observations.

VideoProviderJobs.prepare requires an active write-capable requester, correct job kind, live enabled model grant and available budget. The existing membership advisory lock serializes reservations. Create/edit reserve separately configured maximum costs; no price is inferred from marketing. Repeated preparation of the same intent reserves once. A conflicting request key rolls back the new reservation.

AES-256-GCM associated data binds organization, business, job and purpose. Exact signed-reference intent and output locator are encrypted. Changes to the fingerprint/key reject replay. Ciphertext swapping and tampering fail closed. Secret rotation/recovery remains operator setup work.

## Recovery and cancellation

step commits a submitting marker before the external POST, after rechecking permission, grant/model, deadline, exact reserved cap and total budget. A known rejection of that initial submit releases its reservation. Lost responses, crashed activities or failed receipt commits leave an unknown hold without an automatic duplicate POST. A late valid receipt from the original activity can recover its own unknown marker. Documented provider idempotency is still sent; automatic replay does not depend on an unverified live deduplication promise.

Known remote IDs persist before polling. Read failures preserve ID/budget. Observations append; late nonterminal polls cannot overwrite terminal state. Deadline/retry exhaustion keeps the uncertain remote ID and reservation. Cancellation before submit releases unused funds. After acceptance, cancellation or permission loss triggers one bounded remote cancel and authenticated reconciliation. Interrupted/lost cancellation is uncertain and not repeated blindly. Processing can beat cancellation; revoked/canceled requesters cannot retrieve completed output. Provider failed/nsfw/canceled states do not automatically settle our monetary ledger; cost reconciliation remains separate.

videoProviderWorkflow uses real Temporal activities and durable 30-second timers, bounded by a persisted six-hour deadline and iteration/retry limits. An integration test replaces the worker while a timer is pending and completes the same remote request without another submit. This child stage is deliberately not launched independently by the ordinary dispatcher: the parent Canvas workflow must first freeze approved context and references.

## Completion boundary

Provider completion encrypts an untrusted output locator. It does not mark the Desvio job succeeded, save playable media or imply approval/publication. output rechecks current permission. The parent must perform bounded download, isolated decoding/re-encoding and private persistence before promoting an immutable creative version.

No customer API creates this stage yet. Tests seed jobs with a disposable administrator and exercise actual restricted runtime roles. This proves the provider ledger/stage, not the browser journey or original video skill execution. Existing platform architecture and three-business default are unchanged.

## Verification and next work

make verify-video-provider runs real PostgreSQL/RLS and Temporal with MOCK Higgsfield HTTP: create/edit, encrypted replay, budget races, changed/expired grants, rejection/unknown holds, failed receipt commit, duplicate activity copies, cancellation races, outages/deadlines, moderation, business/job isolation, selected-business revocation, tampering, reservation rollback and worker replacement. Full security includes these tests once its existing document-image prerequisite can run. Bootstrap acceptance expects 20 migrations.

Initial test fixtures exceeded three businesses per account; isolated accounts fixed the fixtures without relaxing product limits. Docker storage remains full. No unrelated container was stopped/pruned, and the earlier shared-VM restart/expansion question remains unanswered. Railway again rejected dev creation with an upstream pause; captured in docs/evidence/railway-video-attempt.json.

Next: original video/ad-creative skill execution, approved Brand Brain/reference ownership and revocable reference leases; isolated FFmpeg validation/composition; private output/immutable edit lineage and exact-output approval; complete worker/API/configuration wiring, then Canvas controls. Unknown-request recovery, cost settlement and key rotation need operator tooling. Deployed runtime and capped authorized model acceptance remain gates. The complete end-to-end objective is unchanged.
