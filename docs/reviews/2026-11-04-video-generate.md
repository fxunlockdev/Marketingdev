# One-step video generation in chat

A clear video prompt now leads to a compact starting-image strip and one Generate video action. Duration comes from the prompt (five seconds if absent); optional settings stay collapsed. Selecting an image alone does not start generation. Generate records the user's explicit authorization for that exact saved prompt, reference, duration and format. The existing immutable video/marketing skills prepare and validate the plan, then the durable worker submits it through the configured Runway router. The browser may close before planning finishes.

Existing requests and editor-only users retain the script-review path. The new authorization cannot be forged by editors, changed after request creation, or used after the author's generation authority is revoked. Worker approval must match the initial validated skill plan exactly; manually edited drafts require review. Budget, reference reuse, duplicate submission, cancellation and final-publication review gates remain enforced. Script-validation retries retain the original authorization and server-derived idempotency key.

Migration 091 adds this authorization and restricts worker approval writes. It also corrects a prior publication-guard expression that could check customer-only function rights during a worker's completed-video attachment. The customer guard stays enforced inside an explicit customer-role branch.

Affected areas: chat video picker/styles, chat instructions, video request service/worker, database migration, browser and integration tests. No new provider credentials or model settings. New media remains a draft and is not published automatically.

Validation evidence: `docs/evidence/video-seamless-validation.json` and `docs/evidence/video-seamless-hosted.json`. These distinguish local mocked provider tests from hosted provider verification.

Live verification caught a Runway routing incompatibility for three-second image clips: the current route selected Wan 3, whose first-frame parameter mapping rejected the request. A no-charge dry run confirmed that three-second clips work with the router selecting Gen-4.5 at 720p when the complete skill prompt fits its input limit. New three-second requests therefore use a separate quality router profile excluding that incompatible route, with a schema-bounded complete prompt and beats; no text is silently truncated. Four-to-fifteen-second requests retain the existing 1080p profile. The provider still chooses the model. Existing stored provider intents retain their previous profile and request hash.

Reference: [Runway router generation and dry runs](https://docs.dev.runwayml.com/model-routers/generating/). Compatibility was checked against the live API; provider behavior may change independently of this deployment.
