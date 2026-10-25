# Desvio module tracker

Updated 22 October 2026. Scope remains all eleven modules in the owner's V5 handoff, with the original architecture and up to three businesses per standard account.

**Status definitions:** Implemented = backed by code and persistent state. Tested locally = specific flows proved against local services; paid upstream mocks are identified. Deployed = the exact running Railway build has been checked. Live verified = genuine authorized provider/OAuth calls succeeded. Complete = the full module's specified scope and applicable launch gates pass. A screen or a passing mocked test is not completion.

## Modules

| # | Module | Implementation and local evidence | Deployed / live | Next acceptance requirement |
|---|---|---|---|---|
| 1 | Overview Dashboard | Business-aware shell, selector and actual account/business records implemented and previously tested; summary not complete | Not deployed | Real approvals, jobs, publishing, usage and performance aggregates |
| 2 | Brands & Onboarding | Three steps; server-enforced three-business cap; actual Crawl4AI/desktop/mobile Chromium and PDF/PPTX embedded-text extraction; Correct/Wrong/Edit and approved Brand Brain; AI prefill adapter tested with MOCK provider | Public crawl smoke only; no paid semantic/visual quality verification or deployed app | Approve visual references, document vision, live extraction quality, first plan and cloud sandbox |
| 3 | Content Plan | Saved month/7-day/list calendar, business-timezone dates, scoped channels/counts, real 30-day planning and slot-linked Canvas creation. Actual skills/Temporal/storage with MOCK OpenAI; 124 final source-bound checks pass, zero skips | Not deployed | Drag/calendar exports and bulk review submission, cloud deployment and live planning quality |
| 4 | Review Inbox | Channel-header inbox, 1/7/30-day periods, saved previews/captions, feedback/revision jobs, exact-version approval, explicit attach-latest and confirmed atomic bulk approval. Backend/browser tests pass locally; 124 final source-bound checks pass, zero skips | Not deployed | Connected account identities, video/carousel previews, undo review and deployed/live acceptance |
| 5 | Canvas — AI Creative Studio | Real isolated owner skills, official OpenAI create/edit adapters, persisted conversations/private images, Fabric text editor, immutable versions and approvals. Canonical private PNG export and exact-image approval implemented; eight focused backend tests and all 14 browser journeys pass; full security regression blocked by local Docker disk exhaustion | No real paid model calls; not deployed | Approved brand visual references, deployed canonical exports, broader formats/carousels, Higgsfield/FFmpeg, live quality tests |
| 6 | Publishing & Analytics | Postiz source/SDK contracts audited; customer publishing/metrics workflow not implemented | Internal Postiz service exists; runtime/source equivalence unverified | OAuth-safe mapping, approved canonical asset upload, schedule/publish/reconcile, actual metrics |
| 7 | Memory | Approved facts/provenance implemented and previously locally tested | Not deployed | Creative preferences, evidence-backed learning and approved recommendations |
| 8 | Connections | Encrypted per-business binding, admin-only refresh API, durable Temporal account snapshots and strict transport implemented; 10 MOCK HTTP contracts and 7 real local refresh integration tests pass; session-bound LinkedIn authorization/callback backend passes 10 additional integration tests (17 combined social tests), with MOCK upstream. Automatic private account setup and restricted worker pass nine additional local tests (26 combined social tests) | No connected test socials; no live token health proof | Operator resolution of uncertain setup, customer callback/connection UI, account selection/reconnect/revoke and live acceptance |
| 9 | Team Management | Account-level invitation/roles backend and selected-business isolation tested locally | Not deployed | Full V5 business-specific invitations, role UI, reviewer/publisher permissions and activity |
| 10 | Billing & Usage | Actual business entitlement plus conservative model-spend reservations | No payment integration | Subscriptions, generation credit settlement, invoices, provider cost reconciliation and UI |
| 11 | Profile Management | Real identity display, verification and password recovery implemented/tested locally | External delivery unverified | Profile edits, session management, supported MFA and notification/account lifecycle controls |

Current checkpoint b1d969d: offline (3), contracts (39) and focused social (15 repeated contracts + 26 integration tests) pass against the same unchanged source. Full security/browser evidence is failed or stale for this source; the security document-image rebuild remains blocked by local Docker storage. Earlier export/browser passes are historical evidence. No full module is marked production-complete. `docs/evidence/integration-status.json` is generated by verification and is authoritative for tested capability states. Per-control scope is in `docs/UI_CONTROL_MATRIX.csv`.

## Shared services and integrations

| Service | Evidence and remaining work |
|---|---|
| Better Auth / Postgres / business isolation | Real local sessions, recovery, forced RLS and concurrent quota tests. Railway app database roles/migrations and deployed behavior still require setup/verification. |
| Private S3 media / malware validation | Real local signed storage, validation, access denial and replay tests. Production bucket/IAM/CORS/retention not ready. |
| Temporal / workers | Real local dispatch, retry/cancel and worker recovery; creative paid calls reserve once and hold uncertain results. Cloud worker/runtime isolation remains incomplete. |
| Crawl4AI / Docling | Real bounded local executables. Rich website screenshots/design sources captured; document path is embedded text. Production sandbox and broader quality coverage remain open. |
| Deep Agents + 52 original skills | Archive audited; selected original image/social/product-marketing/ad-creative skills actually execute in an isolated per-job runtime. The original marketing-plan skill also runs for 30-day planning. Other workflows still need integration. |
| OpenAI | Official brand/vision, 30-day planning and image create/edit adapters and MOCK contracts; no LIVE_VERIFIED results. Server keys, selected eligible models, funded cap and explicit test authorization needed before paid validation. |
| Higgsfield | SDK submission contract audited with MOCK transport. Async product workflow, cancellation/reconciliation and private asset capture remain to implement. |
| Postiz | Internal service provisioned; strict transport and durable business account refresh tested locally against MOCK Postiz. Customer OAuth/publishing/reconciliation still missing. Source/container equivalence and license obligations unresolved. |
| Railway | CLI and MCP authentication confirmed 22 October; existing supplied project accessible. Fresh dev environment creation still rejected “Deploys have been paused temporarily”; read-back lists only production. Existing Railway secrets require review/rotation. Dev application/domain not deployed. |
| Email / payments | Local SMTP tested. Real email sender and payment provider/configuration still required. |

## Execution order and owner handoff

Canvas verification is complete for the current local scope (PR #8); the initial plan/review backend is tested in PR #9. Calendar/channel reviews and Canvas slot linking now work locally with MOCK provider transports. Continue canonical exports and private deployment while Railway restores deployments; complete the deployable private runtime and deliver the Railway dev application, then connections/publishing, Higgsfield/video, analytics/learning and remaining account modules. Keep the tracker updated each work session; no architecture replacement.

Keys are necessary for live acceptance before calling a module complete. Provide them in service secret settings, with eligible model IDs, funded budget/cost cap and allowlisted staging accounts; never paste secrets into chat. Meta app setup can proceed in parallel for Facebook/Instagram. Other social networks have their own app/account permissions. No social publish or paid live test is authorized merely by adding a key.

Today's target is a usable, honestly scoped dev build and further module implementation. Full end-to-end production completion today is not established by current evidence.
