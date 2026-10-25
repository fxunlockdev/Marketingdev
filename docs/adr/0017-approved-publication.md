# 0017 — Durable publication of an exact approved image

Status: implemented and locally verified at 6d0e66a. Personal LinkedIn is the first publisher; other V5 formats/channels and analytics remain in scope.

## Source and request contract

Rechecked Postiz commit `651876e24317c2d8e717262cf98267ec6f699180`: `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` exposes organization-scoped POST/GET `/posts`; `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts#getPosts` returns bounded-date parent posts with integration identity, content, date, state and release ID/URL. The existing audited adapter uploads actual PNG multipart bytes (`adjust=false`), submits one LinkedIn schedule and checks its acknowledged ID. No invented idempotency header or content-based matching is used.

POST `/api/v1/businesses/:id/publications` requires `slot_id`, saved `revision`, `export_id`, local `channel_id`, explicit `confirmed:true` and an idempotency key. The server snapshots the approved caption, exact rendered PNG fingerprint, schedule and account revision. Only owner/admin business grants can submit. The selected account must be observed available, belong to this business and be LinkedIn. The schedule must be at least one minute and at most 31 days ahead. Existing three-business entitlement remains unchanged.

API and worker both require `POSTIZ_PUBLISHING_ENABLED=true`; default is off. An operator-created, expiring `publication_grants` row authorizes a specific business/channel and bounded rolling daily request count (1–100). This is a staging safeguard, not proof of consent or a replacement for the unfinished operator setup interface. No grant, live credential or actual social publish was created by development tests.

## Persistence and isolation

Migration 018 adds publication requests, staging grants, reconciliation jobs and immutable observation history, with forced RLS and composite tenant/brand foreign keys. API cannot mutate provider state or read the saved remote media receipt. Worker cannot change the snapshot, forge approvals, create grants or access another job's publication/export. Existing restricted Postiz credentials stay encrypted and server-only.

Canvas, plan and connection locks are acquired in consistent order. Before each external mutation, the worker rechecks membership, cancellation, staging grant, account revision, observed channel identity, current slot revision/time/caption and the canonical export's exact approval. Saved private bytes are hash/length verified before upload. The submission transaction holds review/connection locks across the bounded network call, so ordinary product edits cannot overtake the final check. Operator credential/grant changes must use the same locking protocol; a dedicated operator workflow remains outstanding.

Durable `uploading`/`submitting` markers commit before calling the remote service. A crash or ambiguous response leaves an unresolved hold; no automatic write retry. Returned media is persisted before submission. A confirmed rejected call can be retried only via an explicit new customer request. Unknown/accepted requests reserve the slot against duplicate publication. A locally lost acceptance commit becomes unknown; no remote post ID is guessed from matching text or images.

## Honest states and reconciliation

`accepted` means Postiz acknowledged the schedule, not that the social network published it. Only the acknowledged ID in the bound organization's list can advance observation, with matching account/provider/caption/schedule. `PUBLISHED` additionally needs a nonempty release ID. Missing, changed, failed or malformed results cannot become success. Read failures preserve prior observations and attach a safe check error; successful observations append immutable history, including prior published evidence if a post later disappears.

The Temporal publication workflow performs an immediate read, sleeps durably until the scheduled time, then performs bounded hourly checks (26 total). It never resubmits a missing post. After the automatic window, an explicit reconciliation request can check again. Cancel is available before submission starts and never claims to delete a remote post; accepted/unknown submissions require status/operator handling. Reconnect/revoke, remote cancellation/rescheduling, unresolved-write operator recovery, full monitoring/retention and broader channels remain unfinished.

## Verification scope

The focused suite uses actual local sessions, forced PostgreSQL RLS, approved Brand Brain/creative fixtures, network-disabled Fabric rendering, immutable private S3 bytes and Temporal. The Postiz server is explicitly MOCK HTTP; no external provider or paid model is called. It exercises confirmation/grant/idempotency, exact uploaded pixels, accepted versus published, read failures/missing/changed results, lost mutation responses, stale approval, revoked access, disabled account, local acceptance commit loss, immutable snapshots/history and tenant/job denial.

This backend precedes customer publishing UI. Production release, deployed ingress/runtime, actual Postiz source equivalence/license review, authorized test-social publication, model quality, video/analytics and remaining modules are still required.

Final frozen-source proof: offline/contracts/social/publishing/Connections reports all pass at dfd78d29f1172f8ac17a23a96361a54fb9d098219d2fe8c1d655b0c293d66ec6 (82 distinct tests, zero skips; social repeats 15 contracts). Six security guards pass separately. Full security/browser reports remain failed or stale and release remains BLOCKED.
