REPOSITORIES.md — Codex source-of-truth for third-party components
Purpose: Build a functional, custom-UI, multi-tenant Marketing OS inspired by the workflows of Blaze.ai. Reuse mature foundations; do not fork and rebuild dozens of projects. This is a source/dependency manifest, not a claim that these components already work together. Follow PRODUCT.md, ARCHITECTURE.md, INTEGRATION_FIRST_BUILD.md and NO_FAKE_FEATURES_RELEASE_GATE.md.

Customer runtime: No Codex/Cursor/Claude Code or Postiz frontend. AI runs behind our backend; users interact only with our platform.

What the owner must actually give Codex
1. This specification ZIP, containing PRODUCT.md, AGENTS.md, the design/architecture docs, and the original 52 Marketing Skills (inputs/marketingskills-main.zip). Skills source: https://github.com/coreyhaines31/marketingskills ; the provided archive is the input to import and audit, not a reason to overwrite it with GitHub main.
2. A local Postiz checkout cloned from https://github.com/gitroomhq/postiz-app and pinned to an audited commit. Store the commit hash in docs/THIRD_PARTY_LOCK.md; do not follow main automatically in production.
3. Later, valid test OpenAI and Higgsfield API credentials, social provider developer app/OAuth configuration, a test publishing account, and approved spending ceilings. These are not needed to write or offline-test typed adapters, but they are required to prove LIVE_VERIFIED status.
No need to download all repositories manually. Codex should use package managers for SDKs/libraries and image tags for services, pin exact versions, and clone source repositories only when it needs an upstream patch or genuine code audit. If Codex cannot access GitHub or package registries, make the limitation explicit; do not invent dependencies.
Component selection and reuse matrix
Integration modes: CHECKOUT = give it a pinned local checkout; LIB = install pinned package; SERVICE = deploy as a pinned container/managed equivalent; CLI/WORKER = install in isolated worker; OPTIONAL = defer until justified. P0 is critical for the first working release; P1 follows; P2 is intentionally optional.
Priority	Component and exact upstream	Mode	Reuse in Marketing OS	Our own engineering (not delivered by upstream)
P0	Postiz — https://github.com/gitroomhq/postiz-app	CHECKOUT + SERVICE	Internal publishing/scheduling engine, social connectors, uploads and documented analytics	Tenant-safe account/token mapping, branded connect/review/calendar UX, adapter, publish reconciliation, API limitations assessment, AGPL review
P0	Original Marketing Skills — https://github.com/coreyhaines31/marketingskills	OWNER ARCHIVE	SKILL.md instructions, references, marketing playbooks; source ZIP included	Audit and register skills by content hash, bind to vetted runtime tools, tenant-aware brand context, quality checks and logs
P0	Deep Agents — https://github.com/langchain-ai/deepagents	LIB	Skill middleware, progressive disclosure, tool-aware agent runtime	Job/policy guardrails, tool allowlists, actual marketing agent graphs, brand-scoped virtual filesystem
P0	LangGraph — https://github.com/langchain-ai/langgraph	LIB (Deep Agents dependency)	Stateful graph orchestration when useful	Use only where workflow branching demands it; do not invent a second agent framework
P0	OpenAI Node SDK — https://github.com/openai/openai-node	LIB	Official text, structured output and GPT image create/edit API integration	Brand brief compiler, reference image handling, output persistence, metering, retries, provider QA, editor serialization
P0	Higgsfield JS SDK — https://github.com/higgsfield-ai/higgsfield-js	LIB	Official asynchronous video-generation API calls (@higgsfield/client)	Durable job status, webhook/poll reconciliation, output asset copy, storyboard/editing, quotas, spending protection. Use current SDK V2, not deprecated V1
P0	Crawl4AI — https://github.com/unclecode/crawl4ai	LIB / WORKER	Crawl websites; discover and extract usable page content	Crawl budgets, dedupe, SSRF defenses, progress/coverage, product and brand extraction with evidence
P0	Docling — https://github.com/docling-project/docling	LIB / WORKER	PDF/PPTX/DOCX/XLSX ingestion and document structure	Private file handling, page/slide references, brand-conflict resolution and human Yes/No/Edit review
P0	PostgreSQL — https://github.com/postgres/postgres	SERVICE	Persistent, transactional relational database	Tenant-aware schema and access policies, audit, versioned Brand Brain, job/creative/performance records
P0	pgvector — https://github.com/pgvector/pgvector	EXTENSION	Brand/creative semantic search	Permissioned retrieval, chunk/embedding pipeline, semantic evaluation, fact/source precedence
P0	Fabric.js — https://github.com/fabricjs/fabric.js	LIB	Editable layered graphic canvas and scene serialization	Complete creative editor (templates, typography, undo, assets, brand rules, variant generation, autosave)
P0	Temporal — https://github.com/temporalio/temporal	SERVICE + SDK	Durable workflows for long-running calls/jobs, retries, timeouts	Per-tenant workflows, idempotency and billing reservations; Postiz coordination where compatible
P0	FFmpeg — https://github.com/FFmpeg/FFmpeg	CLI / WORKER	Video stitching, subtitles, audio, transcode/export	Timeline model, video presets, progress UI, isolated worker sandbox; check LGPL/GPL build configuration
P1	Langfuse — https://github.com/langfuse/langfuse	SERVICE / SDK	Internal agent traces, prompt experiments and evaluation	Brand-specific scoring, private data safeguards, version regression gates; not marketing performance analytics
P1	Portkey Gateway — https://github.com/Portkey-AI/gateway	SERVICE / OPTIONAL at launch	Multi-model routing, retries, observability for compatible inference APIs	Tenant budgeting and accountancy; do not force Higgsfield asynchronous jobs through an OpenAI-compatible LLM gateway
P1	OpenTelemetry — https://github.com/open-telemetry	LIB	Traces/metrics across frontend, API, workers and Postiz adapter	Correlation IDs, alerts, SLOs and sensitive-data redaction
P1	Better Auth — https://github.com/better-auth/better-auth	LIB (candidate)	Authentication/session primitives	Multi-tenant RBAC, org invitations, roles, billing connection, MFA; choose after stack audit
P1	MinIO (dev only) — https://github.com/minio/minio	SERVICE in development	S3-compatible object storage for local testing	Signed media URLs, object isolation, encryption, retention and backup. Use managed S3/R2 where appropriate in production
P2	GrowthBook — https://github.com/growthbook/growthbook	OPTIONAL / SERVICE	General experimentation and feature flags	Marketing experiment assignment and analysis using actual ad/post metrics; verify open-core licensing


