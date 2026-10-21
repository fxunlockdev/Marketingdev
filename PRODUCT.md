# MARKETING OS — PRODUCT & ENGINEERING BUILD SPECIFICATION

**Version:** 1.2 (architecture diagrams + integration-first execution contract)  
**Prepared:** 2026-10-21  
**Audience:** Codex and the product engineering team  
**Status:** Build specification; not a statement that the product is implemented  
**Goal:** A production-grade, custom-branded, multi-tenant AI marketing SaaS with a Blaze.ai-like *end-to-end workflow*, and better creative specialization through our own Marketing Skills. **Do not copy Blaze.ai's proprietary UI, assets, or code.**

> **Developer handoff:** Place this file at the root of the new Marketing OS repository as `PRODUCT.md`. Read **[`ARCHITECTURE.md`](ARCHITECTURE.md)** (13 editable Mermaid diagrams), **[`INTEGRATION_FIRST_BUILD.md`](INTEGRATION_FIRST_BUILD.md)** (hard anti-UI-only completion gates), **[`CONFIGURE_AND_LAUNCH.md`](CONFIGURE_AND_LAUNCH.md)** (operator setup), and `AGENTS.md` alongside this specification. Provide Codex a checked-out, version-pinned Postiz repository and the original Marketing Skills archive. First prove actual integration/licensing capabilities (§4) and record exact component versions. **The finished deliverable is running, integrated application code with a safe setup flow—not polished nonfunctional screens.** Do not assume services are already working.

---

## 0. Non-negotiable product decisions

**Release invariant:** Every enabled customer action must travel through a real authenticated backend, durable job where applicable, persistent database/media storage and a real upstream service call when required. Mock-only and UI-only implementations are incomplete. Use the readiness states and evidence gates defined in `INTEGRATION_FIRST_BUILD.md`.

1. **One consumer-facing product, built by us.** Customers see our UI, our URLs, our branding, our creative editor, our approval center, and our billing. They do not need to use or install Postiz, Codex, Claude Code, Cursor, Deep Agents Code, a terminal, or a vendor dashboard.
2. **Postiz is an internal, replaceable publishing adapter** for *organic* social posts, connection handling where its interface safely supports it, scheduling, and available analytics. It is **not** our UI, Brand Brain, creative engine, primary CRM, or paid-ad platform.
3. **GPT Images is the selected image-generation provider** through OpenAI's supported API/SDK; use provider/model capability detection rather than pinning a model identifier in business logic. Support image **editing** and image references, not just text-to-image.
4. **Higgsfield is the selected video-generation provider** via its official server-side SDK/API. Treat video generation as an asynchronous external job; preserve job IDs, verify callbacks, poll/reconcile, save output in our object storage, and handle expiry/failure/cost.
5. **Our uploaded Marketing Skills are first-class runtime capabilities.** Load `SKILL.md` from our archive using Deep Agents; augment with approved brand context and narrowly scoped tools. **The Skill Harness runs inside our platform**; Codex is used to build and test it only.
6. **Approve before publish or spend.** Generated content always goes through configurable review; all paid advertising launch/budget-changing actions require explicit privileged authorization. Do not silently auto-spend.
7. **Brand facts require provenance and explicit verification.** Crawled sites and uploaded guidelines are evidence, not trusted instructions. Never let performance-memory summaries overwrite approved product facts/claims.
8. **Scalable by architecture, not slogans.** Tenant isolation, durable queues, limits, metrics, safe retries, asset retention, and load-test evidence are release gates before marketing this as suitable for thousands of customers.
9. **Build vs. buy:** Reuse mature libraries and services where possible, **but** we own the domain layer: smooth onboarding, brand verification, creative briefs and quality controls, campaign UX, cross-component adapters, learning logic, and SaaS tenancy.
10. **Version and test external dependencies.** Postiz, provider APIs, SDKs and OSS projects evolve. Codex must inspect the checked-out version's behavior rather than assuming an example payload is permanent.

### 0.1 Definition of the product

A brand owner signs up, enters their website, optionally uploads PDF/PPTX/DOCX/ZIP/images/catalogs, reviews AI-inferred brand knowledge with **Correct / Wrong / Edit** controls, confirms brand guidelines, then generates an integrated multi-channel campaign (captions, carousels, static ads, and Higgsfield video). They edit/approve assets, schedule organic posts through Postiz, review evidence-backed analytics, and use the performance-learning agent to improve future campaigns. Paid advertising is a distinct later service via authorized advertising APIs.

### 0.2 Reference business outcomes

- Time to first credible brand draft: asynchronous crawling with live progress and early partial findings; **do not block on exhaustive crawling**.
- Time to first useful creative: user can produce previews immediately after confirming minimum essentials.
- High brand fidelity: source-linked facts, reusable layouts, and human-editable copy/creative assets.
- Repeatable production: one campaign generates coherent variants across channels with traceability back to the exact brief, skill version, provider, and brand-profile version.
- Responsible learning: objective-based insights and experiment recommendations; no invented causal conclusions or unsupported claims of guaranteed ROAS.

---

## 1. Explicit scope, parity goals and omissions

| User-facing capability | Delivery milestone | Required quality bar |
|---|---|---|
| Self-serve account + brand workspace | M1 | Tenant-safe auth, brand selection, onboarding resume |
| Website brand discovery | M2 | Sitemap/nav crawl, images, products, citations, coverage report |
| Uploaded brand guidelines | M2 | PDF, PPTX, DOCX; visual references, failed-file handling |
| AI draft + Correct/Wrong/Edit | M2 | Per-field status, source evidence, correction tracking, conflict decisions |
| Approved, versioned Brand Brain | M2 | Immutable approved revisions, retrieval, brand-specific boundaries |
| Marketing brief + strategy + calendar | M3 | Skills-aware plans, per-channel plans, editable approval |
| LinkedIn/social copy and ad copy | M3 | Our `social`, `ad-creative`, `copywriting` skills with validation |
| Static images + reusable branded templates | M3 | GPT Images for visual content; editable Fabric.js layers for text/logos |
| Carousels + data-driven variants | M3 | Repeatable templates, product feeds, multi-size export |
| Higgsfield video ads | M4 | Storyboard, generation lifecycle, subtitles/overlay, revisions, export |
| Social account connection and scheduling | M3–M4 | Headless Postiz integration with per-tenant isolation proof |
| Campaign dashboard + basic organic analytics | M4 | Synced platform metrics with provenance and freshness timestamps |
| Creative QA and review/approval | M3–M4 | Policy checks, editor, explicit approval state machine |
| Brand performance lessons | M5 | Evidence-linked comparisons and controlled next-experiment briefs |
| Paid Meta/Google campaign management | M6 | Separate API service; permissions, audit trail, compliance, spend gates |
| Thousands-of-customers production hardening | Continuous; M5 launch gate | Measured concurrency, data isolation, budgets, alerts, incident plan |

**Not V1:** pixel-perfect cloning of Blaze.ai; all social platforms on day one; unsupervised paid-ad spend; guaranteed improvement in conversion metrics; complete Adobe/Premiere-grade video editing; universal ad-platform conversion attribution; cross-brand training on customer data without permission. Do not label deferred capabilities as shipped.

### 1.1 Key end-to-end flows

**Flow A — First-time user:** Register → brand name + website (or skip website) → crawl progress → draft findings → Correct/Wrong/Edit per card → add guidelines → resolve conflicts → approve Brand Brain v1 → generate three sample creatives → edit → save.

**Flow B — Organic campaign:** User asks for a 30-day Instagram/LinkedIn plan → brand-aware strategy and channel-specific posts → static/carousel/video production → batch review → choose accounts/dates → schedule via Postiz → reconcile actual publish status → display analytics.

**Flow C — Video campaign:** User asks for 15-second product video → `ad-creative` + `video` skills produce concept/script/storyboard → GPT Images creates safe referenced stills when needed → Higgsfield generates scenes → FFmpeg assembles scenes, subtitles, logo/CTA/music → user revises/regenerates a scene → approves export → organic schedule or paid-ad-ready download.

**Flow D — Learning:** Retrieve published performance and other authorized conversion data → map to creative versions and skill/model versions → normalize by channel/objective/time window → surface comparison and confidence → user accepts an experiment brief → create new variants without changing confirmed brand facts.

---

## 2. Repository-by-repository: precise reuse vs. custom development

**Classification:** `RUN` = deploy as independent service, `EMBED` = library/SDK, `ADAPT` = integration service/controlled wrapper, `OPTIONAL` = defer until measured need. **A GitHub repository is not a finished integration.**

