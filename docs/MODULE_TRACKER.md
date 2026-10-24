# Desvio module tracker

Updated 24 October 2026. Guided local setup now wraps tested Railway activation and business allowance preview/apply; the operator web UI and live provider acceptance still remain. Billing is excluded by owner request. “Implemented” below describes code and local acceptance, not LIVE_VERIFIED or production readiness. Provider calls in local tests use explicit mocks. Owner will add credentials and perform live tests later.

Priority: usable dev onboarding → generation/editing → exact-version review → consented publishing. Advanced analytics and additional social channels are follow-up patches under the owner’s usable-release instruction. Historical session details remain in BUILD_STATE and Git history.

Dev: https://desvio-dev-web-dev.up.railway.app. API/web deployments and the current private worker are verified; database is through migration 048. Actual owner sign-in, queue registration, antivirus scanning, private storage readback and tenant denial passed in dev.

| Module | Implemented and tested scope | Remaining before full acceptance |
| --- | --- | --- |
| Shared foundation | Password sessions, default three businesses, business scope/RLS, private media, durable queue/worker, restricted service roles | Full local security suite passes; comprehensive deployed tenant flows, operational hardening and release gate |
| Overview | Business switcher and persisted publishing/approval/activity counts; saved results and reviewed recommendations | Real provider-derived metrics/learning and deployed customer journey |
| Brands & onboarding | Website/document ingestion, visual evidence, proposed brand facts, correction and approved Brand Brain | Deployed manual onboarding/fact approval passed; real AI-prefill acceptance, deployed crawler/document coverage and quality evaluation; no paid test performed |
| Content Plan | Configurable days/posts, OpenAI/Gemini planning, calendar edits, recurring planning with limits and approval, Canvas linkage | Provider activation and actual model output/loop acceptance |
| Review Inbox | Channel-based review, feedback, exact image/video/carousel versions, approval invalidation after edits | Broader deployed customer flow and real generated-media acceptance |
| Canvas | Brand-guided planning, static image creation/editing, editable projects, video storyline/script/prompt approval before generation, video editing/rendering, carousels and ZIP download | Provider keys, business allowances and video runtime activation; real image create/edit and video create/edit acceptance |
| Publishing & Analytics | Approved static/video/carousel → ordered upload → one LinkedIn submission → status reconciliation; uncertainty holds; saved metrics and format filters | Consented publishing; other channels; remote cancellation/rescheduling and unresolved-outcome operations |
| Memory | Business-specific approved knowledge, evidence-linked performance hypotheses, human review, retirement and experiment reports | Actual model/performance acceptance and broader learning quality evaluation |
| Connections | Tenant-isolated Postiz binding/provisioning and LinkedIn member OAuth; identity-bound reconnect and durable disconnect/recovery deployed through migration 047; saved-account verification recovery additionally passes seven connection browser journeys and the expanded 179-case foundation suite; migration 048 and matching API/web/provisioner are deployed with actual dev queue/private-media checks | Postiz/provisioner deployment, actual enterprise identity and media delivery passed; actual consent and additional channels. Meta app alone is not proof those paths are complete |
| Team | Business-specific roles, invitations, escalation prevention and last-owner protection | Resend delivery for invitations; deployed multi-user acceptance |
| Profile | Name/password changes, session controls, authenticator/recovery flows; actual dev synthetic password/session/MFA/recovery acceptance passed | Resend reset/delivery flows and broader operational security hardening |
| Billing | Excluded | Not part of this goal's current scope |

## Current release evidence — 24 October 2026

Latest source `2bc63ec`: full browser **42/42**, foundation **179/179**, account **29/29**, six security boundaries, dependency audits, offline and contract checks pass. Migration 048 and API/web/both workers are deployed. Actual owner login, retained navigation, private media upload → durable queue → malware scan → readback, replay and cross-business denial passed, with exact test cleanup. See `railway-recheck-release.json`, `browser.json`, `security.json` and `BUILD_STATE.md`.

Release remains blocked by the trusted live acceptance runner and actual provider/tenant acceptance. The M0 hard-coded live gate is still present and must be replaced with real, budget-guarded execution evidence. Missing-credential provisioning outcomes, remote publication cancellation/rescheduling, other social channels and operator setup web UI remain open; do not call these “100%”. Billing remains excluded.


- API `31a66e24-33b7-4223-a820-cb0c9d66c0d2` and web `15ec6a27-9c36-4c37-b19a-299700bc752d`: SUCCESS observed in Railway.
- Trusted worker `sha256:3363e29ed1a64af85dbeb219e74eaaa73d97d1809dd1225bcd3a66878978cdaf`: native dependency/isolation checks and coordinated activation passed. The separate provisioning worker is updated to this image too.
- Migration 047 is checksum-verified; temporary migration service credentials were removed.
- Patched full security run: 29 account tests, 176 foundation tests, six Python boundary tests, API build and both production dependency audits pass. Root production audit reports zero vulnerabilities after pinning patched body-parser/multer versions.
- Six connection browser, nine publishing browser and 17 publishing backend cases passed with MOCK provider transports. The complete browser suite also passed all 40 journeys after the dependency patch (`browser.json`); this does not establish real OAuth or model acceptance.
- Actual dev owner login/navigation: retained shell, zero repeated workspace bootstrap calls, no full-page reload. Evidence: `railway-recovery-browser.json`.
- Actual dev storage/worker scan/readback, replay and cross-business denial passed; fixtures were cleaned. See `railway-worker-job-patched047.json` and its cleanup record.
- Offline and 93 target-selected provider/input contracts pass. Integration status is machine-generated; the release gate remains blocked until its outstanding acceptance requirements are met.

## Remaining product work

1. Operator setup web UI and safe unresolved-outcome recovery controls. The guided local setup already configures saved Railway settings and per-business allowances without hand-written integrations.
2. Durable cancellation/rescheduling after a post has reached Postiz. Existing cancellation is limited to requests before submission; uncertainty never means cancellation succeeded.
3. Meta and other social connectors beyond LinkedIn member. A Meta app alone does not complete these integrations.
4. Comprehensive deployed provider acceptance, load/operational hardening and production release evidence. Advanced analytics/learning quality remains unverified with real data.

## Owner configuration and live acceptance

Owner will add server keys and run paid tests. Keys go in Railway **dev → desvio-dev-worker-settings → Variables**. Saved settings require coordinated worker activation and explicit business/model allowances; video also needs its approved model/output configuration. See `OPERATOR_PROVIDER_SETUP.md` for the exact guided sequence. A key by itself does not enable spending.

Real generation/editing, authorized social consent/publishing and real analytics must pass before LIVE_VERIFIED. Resend remains required for public signup, password-reset email and team invitation delivery. Private owner password login is available. No paid provider or real social call was made during this release.

## Cost constraint

Keep existing Railway services and capacity. Reduce duplicate requests, hidden/idle polling and unnecessary deployments/transfers. The security worker patch reused existing media images and transferred 294 MB instead of the earlier 1.7 GB bundle. No infrastructure was removed to lower cost.

- Latest web-only follow-up: all 16 customer browser cases pass, including repeated canceled/accepted Back and Forward with dirty forms. Actual dev temporary unsaved draft acceptance passed with zero profile writes and retained shell (`railway-history-guard.json`). Earlier full 40-browser/security evidence belongs to the preceding release; this focused check does not claim fresh full-suite or live-provider verification.
