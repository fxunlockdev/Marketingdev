# ADR 0020 — bounded Higgsfield video transport

Date: 2026-10-22. Implementation in progress; no live provider calls or video UI enabled. This refines the Higgsfield transport decision in ADR 0001 without changing the Nest/Temporal/private-storage/Deep Agents/Postiz architecture.

## Verified contracts and dependency

The lockfile retains `@higgsfield/client@0.2.6`, imported through `/v2`. Inspected `dist/v2/client.js`, `dist/config.js` and `dist/utils/retry.js`. The V2 client sends the input object directly, supports per-instance credentials and custom headers (including `Idempotency-Key`), and returns a request receipt when `withPolling:false`. It has no public status/cancel method. Its automatic polling omits the documented `canceled` terminal state.

SDK V2 source SHA256: `015d9dd7c702927c9a12e993b704814c4514e7b75f7123d6319c448104b64aa9`. Config source: `766d9d3eb9bf055e115917f73ec386f250155683237483dca1046e0633cbe26a`. Retry source: `b60b8f731a159bacfd0bb24b849f64c4eeb5d58b86c84f5a9226af04b472ed92`. No dependency upgrade or vendor patch.

Official pages inspected:

- [Kling 3 Standard image-to-video](https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference): model `kling-video/v3.0/std/image-to-video`, `image_url`, optional prompt, integer duration 3–15, sound on/off, CFG scale, multi-shot options. Initial adapter supports one owned reference, explicit duration/sound, CFG 0.5, multi-shot false. These are deliberate bounded product settings, not inferred provider defaults.
- [Kling O3 edit](https://open.higgsfield.ai/models/kling-video/o3/video-edit/api-reference): model `kling-video/o3/video-edit`, required prompt and `video_urls`, optional mode std/pro/4k, images/elements. Initial adapter sends one owned prior-video URL and explicit quality. Input duration/resolution/byte limits are not specified on this public schema; account-compatible limits and actual editing behavior remain unverified. No claim of timeline or lossless editing.
- [Requests](https://docs.higgsfield.ai/docs/concepts/requests), [status](https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status), [cancel](https://docs.higgsfield.ai/docs/api-reference/requests/cancel-a-queued-request): fixed `/requests/{uuid}/status` GET and `/cancel` POST. Cancel is available before processing, returns empty HTTP 202; processing may race it and produce 400. Acknowledgement still requires authenticated status reconciliation and is not refund evidence.
- [Idempotency](https://docs.higgsfield.ai/docs/concepts/idempotency): submissions accept `Idempotency-Key`; identical intent replays return the original ID, even after completion. Endpoint, body, webhook and exact URL must remain unchanged. Parameter changes produce 422, which must never trigger a fresh key automatically. An acceptance receipt can still say queued after the request finished; always fetch current status.
- [Errors](https://docs.higgsfield.ai/docs/concepts/errors): synchronous rejection differs from terminal failure; do not parse human-readable provider messages for permanent decisions. Failure/refund documentation is not proof of account settlement. [Uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads) documents provider-upload URLs; this adapter does not implement uploads or send credentials to media storage.
- [Webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks) does not establish a verified signature contract. No webhook route is enabled. Polling remains authoritative.

These are publicly documented candidates, not evidence that the operator's account can access either model. Rates, credits, geographic availability, provider retention and actual output quality require staging verification; no promotional price was hardcoded.

## Transport decision

Use official documented HTTP contracts in `apps/api/src/higgsfield-client.ts`. The JS SDK builds a private Axios instance with only base URL, timeout and headers; it does not expose per-instance redirect controls or bounded response reading. A local MOCK test demonstrates that its 307 redirect follows with the submitted reference and same-origin credentials. Avoid monkey-patching global Axios state or creating a credential-bearing proxy solely to work around that interface. SDK parity tests still compare the actual pinned SDK's serialized create/edit bodies with our adapter.

The adapter fixes the credential origin to `https://api.higgsfield.ai`, denies redirects, caps JSON at 64 KiB, bounds request/body time, validates model/UUID/state and sanitizes upstream errors. Only test mode may use an explicit loopback MOCK origin. Production remains disabled. Input origins are operator-configured exact HTTPS origins; the future job must additionally prove ownership, tenant authorization, media integrity and a live funded grant. Origin checking alone is not ownership authorization.

Every method makes exactly one call. Submission requires a caller-supplied UUID key and a matching request fingerprint. Receipt parsing preserves a valid ID independently of provider status; returned API URLs are never used. Status checks require matching IDs and known states. Output URLs are untrusted locators and never treated as private assets. Missing status and lost writes remain errors. A 422 rejection does not establish that no earlier generation used the same key.

## Output boundary

`apps/api/src/video-download.ts` uses existing `SafeWeb`: validated public DNS answers, address-pinned connection with ordinary TLS verification, no redirects, no provider credentials, 64 MiB maximum and the existing 15-second transfer deadline. An operator must allowlist actual observed output CDN origins. HTTPS, exact origin, MIME, encoding, size and declared length are checked. Errors omit signed URLs.

The result is explicitly `untrusted_video`. Bytes can pass the download checks without being decodable MP4. No asset is persisted, exposed, approved or published by this helper. Isolated full decoding/re-encoding, dimensions/duration/codec/audio limits, antivirus where required, private persistence and exact-output approval remain mandatory downstream work. Host FFmpeg is installed but was not used to parse remote material or bypass isolation.

## Tests and scope

`tests/contracts/higgsfield.test.mjs`: 25 MOCK HTTP/SDK tests including exact image/edit bodies, private configuration, immutable input fingerprint, malformed receipt/status, six states, cancellation races, 401/403/429/5xx, timeout/socket loss, bounded invalid/slow JSON, redirect denial, SDK redirect behavior and explicit same-key replay semantics. `tests/contracts/video-download.test.mjs`: five focused output-boundary tests including real SafeWeb private/mixed-DNS denial. No paid credentials, genuine provider output or database workflow is exercised.

`make verify-contracts` runs these tests with existing contracts. Generated evidence exposes a separate `higgsfield_transport` capability. `higgsfield_video` remains incomplete. No tenant migration, API route, customer control or worker registration was added in this checkpoint; no full module completion is implied.

## Next implementation and external prerequisites

1. Execute the audited original video/ad-creative skills against an immutable approved Brand Brain; validate storyboard, references and edit-parent lineage.
2. Add forced-RLS video jobs/grants/reservations and immutable remote intent. Commit key, body hash and exact encrypted signed reference before network submission. Never regenerate a signed reference URL during an uncertain replay. Build an appropriate scoped reference lease; the current generic 60-second download URL is not a durable video-reference contract.
3. Persist remote IDs, durable Temporal polling/recovery, cancel races, permission revocation and bounded retry/deadline policy. Unknown submissions retain their budget reservation. Provider idempotency must be verified with explicit authorized live evidence before relaxing conservative unknown holds.
4. Implement network-disabled FFmpeg validation/composition, private output recovery, immutable edit versions, human review and then Canvas controls. O3 source-media eligibility is unresolved; do not accept arbitrary long uploads based only on the public parameter list.
5. Deploy the actual private runtime, then request server-side staging keys, eligible model IDs, funded rate/cost caps and explicit test authorization. Railway upstream pause and pending local Docker expansion permission remain external blockers; neither justifies exposing an unfinished workflow.
