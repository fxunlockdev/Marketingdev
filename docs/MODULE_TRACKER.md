# Desvio module tracker

Updated 24 October 2026 after the onboarding compression fix. Billing is excluded by owner request. The owner confirmed that Meta developer setup and social-account authorization are their dependency. That does not make unfinished connector code or untested publishing complete.

**Onboarding test fix:** Website compression failure reproduced and fixed for gzip, Brotli and deflate. Actual Lodha HTTP reading passes inside the deployed worker; specific failure stage/cause/recovery and error reference pass an authenticated deployed UI check. See [crawl evidence](evidence/website-deployed-crawl.json) and [error UI evidence](evidence/website-error-ui.json). Owner must retry the failed job; live AI output remains unverified. Broader development is paused for test fixes.

**Dev self-testing is enabled:** https://desvio-dev-web-dev.up.railway.app. Database migrations are through 057. Final API deployment `c9315e1f-355e-49ae-8151-0f670434c167` and web deployment `3b31e237-cc52-4368-a175-58f0ec0cc197` are deployed. Trusted worker runs `sha256:a506423f2a665f0405ab5156f76832b6c67f8cf905d15521e999f448643e7cbe`; isolated provisioner retains `sha256:546abb792932c8609233bcc50e2d2b444015fae72116148868df848f8e264a76`. Saved keys are active, video is enabled, and owner-workspace defaults automatically provision new businesses. No additional key entry or manual per-business setup is required for that workspace.

This is enabled-for-testing status, not successful live generation or production acceptance. The owner will perform paid tests. No agent-run paid model request or social post has been made. Evidence: [video self-test release](evidence/railway-video-self-test-release.json), [security](evidence/security.json), [build history](BUILD_STATE.md).

| Module | Implemented/deployed scope | Still required for full acceptance |
| --- | --- | --- |
| Shared foundation | Password sessions; default three businesses; business scope/RLS; private media; durable queue; isolated worker/provisioner. Actual deployed login, private upload/scan/readback, replay and foreign-service denial pass. | Comprehensive deployed multi-user/provider isolation, load/recovery hardening and full release gate. |
| Overview | Business switcher; persisted approval, publishing and activity counts; saved reviewed recommendations. Empty state has no fabricated metrics. | Actual business/model/social data acceptance. |
| Brands & onboarding | Three-step website/document intake; rendered visual evidence; editable proposed facts; approved Brand Brain; business stage and growth target; logo/product/guideline uploads. GPT defaults now applied automatically for newly created owner businesses. | Owner live AI-prefill/quality test; broader site/document coverage, including scanned-document limitations. |
| Content Plan | GPT-only planning for configurable days/posts; calendar/weekly views; recurring planning limits; Canvas linkage and human review. | Actual model output, loop and day-by-day customer acceptance. |
| Review Inbox | Channel-based review; feedback; exact image/video/carousel versions; approval invalidation after edits. | Full deployed journey with genuine generated assets. |
| Canvas | GPT text planning and GPT Image creation/editing; editable projects; video script/prompt editing and approval before Higgsfield; feedback/regeneration and final review; carousels/exports. Approved uploaded photos can be video references without first generating an image. Skills and Brand Engine are pinned in the isolated runtime. | Owner live image create/edit and video generation/regeneration tests; broader output quality. No LIVE_VERIFIED claim from mocks. |
| Publishing & Analytics | Exact-approved image/video/carousel publishing pipeline, durable submission/reconciliation and uncertainty handling. LinkedIn member, Instagram single-image/Reel paths implemented; saved metrics and format filters. | Owner Meta app/account consent; actual publication/metrics tests; Instagram carousel renditions, other connectors, durable remote cancel/reschedule and unresolved-outcome operations. |
| Memory | Business-specific approved knowledge, creative history and evidence-linked performance hypotheses with human review/retirement. | Actual model/performance data and learning quality evaluation. |
| Connections | Hidden Postiz provisioning, scoped bindings, LinkedIn member/Instagram connection paths, identity-bound reconnect, durable disconnect, saved-credential verification recovery. Deployed private Postiz health and provisioner queues verified. | Owner app/account authorization; missing-credential ambiguous provisioning recovery; other connectors and live consent acceptance. |
| Team | Business-specific roles, invitations, escalation prevention and last-owner protection. | Resend delivery configuration/testing and deployed multi-user acceptance. |
| Profile | Name/password/session controls, authenticator and recovery flows; earlier deployed synthetic acceptance recorded. | Resend password-reset delivery and broader operational hardening. |
| Billing | Excluded. | Outside this goal's scope. |

## Current evidence

- Latest frozen security run passed with `source_unchanged=true`; offline and contract gates passed.
- Video/export backend tests: 15 pass. Full contract suite: 151 pass, plus focused worker-host/settings checks. Paid provider responses are mocked in these tests.
- Actual deployed owner login and retained navigation pass; private asset job, scanning, canonical/normalized readback, replay and foreign-service denial pass. Acceptance fixture and three objects removed.
- Full browser refresh is running in `work/video-enabled-browser.log` (exec session 89640). Previous suites cover customer, Canvas, connections and publishing, but their older fingerprints are not current release proof. Reconcile the active process before starting another browser run; do not rebuild `.next` during it.
- Release gate remains blocked for broader browser/live acceptance and the incomplete trusted full-product live runner. Do not replace that gate with manually asserted success.

## Remaining engineering work

1. Finish the current browser run and repair genuine failures; keep complete journey evidence current.
2. Complete the missing publishing/recovery capabilities identified above using verified Postiz contracts; never report uncertain cancellation as stopped publishing.
3. Finish operator setup UX, comprehensive deployed tenant/provider acceptance and operational hardening.
4. Integrate the owner's live-test results and resolve provider/account errors without automatically repeating uncertain paid calls.

## Owner-dependent acceptance

- Paid model tests and provider account entitlement/funding: owner will test using saved keys.
- Meta developer app, social permissions and explicit account consent: owner dependency acknowledged 24 October. OAuth/publishing remain disabled until configured and authorized.
- Resend sender credentials: still needed for public verification/reset/invitation delivery; temporary owner password login is usable.

Keep existing Railway service capacity. Optimize repeated requests, idle polling and deployment transfers. No infrastructure reduction was authorized.