| Repository / canonical URL | Use it for — actual reusable part | What we still develop | Integration pattern / priority |
|---|---|---|---|
| **Postiz** — https://github.com/gitroomhq/postiz-app | Existing social connector implementations, scheduling, queue, post lifecycle, supported analytics; public API/webhooks | Tenant-safe publishing adapter, user-facing calendar/connection UX, permissions, status reconciliation, connection and token isolation, duplicate protection | `RUN + ADAPT` · M1/M3 · AGPL-3.0; release blocker for isolation/license |
| **Deep Agents** — https://github.com/langchain-ai/deepagents | Skills middleware (`SKILL.md` progressive disclosure), virtual filesystem backends, tool calling, agent state, subagents, approval primitives | Curated marketing skill selection, tool entitlements, brand context mount, result schemas, execution policy, sandbox/limits, model gateway wiring | `EMBED` Python runtime · M2/M3 |
| **LangGraph** — https://github.com/langchain-ai/langgraph | Graph/state/checkpoint primitives *under* agent system; use when deterministic routing is required | Marketing-specific graph steps, resumability integration, business state transitions | `EMBED` through Deep Agents where sufficient; **do not build a second agent platform** · M3 |
| **Portkey Gateway** — https://github.com/Portkey-AI/gateway | Gateway for compatible LLM calls, retries, fallback/routing/observability primitives | Tenant-aware rate/cost accounting, supported-model registry, error policy; native image/video adapters when gateway lacks operations | `RUN/EMBED + ADAPT` · M3 · MIT OSS core, verify version |
| **OpenAI official SDK** — https://github.com/openai/openai-node ; https://github.com/openai/openai-python | Authenticated text/structured-output and GPT image generation/editing calls | Brand prompt compiler, reference images, image moderation/QA, cost logging, media persistence, revision history | `EMBED` · M3 · **API is paid; SDK being OSS does not make inference free** |
| **Higgsfield official SDK** — https://github.com/higgsfield-ai/higgsfield-js ; https://github.com/higgsfield-ai/higgsfield-client | Video model request submission, status polling/result retrieval and optional webhooks | Video workflow adapter, storyboard, scene QA, rendering/postproduction, credit reservations, cancellation/retry, asset copy | `EMBED` server-side · M4 · paid hosted API, NOT OSS model |
| **Fabric.js** — https://github.com/fabricjs/fabric.js | Interactive editable 2D canvas scene graph, text/image transforms, layers, serializable designs, export primitives | Polished ad editor UI, templates, asset panel, brand controls, snapping/resize, undo history, variant generator, autosave, batch export | `EMBED` frontend/editor worker · M3 · MIT |
| **FFmpeg** — https://github.com/FFmpeg/FFmpeg | Encoding/transcoding, concatenate clips, subtitle and audio overlays, thumbnails, multi-resolution exports | Creative timeline JSON, render service, progress, GPU/CPU worker fleet, export presets, copyright-safe audio use | `RUN` isolated media worker · M4 · LGPL/GPL build-dependent |
| **Crawl4AI** — https://github.com/unclecode/crawl4ai | Web crawler, JS page handling/content extraction, URL/page data | Crawl scope/quotas, ownership checks where appropriate, SSRF guard, sources, dedupe, visual and catalog analysis, UX progress | `EMBED` dedicated ingestion worker · M2 · review attribution terms |
| **Docling** — https://github.com/docling-project/docling | Parse PDF, PPTX, DOCX, XLSX/images into structured documents/layout data | Uploaded-file service, malware/file validation, multimodal guideline extraction, evidence pointers to page/slide, conflicts/review | `EMBED` parsing worker · M2 |
| **PostgreSQL** — https://github.com/postgres/postgres | Durable relational data, transactions, constraints, audit/event records | Full multi-tenant schema, business invariants, RLS/policy, migrations, archival, sensitive-data retention | `RUN` managed or self-hosted · M1 |
| **pgvector** — https://github.com/pgvector/pgvector | Similarity search within PostgreSQL | Chunking, retrieval ACL filtering, relevance benchmarks, version-aware re-embedding | `EMBED` database extension · M2 |
| **Temporal** — https://github.com/temporalio/temporal | Durable workflows, asynchronous activities, retry/timeouts, long task orchestration | Brand ingestion, AI/media job state machines, job IDs, compensating actions, deterministic retry handling | `RUN` · M1 onward. Reuse Postiz's cluster only after compatibility/security assessment |
| **Langfuse** — https://github.com/langfuse/langfuse | AI traces, prompt/version observation, eval datasets and scoring | Creative-specific quality rubrics, user-feedback linkage, tenancy-safe instrumentation, release regression suites | `RUN` internal operations; not consumer marketing analytics · M3 |
| **GrowthBook** — https://github.com/growthbook/growthbook | Experimentation/feature flags, controlled app-side trials | Creative-to-ad assignment, ad-network data retrieval, attribution handling, statistically appropriate reporting | `OPTIONAL` M5; open-core / features may be licensed |
| **OpenTelemetry** — https://github.com/open-telemetry | Distributed tracing/metrics/log correlation | Request/job/tenant correlation, dashboards, alerts, SLOs | `EMBED` M1; complement, don't duplicate Langfuse |
| **Better Auth (candidate)** — https://github.com/better-auth/better-auth | Authentication and session/account primitives | Organization membership, scoped roles, MFA policy, invitations, tenant RBAC, billing linkage | `OPTIONAL/EMBED` M1 after license/feature evaluation; auth is not provided by the AI frameworks |
| **S3-compatible object storage (S3/R2/MinIO)** — https://github.com/minio/minio (local-dev option) | Durable media storage interface | Tenant-specific keys, temporary signed URLs, lifecycle, encryption, content scanning | `RUN` local MinIO; managed S3/R2 production if preferred |

**We do NOT initially need:** ComfyUI (images come from OpenAI), Mem0 (approved facts live in PostgreSQL; pgvector covers discovery), a separate generic agent builder (Deep Agents already exists), or a new model gateway from scratch. We may reevaluate optional tools after benchmarks, not popularity alone.

### 2.1 Responsibility boundaries that must not blur

- **Postiz:** organic publishing and available social-account analytics; **not paid Meta campaigns** or independent attribution by default.
- **Deep Agents:** interprets instructions and selects constrained tools; **not** the database of approved brand truth.
- **LangGraph:** workflow primitives; **not** a second deployment requirement on top of Deep Agents unless proven necessary.
- **Portkey:** compatible model routing; **not** an assurance that native OpenAI Images operations or Higgsfield asynchronous jobs are automatically covered. Keep direct provider adapters.
- **Fabric.js:** canvas drawing engine; **not** an out-of-the-box Canva clone.
- **FFmpeg:** media operations; **not** a visual timeline application.
- **Langfuse:** LLM execution observability and eval; **not** paid marketing ROAS attribution.
- **GrowthBook:** general experiments; **not** a self-learning ad-creative optimizer.
- **PostgreSQL/pgvector:** source of truth/retrieval infrastructure; **not** business-specific brand memory rules by themselves.

### 2.2 Optional expansion after MVP

- Product analytics: PostHog (evaluate operational/licensing choices) or a minimal first-party event pipeline; avoid scaling Postgres alone for infinite event volumes. Introduce ClickHouse when justified.
- Paid advertising: Meta Marketing API first; Google Ads/TikTok Ads later, with per-API approvals and explicit advertiser account consent.
- Deeper video timeline: evaluate stable embedded editors on current licenses; do **not** block on unstable repos or assume Remotion may be embedded commercially without license review.
- Catalog connectors: Shopify/WooCommerce official integrations, permissioned product imports and catalog refreshes.
- Billing: use a provider SDK such as Stripe, or an evaluated OSS billing engine only if justified. Backend metering/ledger are ours regardless.

---

## 3. Reference architecture (logical; our UI is independent)

**Companion visual specification:** [`ARCHITECTURE.md`](ARCHITECTURE.md) contains ten detailed diagrams (system context, trust boundary, onboarding sequence, skill execution, creative state machine, publishing sequence, learning loop, scalable deployment, data ownership, and backend-first build order). Their independently editable sources are under `diagrams/*.mmd`. Codex must update affected diagrams whenever architecture changes.

```mermaid
flowchart TB
  U[Customer browser — OUR Next.js UI]
  A[Marketing OS API / BFF — NestJS]
  DB[(PostgreSQL + pgvector)]
  OS[(S3-compatible asset storage)]
  T[Temporal — durable orchestrator]
  D[Deep Agents — marketing skills runtime]
  P[Portkey — supported text LLM routing]
  O[OpenAI SDK — GPT Image create/edit]
  H[Higgsfield SDK — video jobs]
  E[Fabric.js editor / FFmpeg renderer]
  C[Crawl4AI + Docling ingestion]
  L[Langfuse AI evaluations]
  Z[Postiz — headless organic publishing]
  X[Social networks / paid APIs separately]
  M[Learning/analytics domain service]
  U <--> A
  A <--> DB
  A --> T
  T --> C
  T --> D
  D --> P
  D --> O
  D --> H
  T --> E
  C --> DB
  D --> L
  O --> OS
  H --> OS
  E --> OS
  A <--> Z
  Z <--> X
  Z --> M
  M <--> DB
  M --> D
```

**Deployment recommendation:** one Next.js app, one NestJS API/BFF, one Python AI/ingestion worker codebase (Deep Agents, Crawl4AI, Docling), one or more media render workers, dedicated Postiz deployment, Temporal, managed Postgres/pgvector, object storage, internal Langfuse; Portkey only where useful. Keep service boundaries small and stable; do not create one microservice per open-source library.

**Ownership of data:** Marketing OS owns brand/tenant/campaign/creative/approval/learning tables. Postiz retains its own application schema; integrations use documented API events and a narrow adapter. Never write directly into Postiz's migration-managed tables. No customer ever receives backend model credentials.

### 3.1 Suggested monorepo layout

```text
marketing-os/
  PRODUCT.md
  AGENTS.md                        # Derived Codex working rules
  apps/
    web/                           # Next.js customer app
    api/                           # NestJS business API + Postiz adapter
  workers/
    intelligence/                  # Python: Deep Agents, skill registry, brand analysis
    ingestion/                     # Python: Crawl4AI, Docling, extraction
    media/                         # FFmpeg render + thumbnails/packaging
  packages/
    contracts/                     # Versioned schemas, Zod/OpenAPI/Pydantic
    ui/                            # Design system
    creative-project/              # Fabric.js project JSON schema + rendering API
    adapters/                      # Postiz, OpenAI, Higgsfield, Portkey abstractions
    skills-registry/               # Metadata/catalog/versions, not uncontrolled shell
    observability/                 # Tracing, cost and audit instrumentation
  infra/
    compose/                       # Local dependencies and mock providers
    terraform/                     # Production deployment
    migrations/
  tests/
    e2e/ fixtures/ contract/ load/ security/
  docs/
    adr/                           # Document assessed licenses and API versions
    runbooks/
  vendor/
    postiz/                        # Git submodule or separate deployment; pin commit
    marketing-skills/              # Imported, versioned copy of supplied ZIP
```

**Important:** `vendor/postiz/` can be a submodule/companion repo rather than source-copied into our proprietary application. This is an engineering choice subject to AGPL counsel review; separation alone is not a license exemption.

---

## 4. Required Codex discovery gates — before feature development

Codex MUST perform these checks, record exact commit hashes, SDK/package versions, API capabilities, and limitations in `docs/adr/0001-reuse-decisions.md`:

1. **Inspect the provided Postiz checkout:** pin commit/tag; run official Docker configuration unmodified; document actual API scopes/endpoints, payload shapes, OAuth/connection flows, webhooks, rate limits, organization/token isolation, provider-specific posting requirements, and whether we can hide all Postiz UI. Do not guess undocumented connection endpoints. Verify publish and analytics with a sandbox/test account.
2. **License review:** identify Postiz AGPL-3.0 impact for network SaaS, any Copyleft or source disclosure duties, FFmpeg build licensing, GrowthBook commercial modules, Langfuse enterprise modules, and Crawl4AI attribution. Flag legal review required; do not pretend engineering resolves license questions.
3. **Skill archive audit:** import `marketingskills-main (1).zip` as a versioned source artifact. It contains **52 `skills/<name>/SKILL.md` directories**, an MIT license by Corey Haines, plus references/evals, **66 Node CLI files under `tools/clis/`**, and contract tests. Preserve attribution and actual instructions. Scan for external integrations, network/credential access, partner-linked recommendations, possible prompt injection, scripts and side effects. Do not execute arbitrary bundled CLIs just because a skill mentions them.
4. **Deep Agents proof of concept:** demonstrate loading `social`, `product-marketing`, `ad-creative`, `image`, `video` from an isolated virtual backend; verify selected skills reference files correctly, output structured JSON and invoke only whitelisted tools. Note SDK APIs may have changed.
5. **OpenAI proof of concept:** use a server-side API key to generate and edit one image using an approved, currently supported GPT Image model; measure cost/output; test reference-image fidelity and error behavior.
6. **Higgsfield proof of concept:** use official server-side SDK; generate a permitted short video with an actual video endpoint discovered from official docs; test submit/status/completion/callback, timeout, storage copy, provider quota and rate-limit errors. Do not copy image endpoint examples as if they are video endpoint schemas.
7. **Postiz integration safety spike:** establish defensible tenant-to-integration mapping and demonstrate account A cannot read/schedule/publish account B. If the self-hosted API cannot provide per-workspace isolation or connection without its UI, explicitly choose one of: a tested isolated deployment strategy, a maintainable AGPL-compliant fork/extension, or another publishing provider. This is a **launch blocker**, not a TODO to ignore.
8. **Model gateway necessity spike:** test Portkey for the chosen text workflow. If direct OpenAI text SDK gives simpler observability and cost at MVP scale, keep Portkey optional—avoid adding a proxy solely because it has GitHub stars.
9. **Security baseline:** verify file parsing in isolated workers; crawler denies localhost/private/link-local destinations even after redirects; ensure there is no direct client access to model/provider keys.
10. **Deliver ADR + test evidence:** actual screenshots/logs of one completed vertical slice; no false claims of feature completeness.

