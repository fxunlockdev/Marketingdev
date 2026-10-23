# Desvio module tracker

Updated 24 October 2026. Guided local setup now wraps tested Railway activation and business allowance preview/apply; the operator web UI and live provider acceptance still remain. Billing is excluded by owner request. “Implemented” below describes code and local acceptance, not LIVE_VERIFIED or production readiness. Provider calls in local tests use explicit mocks. Owner will add credentials and perform live tests later.

Priority: usable dev onboarding → generation/editing → exact-version review → consented publishing. Advanced analytics and additional social channels are follow-up patches under the owner’s usable-release instruction. Historical session details remain in BUILD_STATE and Git history.

Dev: https://desvio-dev-web-dev.up.railway.app. API/web deployments and the current private worker are verified; database is through migration 046. Actual owner sign-in, queue registration, antivirus scanning, private storage readback and tenant denial passed in dev.

| Module | Implemented and tested scope | Remaining before full acceptance |
| --- | --- | --- |
| Shared foundation | Password sessions, default three businesses, business scope/RLS, private media, durable queue/worker, restricted service roles | Full local security suite passes; comprehensive deployed tenant flows, operational hardening and release gate |
| Overview | Business switcher and persisted publishing/approval/activity counts; saved results and reviewed recommendations | Real provider-derived metrics/learning and deployed customer journey |
| Brands & onboarding | Website/document ingestion, visual evidence, proposed brand facts, correction and approved Brand Brain | Real AI-prefill acceptance, deployed crawler/document coverage and quality evaluation; no paid test performed |
| Content Plan | Configurable days/posts, OpenAI/Gemini planning, calendar edits, recurring planning with limits and approval, Canvas linkage | Provider activation and actual model output/loop acceptance |
| Review Inbox | Channel-based review, feedback, exact image/video/carousel versions, approval invalidation after edits | Broader deployed customer flow and real generated-media acceptance |
| Canvas | Brand-guided planning, static image creation/editing, editable projects, video storyline/script/prompt approval before generation, video editing/rendering, carousels and ZIP download | Provider keys, business allowances and video runtime activation; real image create/edit and video create/edit acceptance |
| Publishing & Analytics | Approved static/video/carousel → ordered upload → one LinkedIn submission → status reconciliation; uncertainty holds; saved metrics and format filters | Consented publishing; other channels; remote cancellation/rescheduling and unresolved-outcome operations |
| Memory | Business-specific approved knowledge, evidence-linked performance hypotheses, human review, retirement and experiment reports | Actual model/performance acceptance and broader learning quality evaluation |
| Connections | Tenant-isolated Postiz binding/provisioning and LinkedIn member OAuth workflow tested with mocks | Postiz/provisioner deployment, actual enterprise identity and media delivery passed; actual consent, full reconnect/disconnect lifecycle and additional channels. Meta app alone is not proof those paths are complete |
| Team | Business-specific roles, invitations, escalation prevention and last-owner protection | Resend delivery for invitations; deployed multi-user acceptance |
| Profile | Name/password changes, session controls, authenticator/recovery flows | Deployed security acceptance; Resend for reset/delivery flows |
| Billing | Excluded | Not part of this goal's current scope |

## Current evidence

- `docs/evidence/railway-dev-migration046.json`: actual checksum-verified migration and runtime role login checks; temporary bootstrap removed.
- `docs/evidence/railway-dev-owner-browser.json`: actual public dev owner sign-in/session/business screen.
- `docs/evidence/railway-worker-rollout.json` and `railway-worker-job-carousel046.json`: exact deployed worker, queue/role registration, actual storage/scan job, replay and foreign-scope denial. Synthetic fixture cleanup recorded separately.
- `docs/evidence/carousel-publication-backend.json`: 17 real local publication/security/recovery cases with MOCK Postiz.
- `docs/evidence/carousel-publishing-browser.json`: nine local image/video/carousel publishing browser journeys with MOCK Postiz; accessibility/mobile checks.
- `docs/evidence/contracts.json`: 89 passing provider/input/media contracts at the recorded source snapshot.
- `docs/evidence/security.json`: passed at unchanged source on 23 October, with 29 account cases, 169 foundation cases, six Python boundary cases and both production dependency audits. Scanner readiness now allows bounded slower emulated startup and preserves failure diagnostics. All 37 full browser journeys also pass at this same source.

## Immediate sequence

1. Complete: full browser (37 journeys), security (29 account + 169 foundation + six boundary cases), offline and contracts pass at the prior recorded source. The newer operator-only change has focused acceptance. Release remains blocked on comprehensive product/deployed-provider/live acceptance.
2. Implemented: Railway list/preview/apply for model/spending allowances, with four contracts and eight real local database cases passing plus actual read-only dev acceptance. Explicit video settings and read-only worker readiness are now implemented (eight configuration/readiness contracts + eight database cases). Coordinated activation now has 15 contracts + eight database cases and actual API renderer-pin/redeployment acceptance. Continue operator UI/recovery usability and core Postiz setup; provider-enabled worker replacement remains unverified. Keys are added to Railway dev → desvio-dev-worker-settings; a key alone does not apply allowances or restart the worker.
3. Complete core connection/publishing activation, refresh release evidence, and deploy changes. Additional channels and advanced analytics follow the usable core release.
4. Owner adds credentials and authorized test accounts/budgets, then live generation/editing/publishing acceptance can establish LIVE_VERIFIED status. No paid tests or posts will run merely because a key exists.

### 2026-10-24 deployment plumbing evidence

Private Postiz application deployment is SUCCESS; backend/orchestrator health and two actual enterprise identities passed. Desvio adapter rejects crossed organization bindings. Dedicated provisioner queue/database-role checks pass. Public web media route is deployed and actual Postiz upload → Desvio hash/HEAD/range delivery passed. Coordinated social/provisioning activation passed, including worker registration and exact healthy API redeployment. Owner browser sign-in passed. Publishing/video remain disabled. No OAuth account, model spending or live generation/publication acceptance is implied.

- `railway-provisioning-job.json`: actual scoped business submission → durable outbox/Temporal → isolated provisioner → real Postiz identity → encrypted binding passed, including replay and foreign-scope denial. This is service-level deployed acceptance, not a browser OAuth/publication claim.

- OAuth readiness is now separate from encryption/provisioning: the customer flow remains unavailable until explicit social app activation. Ten configuration tests and 27 local database/queue tests passed, including rejection without creating a job when OAuth is disabled. Remote OAuth remains unverified.

- Scheduled-removal transport is implemented and passes MOCK contracts. It reports only an unconfirmed removal request. Durable remote cancellation, UI controls, race handling and actual social acceptance remain incomplete.

- Fixed visual onboarding setup: `max_tokens_per_image` can now be explicitly configured through the guided/atomic operator path. Previously the tool could not enable screenshot analysis. 28 configuration and nine database tests pass; no live allowance or model call was enabled.