Note: Do not add ComfyUI as a core dependency unless you later choose to self-host image inference. GPT Images is the selected image-generation provider. Do not make Mem0 mandatory: verified Brand Brain facts stay in PostgreSQL + pgvector.
Paid APIs are NOT open-source model repositories
Provider	Documentation / SDK	Our use
OpenAI GPT Images	https://platform.openai.com/docs/guides/image-generation · https://github.com/openai/openai-node	Server-side image generation/editing; fund the provider account; never expose keys in browser
Higgsfield	https://docs.higgsfield.ai/ · https://github.com/higgsfield-ai/higgsfield-js	Server-side, async video jobs; handle model/version availability, webhook/polling and storage TTL
Social platform developer APIs	Platform-specific Meta/LinkedIn/TikTok/etc. developer sites; use actual Postiz implementations and docs as baseline	Platform app/OAuth setup and reviews are external prerequisites; no API key alone guarantees publishing


Repository onboarding protocol for Codex — non-negotiable
1. Audit, don't assume. For each P0/P1 dependency, record: locked version/commit or container digest, license at that revision, relevant public API or extension points, limits, vulnerabilities and a minimal test in docs/THIRD_PARTY_LOCK.md. Verify the Postiz tenant isolation path before production.
2. Reuse, don't copy-paste. Prefer official published packages/containers; upstream forks must have a written justification, patch list and update strategy.
3. Build adapters. All SDK/service access goes through typed backend interfaces (OpenAIImageAdapter, HiggsfieldVideoAdapter, PostizPublisherAdapter, etc.). Keep API keys only in secrets storage and server processes.
4. No UI-first pretend integration. Every enabled user action needs its real backend implementation, database changes, durable job processing, status reconciliation and tests.
5. Prove real service operation. Offline contract tests can reach ADAPTER_READY. LIVE_VERIFIED needs positive+negative real-provider staging evidence (with authorized keys). Launch requires passing NO_FAKE_FEATURES_RELEASE_GATE.md.
6. Track ownership and expenses. The platform owns Brand Brain, creative edit files, approvals, metrics, credit ledger, and tenant authorization. Postiz owns only its internal publication implementation; OpenAI/Higgsfield own inference services.
7. Avoid irrelevant clones. Reuse each repo only for features described in PRODUCT.md. Document and cut optional dependencies if they introduce more complexity than value.
Minimal first vertical slice (prove these sources really integrate)
Sign up → website crawl (Crawl4AI) + brand guideline upload (Docling) → user verification → store approved Brand Brain (PostgreSQL/pgvector) → run 2–3 owner skills via Deep Agents → GPT image generation (OpenAI SDK) → editable graphic (Fabric.js) → approval → real scheduling/publishing (Postiz) → ingest observed post metrics → suggest next creative.

Then add Higgsfield async generation, FFmpeg editing, video approvals and publish flow. This sequence explicitly prioritizes functioning application logic over UI polish.