### 4.1 Implementation rule for Codex

**No big-bang agent generation.** After the discovery gates, implement code and tests milestone by milestone. Every milestone must build, migrate, test, and operate. When a source API lacks required capabilities, write an adapter interface and fake implementation first, create a documented decision, and replace it with a real tested integration. Never fabricate endpoints or fake a successful publication in production UI.

---

## 5. Customer experience and screen map

### 5.1 Design principles

- Customer sees a premium custom marketing application, not Postiz/Dify/ComfyUI/CLI screens.
- Offer *progressive onboarding*: enter a URL first; after first evidence-based draft, ask only essential missing/high-risk questions.
- All AI inferences show source/evidence and review status, not just unqualified “confidence 97%.”
- Fast first-value moment: confirm 4–6 essentials, generate 3 branded draft creatives, then refine.
- Transparent generation: brief, skill, model, iteration status, preview/credits, estimated vs actual cost.
- Deep editing: editable text, overlays, crop, logo, palettes and templates; render outputs reproducibly.
- Batch operations: multi-platform approvals, variants, exports and scheduling.
- Accessible responsive design, keyboard basics, proper empty/loading/error/retry states.

### 5.2 Navigation / page definitions

| Screen | Primary actions | Engineering notes |
|---|---|---|
| Signup & organizations | Create account, org, choose brand | Roles: owner/admin/editor/reviewer/analyst |
| Brand discovery | Enter URL, crawl status, discovered sources | Abort/pause/resume and bounded crawl, no indefinite spinner |
| Brand verification | Review source-linked findings, Correct/Wrong/Edit, merge conflicts | Explicit update trail and verification status per field |
| Document vault | Upload/manage PDF/PPTX/DOCX/images/ZIP; extraction status | Signed uploads, safe parser, page/slide evidence |
| Brand Brain | Products, ICP, voice, visuals, guidelines, prohibited claims, versions | Approved vs draft changes; sources; read-only history |
| Campaign strategist | Objective, audience, channel, schedule, offers; AI plan | Skills selected, user edits plan before generating |
| Content studio | Generate/iterate platform-aware captions and creatives | Text + image + carousel + video request composer |
| Image ad editor | Layer canvas, crop, replace background, logo, text, variants | Fabric.js + project JSON + render worker |
| Video studio | Concept/script/storyboard/scenes, voice/captions, render | Higgsfield jobs + FFmpeg postproduction |
| Calendar & approval inbox | Review, approve/reject, assign owner, schedule | Our UI, Postiz adapter only after approval |
| Integrations | Connect social accounts, inspect scopes/health | Tenant isolation and OAuth consent, no raw access keys |
| Analytics | Per-post/channel/campaign measurements, last-synced | Metric definitions and source labels |
| Learning Lab | What worked, evidence, suggested tests, feedback | No unverified causal claims; opt in to recommendations |
| Usage/billing/admin | Credits, plans, invoice, member access, keys policy | Backend usage ledger; budget ceilings; audit logs |

---

## 6. Website and document onboarding (M2) — detailed specification

### 6.1 Happy path

1. User enters URL, can skip or correct, chooses public pages to analyze.
2. Server validates URL and dispatches bounded `BrandDiscoveryWorkflow` via Temporal.
3. Crawl4AI follows sitemap/navigation/internal links (allowlist host/domain and limits). Extract text, structured metadata, key product pages, brand media references, official social handles, and crawl coverage. Do not claim “entire site” if pagination/robots/limits block pages.
4. For visual identity, collect logos, relevant CSS tokens and approved reference imagery; vision model interprets them as **proposals**. Ingest permitted product images with provenance; don't fabricate logos.
5. Brand extraction maps facts and hypotheses to structured fields. Every finding has source URL/file ref, page/slide anchor, captured timestamp, inference type, and suggested confidence.
6. Show a review screen: **Correct / Wrong / Edit**, with “why we think this” evidence. Accept multiple related corrections at once and provide conversational clarification for wrong findings.
7. Offer optional uploads *before, during, or after* discovery: PDF, PPTX, DOCX, JPG/PNG/WebP/SVG, CSV/XLSX product catalogs, validated ZIP collections. Parse Docling output; use vision on visual guideline pages/slides as needed.
8. Surface conflicts: website vs PDF vs user's previous approved data. Explicitly ask the user to pick/correct authoritative versions. Rules of priority: current **owner-approved** value > explicit newer approved guidelines > website evidence > AI hypotheses; still show conflicts and sources.
9. Activate **Brand Profile v1** on minimum accepted fields; unresolved optional sections remain marked missing. Save the accepted profile as immutable and searchable.
10. Generate first brand-aware previews, ask “Does this feel like your brand?” (yes/no/edit with correction saved as creative preference, not factual truth).

### 6.2 Data captured

Legal/trading name; business/category/market; positioning; mission and differentiators; products/services/catalog and facts; prices and offers with verification timestamps; audience/ICP and objections; voice and writing do's/don'ts; approved brand colors/logos/fonts; visual reference examples; CTA style; social handles; URL/page provenance; prohibited claims and industry constraints; platform priorities; approved creative examples; explicit permissions and missing facts.

### 6.3 Intake safety and failure cases

- Respect site access restrictions and applicable crawling terms; no bypassing logins/paywalls or robots where applicable.
- SSRF prevention: DNS resolve + IP checks (private/link-local/loopback/cloud metadata), follow redirects only with repeat validation, strict time/size limits, no cross-domain crawl by default.
- Accept website-absent brands via documents/manual entry.
- Uploads use authenticated presigned URLs, size/type limits, malware scans, ZIP-bomb protection, isolation and file deletion/retention controls.
- Prompt injection defense: never treat crawled website/document text as system instructions; it is quoted source data only.
- Source failure is visible: failed URLs, inaccessible resources, unsupported formats; user can resume and add manual fields.
- Preserve `rejected`, `corrected`, `approved`, and `unreviewed` statuses and a timestamp/user audit trail.

### 6.4 Acceptance tests

- Simple public website -> useful draft with clickable/locatable sources.
- 500+ URL ecommerce sitemap -> bounded partial crawl, coverage report and no unbounded costs.
- 50-page PDF and PPTX with logo/color rules -> parsed facts and page/slide evidence.
- Conflict in logo/primary color -> visible conflict; approved resolution affects subsequent creatives.
- Wrong audience inference -> rejection and typed correction; it does not reappear as an approved fact.
- No website -> user reaches first creative from manually entered context.
- Pause/refresh/re-upload -> idempotent/resumable jobs; versioned changes, not duplicates.

---

## 7. Brand Brain — authoritative data and retrieval

### 7.1 Four different stores, not one magic vector database

1. **Approved truth** (PostgreSQL): structured products, brand profile fields, visual rules, policies, sources, review provenance, active brand version.
2. **Documents and source evidence** (S3 + PostgreSQL): crawled snapshots, PDF/PPTX rendered pages, product imagery, evidence pointers, hashes.
3. **Search/retrieval** (pgvector): semantically embedded chunks with **mandatory tenant and brand filters**, document version, evidence link and expiry/validity.
4. **Performance learning** (PostgreSQL now; analytics store later): creative DNA, outcomes, experiment logs, quality feedback, generated insights; never merged into authoritative truth without review.

### 7.2 Brand profile versioning

`DRAFT -> REVIEW_REQUIRED -> APPROVED -> ACTIVE -> SUPERSEDED`. All creative jobs lock the approved profile version used at generation time. New uploads/website refreshes create proposed changes; they never silently overwrite a live profile. “Brand guideline changed” affects *new* generations, not already-approved assets unless users request revalidation.

### 7.3 Virtual skill context

The uploaded `product-marketing` skill instructs readers to inspect `.agents/product-marketing.md`. Provide a **virtual per-(tenant, brand, brand-version, execution) file** at that path, generated from reviewed Brand Brain and relevant evidence. Also present narrow `/assets/...` read-only references to approved media and `/campaign/...` context. Never use one global shared on-disk `.agents/product-marketing.md` for every customer.

### 7.4 Context-builder rules

- Priority: owner-approved facts > user-approved style rules > current task brief > explicit campaign data > prior performance lessons > unverified website hypotheses.
- Include source IDs and freshness on factual claims.
- Prevent references to an unrelated tenant/brand; test this at the DB, retrieval and virtual filesystem layers.
- Store embeddings with model version; run re-embedding asynchronously when necessary.
- Cache only with `tenant_id+brand_id+brand_version+audience+purpose` keys and enforce cache ACLs.

---
## 8. Our Marketing Skills: runtime harness and orchestration (M2–M4)

### 8.1 Imported source: verified archive inventory

User-supplied archive: `marketingskills-main (1).zip`; root folder `marketingskills-main/`; source project identifies itself as [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills), MIT licensed (retain notice). It contains **52** skills in `skills/<slug>/SKILL.md`, including:

`product-marketing`, `social`, `ad-creative`, `ads`, `image`, `video`, `marketing-plan`, `content-strategy`, `copywriting`, `copy-editing`, `customer-research`, `competitor-profiling`, `analytics`, `attribution`, `conversion-tracking`, `ab-testing`, `cro`, `marketing-psychology`, `offers`, `pricing`, `onboarding`, `email`, `seo-audit`, and more. The repository also contains CLI/integration guides and eval/reference materials. The instructions frequently expect `.agents/product-marketing.md` context. **No broad permission to run arbitrary CLIs or third-party calls is implied by importing the archive.**

### 8.2 Skill selection and compilation, without creating another agent framework

We implement a **Marketing Skill Registry** that indexes the validated frontmatter, versions, descriptions, dependency relations, input/output requirements, allowed tools and review policies. Deep Agents does the runtime reading and tool calling; our product supplies brand/tenant policy and interprets outputs.

