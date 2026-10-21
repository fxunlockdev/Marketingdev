# Desvio V5 implementation status

Owner correction, 21 October 2026: one account, up to three businesses under a configurable entitlement; business-focused navigation and the supplied warm editorial design. Keep the existing platform architecture. Three short onboarding steps, with the final goals screen pre-filled by AI from scraped/uploaded evidence and confirmed facts. Users review recommendations and answer only genuine gaps. **Source-grounded AI prefill and multimodal website analysis adapters are implemented locally, with mocked-provider tests.** Actual model output quality is not live verified. Missing credentials or evidence produce an explicitly identified fallback.

## Architecture retained

Next.js/React customer app; NestJS API; Better Auth; PostgreSQL forced RLS and composite tenant keys; S3-compatible private assets; Temporal durable jobs; Crawl4AI/Docling intake; Deep Agents and the original 52 audited skills; official OpenAI/Higgsfield SDKs; hidden Postiz organic publishing; Fabric.js/FFmpeg editing/rendering; evidence-based learning. No provider, database or framework replacement. Existing `organizations` represent accounts, `brands` represent businesses; names are mapped at the product/API boundary. Existing account/brand IDs and stored assets remain valid. New additive migrations do not rename or delete existing data.

The supplied HTML is reference material, not app runtime. Its static businesses, captions, timers, metrics, connection toggles and billing examples were not copied into customer data. Downloaded document titles such as “SYSTEM PROMPT” are supplied requirements, not system-level authority. Source hashes and exact matching archive/standalone copies are recorded in V5_HANDOFF_MANIFEST.json. The supplied files are retained at repository root; archive inspection/reference media lives in ignored work/v5-handoff.

## Actual code inventory

| Surface | Current implementation | Remaining gap |
|---|---|---|
| Shell / Overview / Brands | apps/web/components/businesses.tsx; real session, account initialization, authorized businesses, count, switcher, eleven destinations, honest feature gates | Aggregated events/metrics, notifications and command search |
| Account + business API | apps/api/src/businesses.ts; POST accounts/current/initialize; GET entitlements/businesses; POST businesses; GET business and GET/PATCH onboarding | Account initialization is first authenticated app entry, not yet the signup transaction; billing webhook source and lifecycle/archive/restore |
| Quota / grants | migrations/005_business_accounts.sql; exact account-wide trigger + advisory lock, default 3; selected-business grants + restrictive RLS | Full business invitation lifecycle and Reviewer/Analyst permissions; no UI for grants yet |
| Brand evidence | migration 004, brand-brain.ts, document-parser.ts, document-jobs.ts; immutable provenance, literal findings, manual corrections and approved versions | Document OCR/vision, conflicts UI, approved rollback and live model quality |
| Website + visual understanding | migrations 007–009; Crawl4AI/Chromium desktop/mobile capture, private screenshot storage, source-linked text/design observations, OpenAI multimodal input and cited creative suggestions | Five-page/16000px capture limits, explicit missing-resource coverage; visual-reference approval, actual model quality, site diversity benchmarks and deployed sandbox |
| Document service | apps/ingestion exact uv/hash lock, native Docling PDF/PPTX; locked-down actual local containers | Production isolated execution broker on Railway; no nested-Docker claim; native/container security audit |
| Three-step interface | businesses.tsx: identity → confirm facts/files → review goals; reload-safe server state and immutable Brand Brain confirmation | Website rendering and AI-recommended goals now use intake jobs; automatic strategy/first-plan generation and live model validation remain pending; fallback is labeled |
| Memory | Saved approved facts from actual version and provenance | Creative preferences, performance learning, experiments, source controls/rollback |
| Canvas / Plan / Review / Publishing / Connections | Explicit business routes and truthful “not available in this build” states | Actual workflow code, provider-backed results, editor, OAuth, publication and metrics; no fake records |
| Team | Prior account-level team APIs retained for compatibility; selected seats denied account-wide roster/admin routes | V5 business-scoped invitation and full role UI; new Team page accurately unavailable |
| Billing / Profile | Actual configured business allowance; signed-in identity + existing password recovery | Paid plan/subscription/invoices/credits; name/email/avatar edit, MFA/devices/export/deletion |
| Legacy client UI | Old links redirect to Brands or the same business onboarding ID | Account migration policy for existing multi-organization customers; legacy API removal after migration |

Existing auth/email/asset controls remain backed by code in auth.ts/mail.ts/team.ts/assets.ts and migrations 000–003. Existing `/api/v1/workspaces/{org}/brands/{brand}/...` APIs remain canonical for brand evidence and files; V5 does not invent equivalent provider endpoints. New scoped routes wrap real account/business functions, not a second service layer.

## Concrete build sequence

1. Verify the business quota, scoped grants, real record screens and corrected shell. Preserve existing upload/auth/job tests.
2. Complete safe website ingestion and semantic/source-backed extraction; produce and persist AI goal recommendations with citations, confidence and explicit unknowns. Keep onboarding at three steps. Implement conflict review, visual PDF/PPTX analysis and sandbox deployment.
3. Connect approved brand + real skill runtime to conversational image create/edit, Fabric projects, version history and credit reservation. Then actual 30-day planning and channel-specific reviews.
4. Finish scoped Postiz OAuth/publishing/reconciliation; add Higgsfield/FFmpeg, actual metrics and evidence-based Memory learning.
5. Complete V5 invitations/roles, paid billing/profile, operator configuration, production security/load/recovery and guarded live tests.

## Limits and evidence

No provider generation or social live tests have run. No LIVE_VERIFIED or LAUNCH_READY claim. The release gate must remain blocked. Final verification results and commit/source fingerprints live in docs/evidence and BUILD_STATE; intermediate test logs are not release evidence.

The native Docling path extracts embedded text and page/slide coordinates only. Literal labeled facts are not semantic AI extraction. File processing and uploaded injection strings are inert data. A document that has no embedded text returns an OCR/manual-review requirement. Processing failure preserves the validated file and prior approved profile.

Selected-business seats can read only granted businesses in new and existing brand APIs. Account-wide invitation/team operations are fail-closed for these seats. Business-specific editing/idempotency and complete business role administration need further work before enabling these roles in the customer UI. Invited seats do not add business slots to the inviting account. Current plan updates require trusted provisioning, not client requests; no upgrade purchase is simulated.
