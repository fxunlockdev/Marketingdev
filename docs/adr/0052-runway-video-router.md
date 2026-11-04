# 0052 — Runway Model Router replaces Higgsfield for new videos

Date: 2026-11-04. Owner explicitly requested replacement and automatic model selection.

New video/Reel requests, campaign videos and conversational revisions use `RunwayClient` through the existing durable approval, reference, reservation, worker and media-save pipeline. Images/carousels retain GPT. Historical Higgsfield assets and provider operations are not relabeled or deleted. Optional, separately enabled Higgsfield still-image replacement is outside this video change.

## Audited wire contract

Official sources checked 2026-11-04:
- https://docs.dev.runwayml.com/api.md
- https://docs.dev.runwayml.com/model-routers/generating.md
- https://docs.dev.runwayml.com/model-routers/configuration.md
- https://docs.dev.runwayml.com/assets/outputs.md
- https://docs.dev.runwayml.com/guides/pricing.md

Fixed HTTPS origin `api.dev.runwayml.com`, Bearer server secret and `X-Runway-Version: 2024-11-06`. POST `/v1/generate/video` sends `configId` and model-agnostic input, never a hardcoded generative model. Reference role is `first`; native audio is disabled to preserve the existing silent-video contract. The existing approved 3–15 second duration remains enforced. Square/reel map to 1:1/9:16; legacy 2:3/3:2 exports use the router's supported 3:4/16:9 source and retain the existing final renderer dimensions. This does not claim a change in the product's format vocabulary or native narration support.

Routers are automatically created/reused as `desvio-video-quality-v1-{cap}` with quality preference, no model exclusion, and a video credit ceiling. Current official pricing is $0.01 per credit. The immutable reservation's USD-micros cap is rounded down to whole credits; values below one credit fail before dispatch. No generation cap or lifetime budget is silently increased. A changed router config fails closed. New eligible models can be selected by Runway; this may include other labs' models. Selected model/provider, estimated credits and cap are retained in operation metadata and final video provenance. Estimates are not presented as final billing.

The bounded HTTP adapter intentionally does not use SDK automatic retries/wait helpers: a durable Temporal workflow owns polling, timeout reconciliation and the paid submission marker. Each transport call has a bounded timeout/response size, refuses redirects and redacts provider error bodies. POST receipt loss is `unknown`, never a blind re-submit. Router preparation failures are safe rejections because no generation POST has been sent. GET tasks handles PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED and CANCELLED; optional actual progress is stored. DELETE tasks requests cancellation; acknowledgment is not proof of cancellation/refund. Successful output URLs are validated and copied to private storage through the existing SSRF-safe authenticated-provider-output path, never exposed as permanent assets.

## Migration and deployment

Migration 089 updates current video grant entitlements and inherited workspace defaults to `runway/router` without widening budgets/expiry. Historical operation provider defaults to `higgsfield`; new rows explicitly record `runway`. Historical completed assets still download normally. A legacy prepared operation is safely rejected/released; an already submitted legacy operation is held for reconciliation, never sent to Runway. Rollout requires idle workers and disables new videos until credentials and live acceptance are complete. No new Higgsfield video dispatch is wired into the worker.

Set `RUNWAYML_API_SECRET` on `desvio-dev-worker-settings` in Railway dev. Keep the existing VIDEO_ENCRYPTION_KEY; rotating it would break existing encrypted records. `RUNWAY_OUTPUT_POLICY=authenticated_provider_result` is the default; optional exact-origin mode uses RUNWAY_OUTPUT_ORIGINS. Key-only configuration does not enable paid generation. Controlled worker rollout, readiness, API VIDEO_ENABLED activation and a real approval/generation/save/playback check are required before LIVE_VERIFIED. Never put the key on the web service or in chat.

## Validation boundary

Contract and disposable-database/browser tests use explicit MOCK Runway responses, including real transport serialization, storage, renderer, RLS, lost receipts and recovery. Local reference leases are remapped to an HTTPS test origin at the test boundary because disposable object storage is loopback HTTP. These tests are not evidence of Runway quality, credentials, model eligibility or paid live generation.

New routed requests explicitly request 1080p, the highest resolution retained by the existing safe video renderer. The router must select an eligible model at that resolution within the grant cap; it does not silently downgrade resolution.