1. Parse/validate the frontmatter for each `SKILL.md` and preserve its source hash and original text/references.
2. Add a small **overlay manifest** for machine-readable marketing runtime policy. Do not rewrite third-party skill content into one giant prompt. Store our overrides separately.
3. Rule-based capability filter by task (e.g., image + `ad-creative` + `product-marketing` for static paid-ad-ready asset). Let the agent pick only from the allowed subset, with trace logs.
4. Mount the per-brand virtual context. Read only approved facts, selected relevant source snippets, and task assets.
5. Expose tools with **typed payloads**, not generic unrestricted shell/network access: `generate_text`, `generate_image`, `edit_image`, `submit_video`, `poll_video`, `render_static`, `render_video`, `retrieve_brand_knowledge`, `record_feedback`, `prepare_publish`.
6. Reject invalid outputs, missing required facts, unapproved claims, misleading image edits, unsafe text, or wrong aspect ratios; provide a deterministic repair loop with capped retries.
7. Return a versioned creative artifact and trace metadata; the skill can *recommend* an action, but deterministic product code enforces approval and publishing authorization.

**Skill mapping defaults** (mutable via registry configuration):

| User goal | Skills normally loaded | Tools exposed | Output contract |
|---|---|---|---|
| Brand onboarding | `product-marketing`, `customer-research` | retrieve sources, extract structured facts | Brand finding set, source refs, questions |
| Marketing strategy | `marketing-plan`, `content-strategy`, `product-marketing` | brand retrieval, text | Strategy, goals, assumptions, channels, calendar |
| LinkedIn / social | `social`, `copywriting`, `copy-editing` | text, approved asset search | Channel post drafts, hooks, CTA, reviewer notes |
| Static paid-ad-ready image | `ad-creative`, `image`, `product-marketing` | GPT Images, Fabric render, QA | Concept, editable project, variants, exported assets |
| Video | `video`, `ad-creative`, `social` | text, GPT Images references, Higgsfield, FFmpeg | Script, shot list, video job, final video + timeline data |
| Product carousel | `social`, `image`, `copywriting` | templates, image generation, canvas export | Array of editable slide projects and alt-text |
| Iteration after results | `ad-creative`, `analytics`, `ab-testing` | metric retrieval (read-only), text, scoring | Evidence-backed hypothesis and new creative brief |
| Paid ad planning | `ads`, `ad-creative`, `attribution` | ad-account insights (read-only initially) | Proposed ads/campaign plan requiring review |

A skill may be in a task plan without executing tools that its untrusted instructions mention; tools remain gated by declared allowances and tenant auth.

### 8.3 Sample skill execution contract (ours, not a Deep Agents API)

```json
{
  "request_id": "req_01",
  "tenant_id": "org_01",
  "brand_id": "brand_01",
  "brand_profile_version": 4,
  "task_type": "generate_ad_variants",
  "objective": "website_conversions",
  "platform": "instagram",
  "formats": ["1080x1350", "1080x1920"],
  "requested_variants": 3,
  "skill_candidates": ["product-marketing", "ad-creative", "image"],
  "model_policy": {"image_provider": "openai", "video_provider": "higgsfield"},
  "requires_user_approval": true,
  "budget": {"max_usd": 5.00},
  "idempotency_key": "org01:campaign01:job01"
}
```

```json
{
  "execution_id": "exec_01",
  "state": "NEEDS_REVIEW",
  "selected_skills": [
    {"name": "product-marketing", "version": "2.2.0"},
    {"name": "ad-creative", "version": "2.12.1"},
    {"name": "image", "version": "2.0.2"}
  ],
  "brand_profile_version": 4,
  "creative_ids": ["cr_01", "cr_02", "cr_03"],
  "review_flags": [],
  "provider_usage_ids": ["usage_01"],
  "trace_id": "trace_01"
}
```

The example semantic versions above are **illustrative**, not asserted versions in the uploaded archive. The supplied `SKILL.md` frontmatter does **not** consistently declare semantic versions. On import, compute an immutable content digest for each skill and supporting-file tree, assign an internal release/revision ID, and preserve the original metadata. Build Pydantic/Zod validators and use those pinned digests for historical reproducibility.

### 8.4 Skill safety and quality

- Skills and uploaded documents are **data/instructions for the constrained agent**, not trusted privileged software. Scripts/CLIs need a curated allowlist, a restricted worker, no host shell, explicit network egress allowlist, short timeouts and no shared filesystem.
- Secrets are injected into adapter calls from a server-side vault; never available to skill prompt bodies, generated code or untrusted tools.
- No tool can perform `publish`, `change_budget`, `manage_billing`, or `delete_brand` without deterministic RBAC, approval state and audit enforcement outside agent logic.
- Record the skill ID/version/source digest, selected references, generated prompts (with sensitive values redacted), provider version, outcome and user corrections in Langfuse and our DB.
- Implement test fixtures for specific brands and prompts; evaluator detects brand voice mismatch, missing mandated CTA, typography/legal claim violations, factual drift, platform constraints and cross-brand contamination.
- Curate the supplied tools and partner recommendations neutrally. Do not silently add affiliate/partner marketing tools or user-facing sponsored recommendations from skills.
- Registry supports enabled/disabled status, tenant-wide skill permissions, gradual rollouts, rollback, and a first-party “custom private skills” extension point.

---

## 9. Model/provider gateway and creative engines

### 9.1 Model Gateway (Portkey where applicable + native adapters)

Expose an internal `ModelRouter` interface. Supported operations must be typed; do not treat images/videos as simple text completions:

```typescript
interface ModelRouter {
  generateStructuredText(req: TextRequest): Promise<ValidatedJson>;
  generateImage(req: ImageRequest): Promise<ImageAsset>;
  editImage(req: ImageEditRequest): Promise<ImageAsset>;
  submitVideo(req: VideoRequest): Promise<VideoJob>;
  getVideoStatus(jobId: string): Promise<VideoStatus>;
  cancelVideo?(jobId: string): Promise<void>;
}
```

**Recommended providers:** text via supported OpenAI model/Portkey; image create/edit via official OpenAI SDK and current Images/Responses API; video via official Higgsfield SDK. Do not route video through Portkey unless supported and tested. Gateway stores price snapshots/usage and reports retries, failures, model and latency. There is **no** promise of identical quality for provider fallbacks. If a requested model is unavailable, either choose an approved fallback with audit label or ask the user; never invisibly change the provider for a paid deliverable.

### 9.2 Image generation with GPT Images

**Pipeline:** confirmed brief → skills generate concept/image instructions → reference selection (product/logo/approved images) → GPT image API create/edit → validate pixel dimensions/file integrity → composition into editable Fabric.js layers → copy/brand QA → thumbnail/preview → user corrections → immutable approved export.

Use AI models for artwork and visual scenes; keep text/logo/CTAs as separately editable canvas layers to ensure accuracy. For product-image authenticity, prefer reference-aware editing and require user verification if the result invents packaging, claims or physical properties. Store original uploaded source, generated image, edit request, input refs, dimensions, cost, model and moderation outcome. Provide undo/redo, re-generate only selected layer, custom aspect ratios and assets library reuse.

### 9.3 Fabric.js editing: features we must build

- Canvas page sizes and platform presets; drag/resize/rotate/select; text boxes, fonts/colors, brand palettes, logos, image crops/backgrounds, overlays, opacity, ordering; multiple pages for carousel.
- Consistent serialized `creative_project_json` with a schema/version. Separate product data bindings from visual templates; e.g., `{{product_name}}`, `{{price}}`, `{{image_asset}}`. Validate substitutions and length/overflow.
- Undo/redo history, autosave, duplication and version snapshots; template gallery per brand; export to PNG/JPG/WebP and PDF if needed.
- Template-based **dynamic variations** for product/audience/offer/CTA and sizes, with side-by-side comparison. Do not imply this automatically delivers Google/Meta dynamic creative ads; that requires ad platform APIs.
- Server-side deterministic renderer matches client layout. Test font fallback, color correctness and legibility for major aspect ratios.

### 9.4 Higgsfield video generation and FFmpeg composition

**Pipeline:** brief → `video` + `ad-creative` skill script → structured storyboard (scenes, durations, prompts, image references, voice/captions, CTA) → submit Higgsfield jobs for individual scenes using endpoints confirmed by capability discovery → status polling/validated webhook → download immediately to object storage → quality/consistency checks → FFmpeg composition/subtitles/audio/branding → review video → per-scene regeneration → final export.

- Support 9:16, 1:1, 16:9 output presets when provider/export pipeline allows; never submit unsupported dimensions to Higgsfield.
- Store provider request/job/result IDs; reconcile stalled jobs; limit retries to avoid duplicate billing. Use a separate render workflow for final export, not repeated video generation on copy-only changes.
- Keep a **machine-editable project timeline** (scene order, trim, transitions, subtitles, voice/music tracks, overlays); V1 need not include a fully visual multitrack editor.
- For UGC-style ads, require legitimate rights/consent for likeness, voices and testimonials. Clearly label synthetic representations where law/platform policy requires.
- Keep original generated clips, merged export, transcoded variants and captions in our own bucket; provider-hosted URLs are not durable asset storage.

### 9.5 Creative QA gate

Automated validation and user review precede final export/publication:

- Objective, brand profile and intended platform must match output.
- All specific factual product/price/offer claims tie to verified data or are sent for user approval.
- Text must be readable and fit bounds; no spelling/CTA omissions; ratio, encoding and duration meet channel requirements.
- Visual identity aligns with approved palette/logo and user-provided reference requirements.
- Video has valid audio/subtitle mix, no blank frames/unsafe content, and the correct end card.
- Low-confidence issues are shown as warnings, not silently “fixed” by changing approved facts.

---

## 10. Campaign planning, publishing and Postiz boundary

### 10.1 Campaign entities and states

`DRAFT -> BRIEF_APPROVED -> GENERATING -> READY_FOR_REVIEW -> APPROVED -> SCHEDULED -> PUBLISHING -> PUBLISHED / FAILED / CANCELLED`.

Creative version approval is separate from publishing approval. A campaign can contain many platform-specific posts derived from one master creative; posting to one channel does not automatically imply approval for another.

### 10.2 Headless Postiz integration requirements

Build `PublishingProvider` with operations such as:

```typescript
interface PublishingProvider {
  listConnections(orgId: string): Promise<SocialConnection[]>;
  uploadMedia(input: ApprovedMedia): Promise<ProviderMediaRef>;
  createScheduledPost(input: ScheduledPost): Promise<ProviderPostRef>;
  getPublishStatus(ref: ProviderPostRef): Promise<PublishState>;
  getPostAnalytics(ref: ProviderPostRef, range: TimeRange): Promise<MetricSet>;
  disconnectConnection?(connectionId: string): Promise<void>;
}
```

