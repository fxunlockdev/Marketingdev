# Canvas video: review the prompt before generation

Status: local implementation; paid-provider responses in tests are MOCK. Full Canvas and the product are not complete.

## Customer flow

An approved saved image exposes **Make a video from this approved image**. The user requests a 3–15 second video. Original video/ad-creative/product-marketing/social skills produce a script, prompt, caption and overlays from the approved business context. Text planning can consume its configured allowance; no Higgsfield submission occurs yet.

The Videos section lets editors save changes. Only an owner/admin can approve the exact draft and authorize generation. The worker freezes that approved draft when reserving the provider request. It includes edited scene/camera directions in the provider prompt, composes approved text overlays, validates/re-encodes downloaded output and saves private clips/posters. Final video approval is a separate action on exact saved bytes and revision. It does not publish anything.

Feedback creates another prompt-gated request in the same project. Old versions remain available. Static generation retains its direct generation behavior; it does not acquire the video prompt gate.

## Boundaries

- Migrations 023 and 024 enforce business scope, immutable media identity, reference approval, encrypted temporary reference leases and review records.
- The app uses `VideoReferenceBindings`; worker credentials and decrypted provider links are not available to customer requests or skill context.
- Generation and continuation use Temporal. Human approval waits periodically continue as new executions to bound workflow history. No implicit approval occurs on timeout.
- Request and provider identities are durable. Uncertain provider submissions stay held. Temporary reference copies are removed after completion/cancellation; the original approved image is preserved.
- Prompt edits conflict after paid preparation. Exact prompt approval is rechecked inside the preparation transaction. Media download and rendering retain existing network/size/container restrictions.
- Customer preview verifies private media hash before creating a browser blob URL. CSP allows blob media; provider URLs and keys never reach the browser.

## Opt-in configuration

API and worker: `VIDEO_ENABLED=true`. API also needs the existing pinned `RENDER_RUNTIME_IMAGE` to validate approved image provenance. It does not need Higgsfield credentials or worker database access.

Worker: `VIDEO_RUNTIME_IMAGE` (exact local digest), `VIDEO_ENCRYPTION_KEY` (independent 32 random bytes encoded as hex), `HIGGSFIELD_CREDENTIALS` (`key:secret` per the existing verified adapter), and `HIGGSFIELD_OUTPUT_ORIGINS` (explicit comma-separated HTTPS origins). Existing static/skill images, private storage, Temporal and OpenAI configuration remain required. Expiring business-specific text/video grants and caps are still required; enabling a flag does not authorize unbounded spend. The operator setup interface remains unfinished.

## Verification

`make verify-video-canvas` records the actual export/video backend and Canvas/calendar browser suites in `docs/evidence/video-canvas.json`. It exercises actual local PostgreSQL/forced RLS, private object storage, original skills, media containers, Temporal and UI. Paid OpenAI/Higgsfield transports are explicitly simulated. No staging or launch readiness is implied.

## Remaining scope

Gemini selection, unified conversational/custom-duration planning, mixed video/calendar attachment and review, recurring planning, video publication, richer video edits/composition, deployment and authorized live quality/failure acceptance remain open. Runway is deferred by the owner.
