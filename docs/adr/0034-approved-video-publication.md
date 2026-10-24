# 0034 — Approved canonical video publication

The existing hidden Postiz adapter now accepts an exact approved canonical MP4 for LinkedIn. This extends the established image publication pipeline, with the same authenticated tenant scope, staging grants, explicit destination/time consent, durable jobs and uncertain-write holds. No other social channel is enabled by this change.

## Verified source contract

Audited checkout `../postiz-audit` remains pinned at `651876e24317c2d8e717262cf98267ec6f699180`. `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` accepts multipart `/public/v1/upload` with `adjust=false`; the stream engine supports video upload limits. `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` validates a single video, selects LinkedIn's video upload branch from `.mp4`, uploads chunks and finalizes/polls the resulting video. Scheduling uses the existing generic `value[].image[]` media field, including for video. No endpoint or idempotency contract was invented. Source inspection and MOCK HTTP tests are not a live provider verification or license decision.

## Exact approved bytes

Migration 031 makes the image and video reference/hash pairs mutually exclusive and adds narrowly scoped publication-worker read policies. `video-publication-proof.ts` requires the latest project version, final saved-video approval and matching review event, current calendar approval event/version/hash, correct channel, request output identity, and pinned canonical-renderer manifest. The worker rechecks approval and reads/hash-checks private canonical bytes before upload; it does not accept user-supplied remote media URLs. Existing mutation holds prevent blind duplicate uploads/posts after ambiguous responses.

`VIDEO_RUNTIME_IMAGE` pins proof independently of whether new video generation is enabled. API and worker must use the same verified renderer image. The publishing UI retrieves the scoped download, verifies its length/hash, waits for native video playback readiness, and then permits exact-media/account/time consent. Video prompt approval still occurs before paid generation. Static generation has no added prompt approval.

## Evidence and limits

Service coverage extends the actual original-skill/video rendering journey through local MOCK Postiz publication, reconciliation, stale approvals and uncertain outcomes. Browser coverage uses a clearly marked seeded video fixture rendered by the real sandbox, private storage, actual approval services and publishing worker; it does not claim real generation. Machine-generated verification reports record results. No paid call or social post is part of these tests. Meta apps, other providers/channels, remote cancellation/rescheduling, deployment equivalence and live acceptance remain separate unfinished work.