**Important:** These are *our internal abstractions*, **not assertions that every matching Postiz API endpoint exists**. Verify actual Postiz public API/Node SDK and scopes in the checked-out version. Its docs confirm public REST API and integrations, media upload, posts and analytics, but some account-connect/OAuth flows may require custom backend work. Do not expose raw Postiz bearer keys or tokens client-side.

**Scheduling sequence:** (a) RBAC and explicit approval check, (b) ensure account belongs to current tenant and supports requested media type, (c) put approved media into Postiz upload flow, (d) create post with provider-specific settings, (e) persist our `publication` record and Postiz ID atomically where possible, (f) poll/webhook reconcile until terminal state, (g) sync normalized analytics with source timestamps. Protect against duplicate posts under timeout/webhook/retry conditions using idempotency ledger, outbox and reconciliation; do not assume external API idempotency support until verified.

**Critical risks:** API rate limits; provider platform app reviews; publishing scopes; OAuth refresh; media size/duration; tenant/workspace API scoping; connection experience without showing Postiz UI; legally compliant AGPL hosting model. If multi-tenant API keys are insufficiently scoped, choose a safe boundary before production.

### 10.3 Paid advertising is separately scoped

For future Meta Marketing API and other ad networks, build `PaidAdsProvider` with advertiser-account consent, creatives, campaigns, ad sets, budgets, conversion event mapping and learning. Do not route paid spend through Postiz's organic scheduling endpoints. Put a privileged approval and hard budget cap in front of all spend changes and campaign submissions. Support draft/export-only paid-ad-ready creatives before API launch.

### 10.4 Unified social platform support

Start with **LinkedIn and Instagram** for first vertical slice, extend Facebook/TikTok/YouTube as integrations pass test matrices. Each channel has platform-specific captions, media specs, account type limitations and publishing prerequisites. Show unsupported content formats in UI and recommend alternatives; never submit doomed jobs silently.

---

## 11. Learning engine and experimentation — build the domain logic, reuse the plumbing

### 11.1 Separate three kinds of intelligence

**A. User preference feedback:** “More like this”, “Change the tone”, manual edits, accepted/rejected variants; stored as *creative preferences* linked to brand and asset versions. Not factual changes.

**B. Generation quality:** Brand fidelity, hallucinated claims, visual quality, approval rate, edit distance, model/skill version, cost and latency; tracked via Langfuse and app feedback.

**C. Campaign effectiveness:** Impressions/reach, engagement/saves/shares, CTR, cost/spend, CPA, conversions, ROAS, watch retention—**only where real authorized data is available**. Store metric origin, platform definitions, attribution window, sampling and timestamps.

### 11.2 Creative DNA record

For every asset persist: campaign objective, brand profile version, audience segment, offer, platform, format, concept angle, hook, CTA, creative style, asset references, skill/AI model versions, generation prompt digest, dimensions/duration, approval status, publishing IDs and outcomes. Use this structured metadata to compare compatible creative variants—not simply vector-similarity retrieval of prior posts.

### 11.3 Pipeline

1. Ingest organic metrics via Postiz per authorized account; in M6 ingest paid/ad analytics separately. Store raw provider payload snapshot and normalized metric rows.
2. Link metrics to publication -> creative version -> campaign -> tenant/brand and objective. Record measurement intervals and data freshness.
3. Apply eligible comparison groups: comparable objective, channel, placement, time period, audience and spend; show missing/confounding variables.
4. Identify hypotheses, not guarantees. Rank by evidence quantity and relevance. Where possible prefer controlled randomized variants; use GrowthBook for applicable in-app experiments, and platform-native ad experiments for paid channels.
5. Produce a **Learning Insight** with statement, supported observations, sample size/time window, source IDs, confidence assessment, risk of bias and recommended next experiment.
6. User reviews/accepts a proposed test. A new creative brief includes `learning_insight_ids` and controlled variation goals. Brand facts never change as a side effect.

### 11.4 No premature “autonomous brain” claims

Start with rule-based baselines and evidence-linked suggestions. Later, after enough statistically useful data, evaluate learning-to-rank/contextual bandit selection with safeguards. GrowthBook is optional, and it does not automatically connect to ad networks. Do not fine-tune a giant model or build a proprietary recommender at MVP before proving the event pipeline and human feedback loop.

---

## 12. Database schema, tenancy, audit and event model

Recommended PostgreSQL entities (naming can change after migrations but contracts must remain). Every tenant-owned table either carries `organization_id` directly or has proven safe joins and RLS policies. Use UUID/ULID and `created_at/updated_at` where applicable.

| Table | Essential fields (additional audit fields omitted) |
|---|---|
| `organizations` | id, name, status, plan, data_region |
| `organization_members` | id, organization_id, user_id, role, status |
| `brands` | id, organization_id, name, website, status, active_profile_version_id |
| `onboarding_sessions` | id, organization_id, brand_id, status, step, progress, resumable_token |
| `crawl_jobs` | id, organization_id, brand_id, seed_url, scope_json, status, coverage_json |
| `brand_sources` | id, organization_id, brand_id, type, uri/storage_key, hash, captured_at, parser_version |
| `brand_documents` | id, organization_id, brand_id, source_id, filename, mime, processing_status |
| `brand_findings` | id, organization_id, brand_id, field_key, suggested_json, evidence_json, confidence, review_status, reviewed_json, reviewed_by |
| `brand_conflicts` | id, organization_id, brand_id, finding_ids, decision, resolved_by |
| `brand_profiles` | id, organization_id, brand_id, version, structured_json, status, approved_by, activated_at |
| `knowledge_chunks` | id, organization_id, brand_id, source_id, profile_version_id, text, embedding, source_anchor |
| `products` | id, organization_id, brand_id, facts_json, approval_status, last_verified_at |
| `audiences` | id, organization_id, brand_id, description_json, status |
| `skill_registry_entries` | id, name, source_digest, version, manifest_json, enabled |
| `skill_executions` | id, organization_id, brand_id, skills_json, profile_version_id, model_calls_json, trace_id, state, cost |
| `campaigns` | id, organization_id, brand_id, objective, channels, state, strategy_json |
| `creative_briefs` | id, organization_id, campaign_id, scope_json, source_refs_json, profile_version_id |
| `creatives` | id, organization_id, brand_id, campaign_id, format, state |
| `creative_versions` | id, organization_id, creative_id, version, project_json, metadata_json, approved_by |
| `assets` | id, organization_id, brand_id, creative_version_id, type, storage_key, sha256, dimensions, duration |
| `approvals` | id, organization_id, target_type, target_id, decision, reviewer_id, comment, timestamp |
| `social_connections` | id, organization_id, brand_id, channel, external_ref, permission_status, secret_ref |
| `publications` | id, organization_id, brand_id, creative_version_id, connection_id, provider_post_id, schedule_at, state, idempotency_key |
| `performance_snapshots` | id, organization_id, brand_id, publication_id, source, interval_start/end, raw_json, metrics_json, ingested_at |
| `experiments` | id, organization_id, brand_id, hypothesis, objective, allocation_plan, state |
| `experiment_variants` | id, organization_id, experiment_id, creative_version_id, assignment_json |
| `learning_insights` | id, organization_id, brand_id, evidence_refs_json, conclusion, uncertainty_json, proposed_test_json |
| `provider_jobs` | id, organization_id, brand_id, vendor, external_job_id, state, retry_count, started/ended_at |
| `usage_events` | id, organization_id, provider, operation, units, estimated_cost, actual_cost, idempotency_key |
| `credit_ledger` | id, organization_id, event_type, amount, currency, balance_after, provider_job_id |
| `audit_events` | id, organization_id, actor_type/id, action, object_ref, before_hash, after_hash, timestamp |

Indexes: `(organization_id,brand_id,...)` for every hot path; unique idempotency keys; appropriate Postgres RLS policies tested under non-admin DB roles; vector retrieval must include tenant/brand predicates. Strong FK relationships and transactional outbox for publication events.

### 12.1 Required event types

`brand.onboarding_started`, `brand.crawl_completed`, `brand.finding_reviewed`, `brand.profile_activated`, `skill.execution_started/completed/failed`, `creative.version_created`, `creative.approved`, `media.video_submitted/completed/failed`, `publication.scheduled/published/failed`, `analytics.snapshot_ingested`, `learning.insight_created`, `billing.usage_recorded`.

Events require event_id, timestamp, org_id/brand_id, correlation_id, producer, schema_version, idempotency key and minimum-necessary payload. Integrations should consume via durable outbox/replay rather than relying on in-process callbacks for business guarantees.

---

## 13. Our application API (not third-party API claims)

REST endpoints listed below are **to be implemented by us**. Use OpenAPI contracts and generate TS/Python clients; version `/api/v1`.

```text
POST   /api/v1/organizations
POST   /api/v1/brands
POST   /api/v1/brands/:brandId/onboarding
POST   /api/v1/brands/:brandId/discovery-jobs
GET    /api/v1/brands/:brandId/discovery-jobs/:jobId
GET    /api/v1/brands/:brandId/findings
PATCH  /api/v1/brands/:brandId/findings/:findingId
POST   /api/v1/brands/:brandId/uploads/presign
POST   /api/v1/brands/:brandId/documents
GET    /api/v1/brands/:brandId/conflicts
POST   /api/v1/brands/:brandId/conflicts/:conflictId/resolve
POST   /api/v1/brands/:brandId/profile/activate
GET    /api/v1/brands/:brandId/profile/versions
POST   /api/v1/campaigns
POST   /api/v1/campaigns/:id/plan
POST   /api/v1/campaigns/:id/generate
GET    /api/v1/jobs/:id
POST   /api/v1/creatives/:id/versions
POST   /api/v1/creatives/:id/generate-image
POST   /api/v1/creatives/:id/generate-video
POST   /api/v1/creatives/:id/approve
POST   /api/v1/creatives/:id/reject
POST   /api/v1/creatives/:id/export
GET    /api/v1/brands/:brandId/connections
POST   /api/v1/publications
GET    /api/v1/publications/:id
GET    /api/v1/analytics/brands/:brandId
GET    /api/v1/insights/brands/:brandId
POST   /api/v1/experiments
GET    /api/v1/usage
POST   /api/v1/webhooks/higgsfield        # verify provider authenticity
POST   /api/v1/webhooks/postiz            # verify provider authenticity
```

All endpoints require authenticated organization-scoped authorization. Async creation returns `202 Accepted` plus `job_id`, progress URL and user-friendly task stages. `POST` endpoints that create externally billed jobs or publications require a client-provided idempotency key. The frontend must never call provider APIs with privileged credentials directly.

### 13.1 Sample brand finding response

```json
{
  "id": "finding_123",
  "brand_id": "brand_123",
  "field": "brand_voice",
  "proposal": ["educational", "friendly"],
  "source_evidence": [{"source_id": "src_1", "uri": "https://example.com/about", "anchor": "paragraph-3"}],
  "inference_type": "model_inference",
  "confidence_label": "medium",
  "review_status": "unreviewed",
  "reviewed_value": null
}
```

