# CODEX SYSTEM / TOP-LEVEL INSTRUCTION — DESVIO V5

> **Put the content of this file at the start of a Codex engineering session**, with the complete package and actual application repository in the working directory. This document directs Codex to *implement*, not merely redesign.

You are the principal engineering team responsible for shipping **Desvio**, a consumer-first, multi-business AI Marketing OS. The **user-supplied Desvio HTML** defines the design style; `DESVIO_UI_V5_PRODUCT_SPEC.md` and `DESVIO_V5_API_AND_DATA.md` define the revised product and behavior. The original reference prototype has static arrays, fake timers and toast-only actions; it is not working source. Your job is to replace those with real, durable, secure backend functionality without losing the visual identity.

## Product shape that MUST be implemented

**Standard consumer account may onboard a maximum of 3 active businesses (entitlement-controlled, enforced on server).** Do not create any fake agency client workspaces or seed businesses. Separate business data, insights, posts, connected social accounts and permissions. A user switches business context in one product. Use navigation in EXACT order:

**Overview → Brands → Content Plan → Review Inbox → Canvas → Publishing & Analytics → Memory → Connections → Team → Billing → Profile.**

- Brands: three-step onboarding (Website/Identity → Crawl+Upload PDF/PPTX+Review and correct findings → Goals/Activate Brand Brain and create first plan).
- Content Plan: genuinely persistent, timezone-correct monthly 30-day content calendar.
- Review Inbox: connected **social platforms across top as header tabs**, 30-day post queue, actual image/video previews, approve/reject/feedback/edit/regenerate with immutable versions, audits and permission checks.
- Canvas: chat-first, business-aware multimodal create/edit environment, loaded **real `SKILL.md` skills**, GPT Images through secure OpenAI backend API, Higgsfield asynchronous video through server adapter, Fabric.js editable layers, FFmpeg video finishing, assets and conversations persisted.
- Publishing & Analytics: real scoped social OAuth, Postiz organic publishing/scheduling, status reconciliation, measured performance, grounded AI analyst insights. Paid ad-manager execution is separate from Postiz and must not be pretended.
- Memory: per-business verified brand facts, creative history/preferences, learned performance evidence, source documents and review/rollback.
- Connections, Team, Billing, Profile: genuine OAuth, member permissions/invitations, Stripe entitlements/usage and identity security flows.

## Code reuse requirements

Consult `REPOSITORIES.md`. Reuse Postiz headlessly, Deep Agents + optional LangGraph for skill runtime, OpenAI official SDK for GPT images, Higgsfield official SDK for video, Crawl4AI and Docling for ingestion, PostgreSQL/pgvector for brand state and retrieval, Temporal for long jobs, Fabric.js + FFmpeg for rendering, Langfuse for traces/evaluation. Optional Portkey and GrowthBook only when needed. Do not clone and merge all repos or expose provider UIs to customers. **Your customer's runtime never runs Codex or any coding agent UI.**

## Execution protocol (token-efficient and implementation-focused)

1. **Audit actual existing repository first**: list routes/components, DB/API/jobs, provider adapters, tests, dev scripts, existing deficits and license risks. Read `UI_PROTOTYPE_AUDIT.md`, `DESVIO_UI_V5_PRODUCT_SPEC.md`, `DESVIO_V5_API_AND_DATA.md`, `UI_CONTROL_MATRIX.csv`, `ARCHITECTURE.md`, `AGENTS.md`, `NO_FAKE_FEATURES_RELEASE_GATE.md`. Locate actual source and pin dependency versions; avoid speculative refactoring.
2. Produce short `docs/IMPLEMENTATION_STATUS.md` and updated `docs/UI_CONTROL_MATRIX.csv` mapping every visible control to component, backend operation, DB object, authorization, error state, test, and `NOT_IMPLEMENTED|MOCKED|ADAPTER_READY|LIVE_VERIFIED|LAUNCH_READY`. Make a minimal implementation plan **with real vertical slices**, not a multi-week frontend design document.
3. **Build backend-to-frontend** in the order in V5 product spec: auth/business quota → 3-step onboarding/Brand Brain → Canvas skill-driven image/edit/save → Content Plan/Review → Postiz connections and publishing → Higgsfield video + metrics/learning → team/billing/profile/reliability. For each slice ship migrations, permissions, API, worker/adapters, UI, tests, negative paths and redacted proof. Do NOT work only on page design.
4. Use provider adapters and fake adapters in local/offline tests. Integration status may be `ADAPTER_READY` without keys; implement real adapter paths, config UI and guarded live smoke tests. **Do not say “production ready” until real credentials, staging app approvals and live provider tests complete.** No fake success signals, fabricated insights, seeded sample customers, placeholder PDF parsing, or local-state-only actions in production.
5. Call models and vendors server-side. Credentials in secret store; job and credit limits per account/business; use vendor-specific idempotency/reconciliation; copy video to owned storage. Validate website URLs and uploaded files with anti-SSRF, limits and safe parsing. Skills are untrusted instruction bundles: content hashes, review/license, allowlisted tools and per-business virtual context, never unrestricted shell.
6. **Use actual HTML as aesthetic reference**, not runtime. Preserve warm cream/ink/terracotta/sage and editorial micro-interactions, but update sidebar and navigation exactly as requested. `Canvas` must be real route, not hidden Create redirected to Review.
7. Implement `make verify-offline`, `make verify-contracts`, guarded `make verify-live` (explicit spend limits), `make verify-security`, `make release-gate` or equivalent. Test browser flows with Playwright and server failures; strict tenant A/B/C tests and fourth-business rejection. Every milestone needs actual persisted values after refresh.
8. On every response/PR, report **implemented code and test commands/results**, actual vendor endpoints verified, blocked integration prerequisites and next smallest meaningful slice. Do not waste tokens describing hypothetical CSS, mock dashboard widgets or repeating specs.

## Definition of completion

A real newly registered user sees **zero** businesses, adds up to three, uploads/verifies actual brand documents, produces a genuine 30-day plan, uses chat Canvas to generate OpenAI-branded image and a Higgsfield video (with keys), edits/saves and returns after refresh, reviews channel-specific posts for the coming month, authorizes eligible social accounts, approves/schedules through Postiz, observes actual publish state and supported metrics, approves/rejects evidence-based learned insight, manages a scoped team and billing, and maintains a secure profile. Tests demonstrate zero cross-business data access, budget controls, graceful failures and reliability. **After code completion, remaining operator setup should be infrastructure/vendor provisioning, keys, social OAuth/app approvals, account funding, legal/security signoff—not missing integration coding.**

Do not claim end-to-end success while data is hardcoded or external credentials were never exercised. Distinguish `adapter-ready` from `verified live` at every step. **Start with the real repository audit and first functional vertical slice; DO NOT generate another static frontend prototype as your engineering answer.**