### 13.2 Sample editable creative project

```json
{
  "schema_version": 1,
  "brand_id": "brand_123",
  "creative_id": "cr_123",
  "page_size": {"width": 1080, "height": 1350},
  "profile_version": 4,
  "template_id": "tmpl_product_01",
  "layers": [
    {"id": "background_1", "kind": "image", "asset_id": "asset_1", "editable": true},
    {"id": "headline_1", "kind": "text", "text": "A simpler daily routine", "font_token": "brand.heading", "editable": true},
    {"id": "logo_1", "kind": "image", "asset_id": "approved_logo", "editable": false}
  ]
}
```

Use a production-ready, versioned schema with positioning/transform/text metrics; examples above show required relationships, not full Fabric.js serialization.

---
## 14. State machines, orchestration and failure recovery

### 14.1 Required job states

Do not model every async operation as an opaque `running` flag. Define explicit states and transition guards:

| Workflow | Required states | Irreversible/guarded transition |
|---|---|---|
| Onboarding | `CREATED -> DISCOVERING -> DRAFT_READY -> REVIEWING -> ACTIVE` plus `PARTIAL`, `FAILED`, `CANCELLED` | `ACTIVE` requires approval of minimum brand facts |
| Document ingestion | `UPLOADED -> SCANNING -> PARSING -> INDEXING -> READY`, with `REJECTED/FAILED` | Extraction never directly edits an active brand profile |
| Image generation | `QUEUED -> BRIEF_READY -> GENERATING -> COMPOSING -> QA -> REVIEW_READY` or `FAILED/CANCELLED` | Final creative approval binds exact asset version |
| Video generation | `QUEUED -> STORYBOARD_READY -> SUBMITTED -> WAITING_PROVIDER -> DOWNLOADING -> RENDERING -> QA -> REVIEW_READY` or `FAILED/CANCELLED` | External job ID + per-attempt billing record must be persisted before retry |
| Publication | `DRAFT -> AWAITING_APPROVAL -> APPROVED -> SCHEDULE_PENDING -> SCHEDULED -> PUBLISHING -> PUBLISHED` or `FAILED/CANCELLED/UNKNOWN` | Cannot schedule unapproved content; cannot mark published without provider evidence |
| Performance ingestion | `QUEUED -> FETCHING -> NORMALIZING -> LINKING -> AVAILABLE`, or `PARTIAL/FAILED` | Do not hallucinate missing metrics |

Store state changes as database transactions with durable outbox records. Use Temporal for orchestration of idempotent activities; do **not** use it as a replacement for application authorization or data integrity. The UI receives event/stream/poll progress from **our API**. Document and video tasks must survive restarts and worker termination.

### 14.2 Retry, cancellation and consistency rules

- Distinguish **safe retries** from **potentially billed** generation calls or **potentially duplicated** posts; never blindly resubmit a request after a timeout without reconciling remote job/post status.
- Use bounded exponential backoff with jitter for transient provider failures; classify 4xx/permissions/unsupported-media errors as user-action-needed, not infinite retries.
- A cancellation request stops pending work and attempts provider cancellation only when documented; already-incurred API costs stay accounted for.
- Reconciliation jobs poll stuck provider operations and publishing jobs; discrepancies between local and provider state must be visible in an operations dashboard.
- For unavailable vendors, show a transparent failure/degraded mode. Text-only drafts and already-created assets should remain accessible.
- Log every external call with a correlation ID, sanitized request digest, duration, response status, token/credit units (where applicable) and vendor job reference.

---

## 15. Design and interaction contract — make the product feel better than a collection of tools

The experience must be a **single, original, responsive SaaS UI**, not a framed or re-skinned Postiz panel and not a third-party model playground. A different vendor's proprietary screen layout is not a template to copy.

### 15.1 Key UX requirements

1. **Brand creation:** One primary field — brand website — plus an optional "I don't have a website" path. Start discovery immediately after submit, save session progress and surface partial findings as they become available.
2. **Verification UI:** Findings grouped into *About, Audience, Products, Visual Identity, Voice, Rules*. Each has source citation(s), `Correct`, `Wrong`, `Edit`, `Skip`; users can submit a free-form correction, which updates dependent unapproved hypotheses. Show unresolved discrepancies without forcing irrelevant questions.
3. **Upload experience:** Add brand guidelines before, during or after crawl; accept PDF/PPTX/DOCX/images/catalogs, show per-file extraction status and page/slide evidence; visibly flag conflicts between website and documents.
4. **First creative moment:** Offer three useful sample concepts after minimum verified info. Show editable previews promptly; allow rejection, variants and brand correction without navigating away.
5. **Campaign composer:** User chooses objective, channels, post quantities, date range and optional creative mix using normal-language input or structured controls. Show **draft strategy first**, then asset generation cost estimate, then render progress.
6. **Creative Studio:** Side-by-side versions; editable text, logos, colors and placement; mask/regenerate/edit images; brand template assets; multi-slide carousel; autosave/history/export; aspect ratio presets. Unapproved AI suggestions never override manual edits.
7. **Video Studio:** Script/storyboard approval, scene card previews, image/reference selection, per-scene regeneration, subtitles and audio tracks, editable overlays/CTA end card, rendered preview and export history. V1 does not require a full nonlinear editor.
8. **Calendar & approval:** Week/month/list views, channel cards, queue status, batch review, scheduled/published/error badges with actionable reasons. Customer actions call **our** APIs; Postiz remains unseen.
9. **Insights:** Distinguish real engagement statistics from interpreted learning hypotheses. Always show source, period, metric definitions, missing data and confidence/evidence strength.
10. **Account experience:** Brand switcher, team invitations, roles, activity feed, media library, quota/credits remaining, invoices and support paths. No unexplained vendor terminology.

### 15.2 User-facing error handling and accessibility

- A missing provider credential is an admin configuration error, not an empty output. Provide helpful test/mock-mode behavior for developers, but never label mock outputs as real campaigns.
- On crawl failure, permit document-based/manual onboarding. On image/video failure, preserve brief and drafts, allow safe retry or alternate format.
- On social publishing failure, retain approved creative and scheduling intent; present platform-specific next steps and retry controls.
- Use semantic accessibility patterns, keyboard-operated review/edit controls, clear focus states, readable contrast, reduced-motion settings, and mobile-friendly approvals. Verify supported WCAG 2.2 AA criteria during QA.
- Localize the UI foundation from day one (locale/time zone/currency fields), even if English is the first shipping language. Use tenant time zones consistently for scheduling and daylight-saving changes.

### 15.3 Product-level feature flags

`brand_discovery`, `document_uploads`, `skill_runtime`, `gpt_images`, `higgsfield_video`, `creative_canvas`, `social_connections`, `postiz_publish`, `analytics_ingestion`, `learning_insights`, `paid_meta_ads`.

Each flag supports internal-only/test tenants and kill switches. A flag must not bypass authorization or approval checks.

---

## 16. Multitenant SaaS, security, privacy and compliance

### 16.1 Identity and isolation

- The customer has an account in **our** system. A user may be member of several organizations with different permissions; brands belong to exactly one organization.
- Implement RBAC at the API and job worker levels: `owner`, `admin`, `editor`, `reviewer`, `analyst`, with explicit permitted actions. Define a support/admin impersonation protocol with audit and consent controls.
- Apply PostgreSQL row-level security or equivalently strong proven isolation in addition to application-level checks. Repositories, vectors, object keys, caches, skill mounts, jobs, publications and metrics are all scoped by organization and brand.
- Use least-privilege Postiz integration credentials, per-tenant/connection mapping and tested read/write isolation. **Never ship a single shared unrestricted provider token usable to operate every customer's accounts.**
- Encrypt provider/social secrets with managed key material and rotation support. Do not put them in prompts, traces, frontend bundles, URLs, skill files or normal logs.

### 16.2 Untrusted input boundaries

- Websites, uploaded brand guides, catalogs, image metadata, social comments and model output are all untrusted content. Treat embedded instructions as *content to analyze*, not runtime authority. There must be a hard trust boundary between source data and skill/platform policy.
- Secure crawlers against SSRF, DNS rebinding, private-range targets, open redirects, enormous responses, malicious page scripts, credential leaks and uncontrolled subdomain/cross-domain discovery.
- Parse files in restricted containers with malware scanning, resource budgets, ZIP traversal/bomb checks and no ambient customer or provider secrets.
- Sandbox executable skill helper code. By default skills are **instruction-only**. Only explicitly reviewed and packaged executables get network/tool access; use tool allowlists and short-lived grants.
- Filter/validate provider callback origins according to official webhook guidance. If provider signature verification is not documented, don't invent a security guarantee: use authenticated endpoint design and outbound status verification/reconciliation.
- Add abuse prevention for signups, crawling, external API costs, bulk generation, rate limits and uploading prohibited/illegal content. Implement provider policy checks and user-facing appeal/escalation mechanisms.

### 16.3 Commercial deployment issues

This is a technical product spec, **not legal advice**. Prior to offering a closed-source SaaS, have counsel review Postiz **AGPL-3.0** and all selected dependencies; determine applicable network-source availability requirements, attribution notices and modification distribution obligations. Treat deploying Postiz as a separate service as an **architecture boundary, not automatic license immunity**. Also inspect FFmpeg codecs/build flags and any open-core limits in hosted or enterprise products.

Customers own their connected accounts and have an explicit data deletion/export path. Create retention windows for website snapshots, generated media, traces and performance data; ensure deletion propagates to object storage/queues/vector indexes/backups on a documented schedule. Validate applicable privacy and marketing rules in target launch markets before production.

### 16.4 Non-functional release gates (targets, not claims)

| Concern | Acceptance target | How to prove |
|---|---|---|
| Cross-tenant isolation | Zero successful cross-tenant reads/writes in adversarial test suite | Negative API/RLS/cache/object-store/tool-mount tests |
| Brand context isolation | No known Brand B data in Brand A generation context | Automated fixture attacks + reviewed trace captures |
| User task recoverability | No loss of accepted changes on worker restart or page reload | Fault-injection/resume E2E suite |
| Durable async pipeline | Every external generation/publishing attempt has an auditable terminal or investigated state | Reconciliation tests + operators' dashboard |
| Paid spend controls | No ad launched or budget raised without authorized approval and cap | Security tests; deny-by-default |
| Generation cost integrity | Billed credits correlate to immutable usage ledger and provider outcomes | Invoice/ledger reconciliation tests |
| Customer access | App frontend and core API usable without Postiz/agent vendor UI | E2E browser test across all core flows |
| Operational health | Dashboards for queue age, provider errors, costs, API latency, publish failures | Instrumented staging environment |

---

## 17. Cost controls, quota management and billing

The platform pays provider API costs. The customer doesn't need an OpenAI/Higgsfield account. Cost controls must be intrinsic, not a dashboard added after the first large bill.

- Maintain a versioned provider/model pricing catalog and per-tenant currency policy; never hard-code a single cost per image/video because price changes with model/resolution/duration.
- Before dispatch, estimate the maximum cost and **reserve** tenant credits atomically. After terminal outcome, settle estimated vs actual usage from reliable provider data; reconcile disputed provider costs without double-charging.
- Track metered operations: text tokens, image create/edit variants, reference images, video duration/resolution/generations, storage/transcoding, publisher and analytics work where billable.
- Tenant budgets: per-job max, daily/monthly spend caps, concurrent video limits, retry caps, quotas by plan; enforce in API **and** worker submission layer.
- Implement distinct ledgers for **provider cost**, **customer credits**, **refunds/adjustments** and billing events. No negative-credit race conditions.
- Use a payments provider for subscriptions/invoices (e.g., Stripe) behind a billing abstraction; no raw card data. Webhooks are verified and idempotent. Free trial and downgrade should retain user data according to published policy.
- Offer low-resolution previews and draft copy before costly rendering; rerendering text/logo overlay should not call Higgsfield again.

**Not an accurate implementation:** a front-end counter decremented when the button is clicked, without locking, ledger writes, async settlement or concurrency tests.

---

## 18. Performance, availability, and thousands-of-customers scale plan

**Thousands of registered customers is not the same as thousands of concurrent Higgsfield jobs.** Codex must size by measured workload and model-provider quotas, not arbitrary instance counts.

### 18.1 Architecture for scale

- Stateless Next.js and NestJS app replicas behind an ingress/load balancer; database connection pooling and sensible limits.
- Managed PostgreSQL with automated backups, PITR, tested restore, indexed tenant queries and vector indexes; offload bulk analytics when evidence justifies ClickHouse or a warehouse.
- Object storage + CDN, lifecycle policies, private presigned access, secure media transformations and deduplicated content hashing where allowed.
- Separate queues/task-worker pools for crawl, document parse, text AI, image API, video polling, FFmpeg rendering, publishing adapter and analytics ingestion.
- Temporal workers use per-activity limits, concurrency controls, workflow timeout budgets and selective backpressure. Video provider limits and costs are managed globally and per tenant.
- Postiz runs as an independently scalable component only after verified actual queue/publishing behavior and API rate limits; monitor connected account expiration and provider health.
- All partner/provider interfaces have circuit breakers, caps, explicit degraded modes and status reconciliation, not infinite retry loops.

### 18.2 Load-test workload definition

Define a reproducible test suite with tenant and concurrency distributions. Example **test profile**, not projected traffic:

- 5,000 synthetic tenants, at least two brands each, permission fixtures and seeded approved profiles.
- 500 concurrent active web users browsing/reviewing/editing; a separate burst of 100 brand discovery requests.
- Queue spikes: 200 text-generation requests, 100 image-generation requests and 50 video submissions, using **mock vendors** to verify local behavior without unexpected external spend.
- Bulk scheduling attempts limited by a simulated Postiz/API rate budget; verify queue prioritization and safe retries.
- Adversarial scenarios: provider 429/500/timeouts, lost webhooks, worker kill, database failover test environment, repeated idempotency keys and cross-tenant authorization attempts.

Record p50/p95/p99 UX/API response times, queue wait, task success rate, duplicate publications, DB CPU/connections, storage costs and per-tenant fairness. Select performance targets from user experience/SLO budgets during the first staging benchmark; do not invent production measurements.

### 18.3 Operational readiness

- Structured logs, distributed tracing (include Langfuse for model/skill traces where appropriate), metrics/alerts, pager escalation, job replay tooling and human-visible provider incidents.
- CI/CD with dependency/security scans, container image signing, migrations/rollback plan, feature flags, canary deployments and credential rotation.
- Scheduled database backups + tested recovery and object-store retention. Disaster recovery objectives (RPO/RTO) must be agreed and tested before production.
- Separate staging/prod model credentials, domains, social developer apps, databases, queues and buckets.
- Formal go/no-go checklist for incident handling, data deletion, privacy policy, billing correctness, customer support and vendor quota contracts.

---

## 19. Implementation milestones — Codex execution order

**Hard acceptance contract:** [`INTEGRATION_FIRST_BUILD.md`](INTEGRATION_FIRST_BUILD.md) defines a strict internal state machine: `NOT_IMPLEMENTED → MOCKED → ADAPTER_READY → LIVE_VERIFIED → LAUNCH_READY`. **Do not count** mock-connected views, sample analytics, fake post IDs, or UI-only work as completed features. Codex must implement the real adapter, persistence, durable workflow, tests and readiness reporting before polishing each UI. A blocked upstream SDK/social OAuth/legal issue is a documented blocker, not an excuse to silently mark the feature finished.

**Codex must implement, test and commit only independently verifiable slices.** The design below is not a claim these integrations already exist. Every milestone must produce code, migrations, tests, a short demo and an evidence report.

### M0 — Repository audit and architecture proof (mandatory; no product feature claims)

**Tasks:** Import `PRODUCT.md` into repository; inspect Postiz tree and the supplied skills archive; pin dependency commits; start Postiz unchanged; test publicly documented API; check AGPL and tenant model; run isolated Deep Agents skill-reading experiment; validate GPT Image edit and Higgsfield video operations with mocks or configured dev keys; commit ADR and integration matrix.

**Deliverables:** `docs/adr/0001-reuse-decisions.md`, `docs/POSTIZ_API_MATRIX.md`, `docs/SKILL_AUDIT.md`, `docs/PROVIDER_CAPABILITIES.md`, lockfile/commit manifest, running local Docker stack.

**Gate:** Actual tested Postiz operations documented; no unsupported endpoint assumptions; identified licensing/isolation blockers have explicit owners/decisions.

### M1 — SaaS foundation and brand workspace

**Tasks:** Next.js app, backend/API, auth, organizations, brand entities, RBAC, PostgreSQL/RLS, object storage, durable jobs, audit/credit ledger scaffolding, feature flags, `GET /health`, observability and local mock providers.

**User demo:** Create an account/organization, invite an editor, add two brands, navigate the custom dashboard, resume sessions, verify access boundaries.

**Gate:** Tenant isolation E2E + RLS negative tests pass; app works without showing Postiz; safe deploy and migrations documented.

### M2 — Smooth onboarding and approved Brand Brain

**Tasks:** Bounded Crawl4AI website ingestion, Docling document import, source-linked extraction, visual guidelines, product discovery, Correct/Wrong/Edit review, conflict UI, minimum-question progress, brand profile activation/versioning, virtual `.agents/product-marketing.md`, semantic retrieval and first useful preview brief.

**User demo:** Enter website, approve/correct three findings, upload PDF/PPTX, resolve a conflicting brand color, generate approved Brand Brain v1, refresh it without overwriting prior version.

**Gate:** Provenance, prompt-injection/SSRF controls, resumability, brand isolation and no undocumented facts in active profile; manual-only brand also succeeds.

### M3 — Skill-powered image/social campaign + organic publication (first vertical slice)

**Tasks:** Skill registry + curated Deep Agents tools, strategy/calendar, GPT Image generation/editing, Fabric.js editable ad/carousel templates, brand QA, approval queue, Postiz headless account integration where proven, upload/scheduling/reconciliation, LinkedIn and Instagram channel presets.

**User demo:** Using one Brand Brain, request five LinkedIn posts + three branded images, edit creative text and layout, approve a selected post, connect account and schedule using Postiz, then retrieve status.

**Gate:** Real provider integration against dev/sandbox environments where credentials are configured; deterministic mocks otherwise clearly labelled. **Cannot ship tenant-wide Postiz integration until isolated account control is proven.**

### M4 — Higgsfield video, unified calendar and organic analytics

**Tasks:** Skill-driven storyboard, approved reference stills, Higgsfield submit/status/download adapter, FFmpeg composition, subtitles/end cards, scene revisions, video QA, cross-channel schedule UI, Postiz analytics sync, creative/version/performance linkage.

**User demo:** Generate a 15-second brand video, replace a scene, export, approve, schedule it on one supported account, show actual publish/analytics state.

**Gate:** Restart and provider-timeout recovery; cost/credits accurate; exports persist after provider URL expires; failed posts safely reconcile.

### M5 — Evidence-based learning and production hardening

**Tasks:** Creative DNA tagging, Langfuse tracing/evals, organic metric normalization, learning insight quality checks, experiment proposal/approval, billing/credits finalization, security audit, load/failure testing, operations runbooks and support tools.

**User demo:** Compare compatible historic posts, see evidence and limitations, accept one experiment, produce new variants using approved facts, inspect exact skill/model/creative version lineage.

**Gate:** All launch criteria in §16–18 and §20 pass, with reproducible tests. Thousands-of-customer readiness requires load-test and vendor-capacity evidence, not a marketing claim.

### M6 — Paid ads (separate release; do not silently conflate with Postiz)

**Tasks:** Meta Marketing API account onboarding, ad creation, explicit budgets, ad-review compliance, attribution/measurement, platform-native experiment configuration, spend approvals, later Google/TikTok connectors if feasible.

**User demo:** Authorized advertiser creates a draft Meta campaign, reviews exact budget/targeting/creative, explicitly approves launch, reads real spend and conversion reports, runs a guarded test.

**Gate:** Permissions, ad account ownership, platform policy, fraud/spend controls and reconciliation proven. No auto-launch or budget change without approved role and hard cap.

### 19.1 Deliverable template after each pull request

Every Codex PR summary **must** contain:

```text
PR title and milestone:
Changed file paths:
Migrations / new environment variables:
Services booted locally:
Manual demo steps:
Tests run with actual output:
Security/tenancy tests:
External API methods verified against pinned version:
Known blockers, workarounds and TODOs:
Next smallest demonstrable slice:
```

**Never** claim a failed, skipped or mocked external integration was tested against a real provider. Distinguish mock E2E, staging and live results.

---

## 20. Definition of done: critical end-to-end acceptance matrix

| ID | Customer scenario | Required observed outcome | Phase |
|---|---|---|---|
| E2E-01 | Website-only new brand | Crawled draft + source coverage + owner review + approved Brand Brain | M2 |
| E2E-02 | No website, documents only | PDF/PPTX upload + corrected fields + brand activation | M2 |
| E2E-03 | Website vs brand guide conflict | User selects correct branding; output uses selected colors/logo | M2–M3 |
| E2E-04 | Unverified medical/pricing claim | Creative stopped for review, no false approved claim | M3 |
| E2E-05 | LinkedIn post generation | Actual `social` skill + brand context produces draft and editable text | M3 |
| E2E-06 | GPT Image create/edit | Uses real OpenAI adapter in authorized env, asset stored, editor changes without recreating entire image | M3 |
| E2E-07 | Carousel from product data | Dynamic template generates editable pages with accurate product variables | M3 |
| E2E-08 | Instagram scheduling | Approved creative uploaded, posted/scheduled through **verified** Postiz operations | M3 |
| E2E-09 | Higgsfield video job | Actual endpoint submission, correct async status, download, FFmpeg render, editable timeline metadata | M4 |
| E2E-10 | Kill worker mid-video | Durable recovery without duplicate provider bill or missing credit settlement | M4 |
| E2E-11 | Scheduled post timeout | No duplicate remote post; reconciliation or operator action required | M3–M4 |
| E2E-12 | Analytics linkage | Real metrics attached to specific creative and publishing IDs; missing metrics labeled | M4–M5 |
| E2E-13 | Quality learning loop | Insight cites evidence, next brief preserves approved brand facts | M5 |
| E2E-14 | Tenant isolation | User A unable to access/publish User B data/credentials across API, Postiz, retrieval, files and queues | Every phase |
| E2E-15 | Usage and billing | Atomic reserve/settle/refund matches generation outcomes under concurrency | M5 |
| E2E-16 | Product without tool UIs | Complete customer flow uses only our UI and service backend | M3+ |
| E2E-17 | Large-tenant stress | Load profile in §18 runs within agreed SLO/error budgets; full failure report stored | M5 |
| E2E-18 | Paid campaign approval | Unauthorized users cannot launch/change budget; advertiser owner approval audited | M6 |

### 20.1 Minimum production launch gate (organic-focused release)

**Proof requirement:** The running implementation must generate `docs/evidence/integration-status.json` and a `make release-gate` or equivalent command that fails for missing real provider verification, enabled production mocks, tenant-isolation failures, missing app approvals or unresolved licensing/security blockers. See `INTEGRATION_FIRST_BUILD.md` for the gating matrix and `CONFIGURE_AND_LAUNCH.md` for operator-facing setup requirements. Screenshots alone do not satisfy acceptance.

Must have successful evidence for E2E-01 through E2E-17 relevant to enabled features (including real-provider happy paths for enabled public features), explicit Postiz tenancy decision, commercial license review, required social platform app approvals, security findings resolved, working backup/restore, quotas and billing safeguards, production alerting and support runbooks. Paid capability E2E-18 is **not** a prerequisite if paid ads are clearly disabled and not promised.

### 20.2 Measurable quality evaluation suite

Build an evaluation dataset using at least **three fictional brand fixtures** with distinct positioning, logos/colors and audiences. For each skill, test source faithfulness, brand voice, approved claims, platform dimensions, formatting, refusal to fabricate product facts, rejection-repair behavior and context isolation. Track version-to-version acceptance/edit rate, provider cost, manual edit distance and human satisfaction. Use Langfuse evaluations with optional human labels. Do not use the same LLM as the sole arbiter of its own factual accuracy.

---

## 21. Environment, config and provider integration checklist

Create `.env.example` with **placeholders only**. Confirm exact variables from pinned SDK versions and do not assume every optional OSS component needs its own credential.

```dotenv
# Our app (placeholders only)
APP_PUBLIC_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:4000
DATABASE_URL=postgresql://app:password@localhost:5432/marketing_os
TEMPORAL_ADDRESS=localhost:7233
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_BUCKET=marketing-os-dev
OBJECT_STORAGE_ACCESS_KEY=replace-me
OBJECT_STORAGE_SECRET_KEY=replace-me
REDIS_URL=redis://localhost:6379

# Server-side AI providers; never shipped to the browser
OPENAI_API_KEY=replace-me
HF_CREDENTIALS=replace-with-key-id:secret
PORTKEY_GATEWAY_URL=http://localhost:8787

# Postiz adapter — inspect actual auth model in the pinned version
POSTIZ_BASE_URL=http://localhost:5000
POSTIZ_SERVICE_SECRET=replace-me

# Optional observability/experimentation
LANGFUSE_PUBLIC_KEY=replace-me
LANGFUSE_SECRET_KEY=replace-me
LANGFUSE_BASE_URL=http://localhost:3001

# Safety defaults
MOCK_EXTERNAL_PROVIDERS=true
DEFAULT_TENANT_MAX_JOB_USD=5
DEFAULT_TENANT_MAX_MONTHLY_USD=100
REQUIRE_HUMAN_APPROVAL=true
ENABLE_PAID_ADS=false
```

These are **proposed application variables**. Codex must update the final `.env.example` after checking current dependencies and actual Postiz deployment settings. No real credentials or token-like samples belong in git. CI should use fake vendors and fixtures; real paid-provider tests are opt-in and limited to explicit spending budgets.

### 21.1 Mandatory adapter compliance tests

For each adapter (Postiz, OpenAI, Higgsfield, Portkey if enabled, Docling, Crawl4AI): prove supported operations, input schema validation, mock contract tests, timeout/cancellation/retry handling, auth failure behavior, structured telemetry, idempotency/reconciliation rules, and cost/metering where relevant. Record vendor SDK/package versions in lockfiles and ADR.

---

## 22. References, verification and licensing register

**Repository references below are source pointers, not evidence that they compose automatically into a working application.** Inspect the exact pinned version, upstream documentation and license before release.

| Component | Canonical source |
|---|---|
| Postiz | https://github.com/gitroomhq/postiz-app |
| Deep Agents | https://github.com/langchain-ai/deepagents |
| LangGraph | https://github.com/langchain-ai/langgraph |
| Portkey OSS Gateway | https://github.com/Portkey-AI/gateway |
| OpenAI Node SDK / API docs | https://github.com/openai/openai-node · https://platform.openai.com/docs |
| Official Higgsfield TypeScript SDK / docs | https://github.com/higgsfield-ai/higgsfield-js · https://docs.higgsfield.ai/ |
| Fabric.js | https://github.com/fabricjs/fabric.js |
| FFmpeg | https://github.com/FFmpeg/FFmpeg |
| Crawl4AI | https://github.com/unclecode/crawl4ai |
| Docling | https://github.com/docling-project/docling |
| PostgreSQL / pgvector | https://github.com/postgres/postgres · https://github.com/pgvector/pgvector |
| Temporal | https://github.com/temporalio/temporal |
| Langfuse | https://github.com/langfuse/langfuse |
| GrowthBook (optional) | https://github.com/growthbook/growthbook |
| Marketing Skills supplied by customer | https://github.com/coreyhaines31/marketingskills (also distributed in attached archive) |

**Decision log required:** `component`, `repo URL`, `pinned git SHA/version`, `license and commercial implications`, `actual reused modules`, `actual missing capabilities`, `integration test location`, `upgrade plan`, `fallback strategy`, `owner`, `status`. Use ADRs and a source-controlled register; never state a vendor capability was verified unless the integration test passed.

---

## 23. Codex launch instructions — what to do first

**Initial mission:** build the app such that after code development, an operator configures external accounts, API keys, DNS/OAuth app settings, funding and deployment—and then runs verified features without writing application code. It is **not honest** to promise keys alone cover social platform approval, deployment, legal license decisions or live test credentials. All required functionality and the setup UX must be built and tested by Codex before calling the software done. Follow `INTEGRATION_FIRST_BUILD.md` and `CONFIGURE_AND_LAUNCH.md` as the execution/release contracts.

### Input artifacts

1. This **`PRODUCT.md`** at repository root — source of truth for product behavior.
2. A checked-out **Postiz** release (prefer independent sibling repo or pinned submodule), with git SHA and official deployment documentation.
3. The supplied **`marketingskills-main (1).zip`** archive, to be imported into `vendor/marketing-skills/` with license, checksum, inventory and approved adapters.
4. Dev environment capable of Docker Compose and supporting PostgreSQL, Temporal and a local S3-compatible store. Live OpenAI/Higgsfield keys are optional until provider integration testing.

### First instruction to give Codex (copy and paste)

> Implement the Marketing OS product specified in `PRODUCT.md` as a new, customer-facing, multi-tenant SaaS, using **Postiz only as hidden organic-publishing infrastructure**. Import and validate the 52 Marketing Skills; run them through a constrained Deep Agents runtime with tenant-specific approved Brand Brain context. Use OpenAI's GPT Images for image generation and Higgsfield's official video API for video generation; integrate their SDKs on the server. Reuse Crawl4AI, Docling, PostgreSQL/pgvector, Fabric.js, FFmpeg, Temporal and Langfuse as specified. **Begin by auditing the checked-out Postiz repository, the skills archive and current provider APIs and licenses; do not invent integration endpoints.** Write the ADR and integration test plan, then implement M1–M5 as small testable PRs, demonstrating the first end-to-end organic posting slice before expanding scope. No model/vendor coding app may be required of customers, no third-party dashboard is the customer UI, no cross-tenant access is acceptable, and no content is published or paid money spent without approved policy.

### Immediate task list (in order)

1. Record `git rev-parse HEAD` for Postiz and inspect the actual package tree and API handlers; create an integration coverage matrix with **proven** vs. **not supported** endpoints.
2. Import the skills archive without executing scripts; inventory all 52 skills, validate frontmatter/source licensing and compute SHA-256 for each `SKILL.md` and supporting artifact. Create a skill registry index and three curated test policies: LinkedIn writing, static image ad, video ad.
3. Generate `docs/adr/0001-reuse-decisions.md`, `docs/SECURITY_THREAT_MODEL.md`, and `docs/RELEASE_GATES.md` based on the actual versions.
4. Scaffold frontend/API/worker packages, Docker dev dependencies, mocked provider SDK adapters, CI and contracts. Implement organization/brand/RBAC first.
5. Build the **thin end-to-end vertical slice**: fake brand website fixture → evidence-linked draft → review/correction → approved profile → `social` + `image` skill → mocked GPT image asset → Fabric editable preview → approval → mocked Postiz schedule → status reconciliation.
6. Replace mocks incrementally with real provider calls in tightly metered development tenants, add Higgsfield scenes/video at M4, and capture trace/test proof for each adapter.
7. Only after E2E stability, extend to production accounts and learning. If a critical product requirement cannot be implemented with a selected OSS component, document a decision and choose a replaceable adapter rather than faking it.

**Definition of handoff completion:** Codex can start work with these inputs, identify the first PR, set up mock-based local development, and has unambiguous boundaries, contracts, quality gates, milestones and reference sources. **This document is not itself the implemented product.**


## Appendix: strict handoff and diagram assets

See [diagram gallery](diagrams/INDEX.md), [no-fake-features release gate](NO_FAKE_FEATURES_RELEASE_GATE.md), [first Codex prompt](CODEX_FIRST_PROMPT.md), [machine-readable evidence schema](contracts/integration-status.schema.json), and [build-state template](templates/BUILD_STATE.md). These are design and release specifications, not claims of running software.
