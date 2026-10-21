# DESVIO V5 — BUSINESS-FIRST, INTEGRATION-FIRST PRODUCT & UI SPEC

**Status:** build specification; supplied Desvio HTML is a visual/interaction reference, not functional application source.  
**Owner's October 2026 correction takes precedence** over prior workspace, navigation, and screen assumptions in `PRODUCT.md`, `WORKSPACE_DOMAIN_MODEL.md`, and prior Desvio audits.  
**Mission:** Turn Desvio's warm/editorial brand identity into a production-grade AI marketing product with up to **three owned businesses per standard consumer account**, persistent independent brand intelligence, content plan, approval inbox, conversational Canvas, publishing/analytics, memory, connections, team, billing, and account profile. The first customer should be able to onboard a real business, generate and edit creative, approve it, connect an eligible social account, schedule/publish, and learn from actual performance. No dummy success paths.

## 0. Build contract and precedence

1. Read `CODEX_SYSTEM_PROMPT_V5.md`, `AGENTS.md`, this spec, `UI_CONTROL_MATRIX.csv`, `DESVIO_V5_API_AND_DATA.md`, `REPOSITORIES.md`, and `NO_FAKE_FEATURES_RELEASE_GATE.md` before editing application code.
2. Inspect the **actual application repository** and the owner's reference `ui_reference/Desvio (2).html`. The reference is a bundled HTML prototype, **not** a reusable production React source tree. Make a component/route/handler inventory of the real repository; do not assume the current draft has backend capabilities.
3. **Implement a working backend vertical slice before polishing a page.** All visible nontrivial controls have a permission, API, database update, job if necessary, honest progress/error state, and automated test. `UI_CONTROL_MATRIX.csv` is mandatory traceability.
4. The existing Desvio aesthetic remains: warm cream (#f5ead8), pale surfaces, near-black ink (#201e1d), terracotta (#c67139), sage (#7a8a5e), airy spacing, editorial headlines, rounded cards, calm friendly tone. **Do not copy Postiz, Blaze.ai, a generic CRM, or a bootstrap admin UI.** Structure evolves as described below.
5. No fabricated brands, posts, analytics, comments, victories, follower data, invoices, member lists, social OAuth success, or AI results in real accounts. Demo-only fixtures must be gated and conspicuously identified. Do not mistake UI-only samples for provider-verified functionality.
6. A live integration cannot be called `LIVE_VERIFIED` without real, opt-in provider tests and redacted evidence; implement adapters + offline tests without keys and report the live-test blocker truthfully.

## 1. Product language, tenancy and business limits

- **User:** authenticated person.
- **Account/organization:** authentication, subscription, payment, seats, security, and aggregate usage boundary; standard consumer account is created once at first signup.
- **Business / brand:** business-specific unit selected in app. Has unique Brand Brain, campaigns, calendar, social accounts, creatives, learning, uploads, approvals and access control. **Do not create a separate “client workspace” for every concept or draft.** UI uses “Business”, not “Client workspace” by default.
- **Starter assumption for planning:** standard consumer plan has `max_active_businesses = 3`. This is a server-enforced plan entitlement, not a hardcoded invariant. A user may create or own up to three active businesses in their standard account; invited team seats **do not each grant three more**. An optional agency/enterprise plan may permit more. Never silently create three sample businesses.
- **Limits:** count active businesses atomically when creating; concurrent create requests cannot exceed 3. Archived businesses do not count if product policy permits archival, but restoration must recheck limits. Deleted business requires explicit authorized confirmation, retention policy, and delayed destructive worker. “Add business” becomes “Upgrade to add another business” at cap; users can still see archived businesses.
- **Context:** selected business is explicit and validated server-side. Overview can show a *summary across authorized businesses*, labeled “All businesses”; every write and drill-down routes to a specific selected business. Canvas, Plan, Review, Analytics and Memory never have ambiguous brand context. Business switching clears/rekeys caches, WebSocket subscriptions and pending draft contexts. Async jobs bind immutable `org_id, business_id` and cannot be reassigned by switching a UI dropdown.
- **Team:** business-scoped memberships and optional account administrator. Roles: Owner, Admin, Editor, Reviewer, Analyst, Viewer. Billing belongs to account owner or billing admin. Team member visibility can be limited to one or several businesses.

### Nonnegotiable navigation order

1. **Overview** — account/business performance and next action.
2. **Brands** — list businesses; add business via **three-step onboarding**; manage business profile/guidelines/automation rules.
3. **Content Plan** — monthly calendar, 30-day strategy and scheduled/draft content per business.
4. **Review Inbox** — **social channels as horizontal headers/tabs**, 30-day queue by date; approve/reject/feedback/edit; pending/approved/rejected filters.
5. **Canvas** — primary conversational chat-driven creative production UI: text/image/static/carousel/video/ad variants; media preview/editor panel and asset/history drawer. User can ask natural-language revisions.
6. **Publishing & Analytics** — tabs for Scheduled, Published, Failed/Needs action, Analytics, AI analysis; Postiz organically, separately scoped paid ad integrations only when built.
7. **Memory** — separate, transparent learning and guidelines center *per business*; confirmed brand facts versus evidence-backed performance learnings, with controls to approve/rollback.
8. **Connections** — OAuth/social account states, scopes and health; set which business/account posts where; connect/disconnect/reconnect.
9. **Team** — invite/manage members and roles scoped by business, activity and permissions.
10. **Billing** — plan and 3-business entitlement, seats, monthly usage/credits per account and business, invoices and cost.
11. **Profile** — password/MFA where identity provider supports, sessions, personal name/email, notifications, locale/timezone, export/deletion and account settings.

**Remove “Agents” as a first-class sidebar destination.** Put Creator/Publisher/Analyst settings under `Brands → [Business] → Automation` and a compact “Autopilot” state on Overview/Publishing. Do not remove autonomous features; relocate them thoughtfully. Former “Library” moves into `Canvas → Assets`, with optional accessible drawer/link on all creative pages. Former “Settings” splits into `Brands → Business settings` and `Profile → Account settings` (system/provider setup is separate restricted operator console). The previous hidden Create view becomes real `Canvas`, not a Review redirect.

## 2. Shell and visual interaction blueprint

### Global app shell

- Left side: Desvio wordmark, navigation above in exactly that sequence; active tab, clear icons, responsive collapsed layout. Do not replace editorial cream/ink/terracotta/sage design.
- Top/header: labeled **Business selector** showing current authorized business or “All businesses” only on aggregate Overview; avatar, command/search, notifications. Business selector dropdown shows up to 3 own business cards (logo, name, connection health, onboarding state), `+ Add business` and plan count `2 of 3 businesses`. Never show fictitious cafe brands in production.
- Context warning: when no business exists, route to Brands setup; Canvas/Plan/Review pages show designed empty state with “Add your first business”, not fake content.
- Global `Create` quick action opens Canvas with selected business set; command palette navigates all routes and can search current business assets.
- Notifications are persisted events (generation finished, review requested, scheduled failure, expired OAuth, performance digest). Real unread count and action navigation.
- Mobile/tablet: navigation drawer; business selector always visible; review channel tabs horizontal scroll; calendar list alternative. Keyboard focus and WCAG AA goals.

### Overview screen

**Business summary view**: filter `All businesses` / individual business; compare active businesses without leaking private business data to members lacking access. Cards: business count, content awaiting approval, upcoming scheduled posts, connected channel count, AI job failures, usage budget, last successful publish. Charts show real metrics with source and period. Suggested actions: “Review 8 queued posts”, “Connect LinkedIn”, “Confirm 3 brand facts”, “See performance insight”; each navigates to actual record.

**Autopilot summary:** Creator (draft), Publisher (schedule subject to approval), Analyst (insights); policy controlled per business, defaults Suggest/Draft, **never autonomous spend**. Activity feed consists of actual audit/job events; no generated winner claims without evidence.

**Acceptance:** Account with 2 brands shows exactly 2 and correctly aggregated allowed values; viewer restricted to one sees no other brand. A missing data period displays “No data yet” not zero-as-proof or fabricated line chart.

## 3. Brands: exact three-step onboarding, then permanent management

Brands index: responsive business cards with logo, domain, brand completeness, last refresh, channels, next review tasks; account limit card; `Add business`; business details tabs `Profile`, `Products & audience`, `Guidelines & files`, `Automation`, `Team access`, `Activity`. Each card is a genuine owned record.

### Step 1 — Identity (minimum effort)

Fields: business name (if needed), primary website URL, region, brand locale; optional “No website”, manual description, social links. Auto-detect name/domain/logo when permissible. Tell user what will be analyzed, request necessary permissions; validate and prevent duplicate domain errors gracefully; bounded crawl policy and SSRF protections.

Primary CTA `Analyze my business`; start durable Crawl4AI job with server-sent event/poll status; extraction must be genuine, report pages scanned, skipped and timed-out. Step remains resumable after reload and does not require browser stay open.

### Step 2 — Understand and confirm

AI presents **“Here is what we understand about your brand — is this correct?”** grouped into cards: what you do, audience, positioning, product/service catalog, brand tone, logo/colors, USPs, offers and restricted claims. Each finding shows website/file source, timestamp, confidence/unverified status, and `Correct`, `Edit`, `Not correct`. Clicking “Not correct” asks a targeted question or offers editing; never auto-approve speculative product/medical claims. The user can paste facts and adjust suggested text.

Inline files section **“Have brand guidelines already?”** accepts PDF, PPTX, DOCX, PNG/JPG/SVG, CSV/XLSX, ZIP where allowed, validates files and provides individual extraction progress. Docling+specialized parsers; multi-modal inspection for brand color, typography, logo placement and examples. If website conflicts with approved PDF, show side-by-side values with source/page and let authorized user resolve; approved user statement wins over inferred website value until explicitly changed. Missing information can be skipped and improved later.

Do not force a giant form or fake “90% understood”. Show derived coverage/completeness distinct from accuracy, unresolved facts and provenance. Version approved profile atomically.

### Step 3 — Goals and activation

Ask only: primary objective (awareness, traffic, leads, sales), content channels/preferences, cadence, must-avoid topics, relevant products/campaign dates, preferred approvals; optional connect social channels now or later. Preview Brand Brain summary and proposed first 30-day plan. CTA `Activate brand & generate first plan` starts a **real** strategy/skill job, not a local timer. Show plan drafts and editable schedule; user explicitly approves the plan before any publication. If external key is missing, display actionable “Provider not configured”, not successful generation.

**After onboarding:** memory v1 is accessible; brand settings always editable; uploads trigger re-extraction/conflict review and brand profile version update. First plan stays separate from approved publishing. Website changes require review before authoritative brand facts change.

## 4. Content Plan — real calendar and planning

- Selected business and timezone are prominent. Month/week/list views with real arbitrary date navigation, 30-day initial horizon and rolling regeneration. Filters: social channel, content pillar, campaign, format, status, author. Cards link to actual content records and versioned creative assets.
- `Generate 30-day plan`: loads approved brand facts, campaign objective, learned evidence and user skills (`marketing-plan`, `social`, `ad-creative` etc.); creates planning job and server-persisted content slots. Output includes date/time (local with TZ), channel, format, brief, hook, CTA, approval status, source strategy; never overwrites existing approved schedules without explicit diff confirmation.
- Drag/drop rescheduling updates backend with optimistic concurrency and conflict feedback. Bulk edit/submit-for-review/export ICS/CSV (where built) are real jobs with result notification. Month navigation never stays fixed on October 2026.
- Planned posts may have `content_needed`, `drafting`, `draft_ready`, `awaiting_review`, `approved`, `scheduled`, `publishing`, `published`, `failed`, `rejected`, `cancelled`. UI must not imply scheduled when merely approved.
- Plan quality: separate channel-specific content adaptations; one brand can be approved for Instagram but not LinkedIn. Calendar respects channel account presence and publishing constraints.

## 5. Review Inbox — 30-day, channel-header experience

**Layout:** Brand selector at top. Horizontal channel tabs/headers with channel icon and connected account identity: `All`, `Instagram`, `Facebook`, `LinkedIn`, `TikTok`, `YouTube`, `X`, etc. Show only supported/connected channels or show disabled connection CTA; each tab displays pending count. Date strip (`Today`, next 7 days, next 30 days) and 30-day scroll/list/grouped by date. Secondary filters: `Pending`, `Approved`, `Changes requested`, `Rejected`, `Scheduled`, plus assignee, campaign and format.

**Each post card:** scheduled date/time, platform/account, real preview of static/carousel/video, caption/title, content pillar, variant and business, skills/models used, revision/version number, QA warnings, reviewer, status and audit history. Actions: `Preview`, `Edit in Canvas`, `Approve`, `Reject`, `Request changes`, `Regenerate with feedback`, `Move date`. For video offer thumbnail/playback and subtitle preview. `Approve all` applies only to eligible scoped versions with explicit confirmation; prohibited claim and missing channel blocks.

**Feedback:** free-text box + suggested feedback chips; creates persisted `review_feedback` and a new job or human edit. The old approved version is not silently altered. Comments, attachments and threaded collaboration should be supported in later iteration; at minimum preserve exact reviewer, timestamps, reasons and version.

**State machine:** `draft → pending_review → approved → scheduled → publishing → published`, with `changes_requested`, `rejected`, `failed` and cancellation branches. Approval means permission to schedule only under selected brand policy; `Publish now` is a separate permission and confirmation. Version-based compare-and-swap prevents stale/duplicate approvals; undo where possible is a new audited action, not erasure.

**30-day acceptance:** Generate 30 slots for 2 channels; filter by LinkedIn header returns only LinkedIn posts; approving one does not approve its other channel variant; regenerate with feedback produces a different persisted creative version; refresh retains state; unauthorized viewer cannot approve; no publish occurs if OAuth invalid.

## 6. Canvas — actual conversational creative studio

This is **not** a generic chat page or one-off prompt box. It is the main creation experience, visually inspired by the supplied Desvio design but organized into three functional areas:

- **Left context rail (collapsible):** selected business (required), campaign/goal, connected channels, format chips `Text / Static / Carousel / Story / Video / Ad`, aspect ratio, target audience, content pillar, products and references, asset uploads, skill/preset choice (auto recommended; inspect selected skills), past creation threads/versions.
- **Center conversation:** editable brief chat, assistant clarifications only when needed, skill and model action cards with stages (`Planning`, `Generating image`, `Rendering layers`, `Generating video`, `Quality check`), real progress, provider cost estimate, cancel/retry, direct natural-language modifications (“make the background sage, stronger headline, turn this into a 15-second Reel”). Messages and tool results persisted as a business-scoped thread; models never invent completed assets.
- **Right creation surface:** generated variants, media preview and editable design canvas for image/carousels (Fabric.js); scene/storyboard + trim/caption/overlay controls and FFmpeg export for videos; versions history, compare variants, full-size preview, brand consistency score with evidence, safe area/dimensions, download, add to plan, send to Review, explicit publish actions requiring approval/connection. On mobile switch center and preview via tabs.

### Skill Harness runtime

Deep Agents loads approved tenant virtual brand context + relevant **user-supplied `SKILL.md` files** by content digest/version. Skill discovery is task-based; `social`, `ad-creative`, `image`, `video`, `product-marketing`, `marketing-plan` and relevant skills selected only as needed. Enforce allowlisted model/tool calls, sandboxed script execution, prompt-injection boundaries, skill provenance and cost caps. Skills are instructions and templates; do not assume they execute untrusted programs automatically.

### Model provider workflow

- GPT Images via official OpenAI SDK for image generation/editing; store reference images and output in owned object storage. Compose brand typography/logos/templates in Fabric.js to remain editable, then export actual PNG/JPEG/WebP.
- Higgsfield via official API/SDK for **asynchronous** video jobs: submit once with idempotency/reconciliation, poll/webhook as officially supported, progress/failure state; store video output in owned object storage promptly. FFmpeg handles overlays, captioning, concatenation, audio and export. If request unsupported by provider, show explicit limitation.
- The first output may be image-only; video remains behind health/capability gate until live tests pass. Vendor calls occur **server-side** using account-owned API keys in secrets manager; no API keys leak into browser, imported skills or tracing.
- Every result stores `thread_id`, `business_id`, `creative_version_id`, `selected_skill_digests`, `model/version`, `reference_assets`, `cost`, `qa_results`, `export_assets`, `parent_version`, `created_by`; prompts and feedback can be retrieved safely by authorized users.
- `Save`, `Download`, `Add to plan`, `Submit for review`, `Regenerate`, `Edit`, `Undo changes`, `Upload reference` are not toast-only: they call persistent backend or verified export actions.

### Canvas acceptance

Fresh approved brand can create a genuine brand-specific 1:1 image using live OpenAI test key and a fake provider under offline mode; change its text with editable layer; save; refresh; reopen exactly same project; export; send to Review; approve; schedule. Real Higgsfield workflow must reach asset playback/download with negative test for timeout/failed job and no double charge. Costs attributed to business and account.

## 7. Publishing & Analytics — one comprehensive destination

**Tabs:** `Schedule`, `Published`, `Needs attention`, `Analytics`, `AI analysis`. All scoped to selected business, optionally grouped by channel. Postiz is **headless organic publishing**, not the frontend and not the Meta paid Ads API. Mapping `creative_version → approval → publication_intent → Postiz media/post ID → platform post ID` persists and reconciles with webhooks/polling.

- `Schedule`: schedule review, edit time/channel, publish now where supported, cancel/reschedule, platform-specific validation, approval prerequisites.
- `Published`: actual published URL, account, timestamp, state and supported metrics, with sync freshness, provider IDs and traceable sources; do not claim social publication from queued Postiz request alone.
- `Needs attention`: rejected platform media, OAuth expired, rate limits, upload failure, invalid aspect ratio, provider errors, retry safely and open connection/creative correction CTA.
- `Analytics`: period/channel/format/campaign filters; reach, impressions, interactions, saves, shares, views, retention and CTR only if source supports, with plain-English metric definitions, sync time and no fabricated ROAS. Paid spend/ROAS only after legitimate paid ad platform integrations and conversion attribution.
- `AI analysis`: Analyst proposes insights such as “How-to carousels appear to receive more saves in this period”, ties to actual published IDs and comparable sample sizes, confidence, constraints; actions `Create variation in Canvas`, `Add experiment to Plan`, `Dismiss insight`. Never alter the approved brand’s products/claims based on analytics alone. Separate causal experiment from correlation.

## 8. Memory — transparent, business-isolated Brand Brain + learning

**Memory is its own navigation**, not buried in business settings. Inside, tabs:

1. **Brand knowledge:** approved mission, offers, voice, allowed/forbidden claims, products, target personas, guidelines with evidence and profile versions; editing creates proposed changes then approval.
2. **Creative preferences:** accepted/rejected examples, preferred visuals, design templates, CTA patterns, feedback, skill version; allow opt-out of certain patterns.
3. **Performance lessons:** insight cards with evidence, source posts/campaigns, measured period, sample size, confidence/state (`proposed`, `testing`, `validated`, `rejected`, `retired`), who approved and when; editable applicability.
4. **Sources:** website scan coverage, PDF/PPTX uploaded docs with page refs, social evidence, owner correction history, refresh source/remove source controls.
5. **Experiments:** question/hypothesis, controlled variants, results, reliability; ability to create a recommended next test.

Memory selection is always bound to business. AI retrieval uses *approved* brand facts plus only appropriately labeled performance hypotheses. Share learnings across businesses is **off by default** and subject to owner consent, privacy review and safe aggregation; never transfer private customer sources across brands.

## 9. Connections — real account linking

Show platform cards with `Not connected`, `Needs app setup`, `Connecting`, `Connected`, `Token expiring`, `Reconnect required`, `Insufficient permissions`, `Unsupported` states. `Connect` redirects to real OAuth, checks state/PKCE as appropriate, validates selected account/page and provider scopes, stores encrypted tokens server-side, then confirms platform account identity. Reconnect, disconnect and scoped channel permissions must make genuine API calls and update persistent state.

Postiz adapter must be **proven** to support the desired headless per-business social connection lifecycle; if public Postiz self-hosted endpoints do not expose required OAuth flow or tenant isolation, implement a narrowly scoped, tested backend extension or choose explicit alternative; document commercial license review. Never fake a `connected=true` boolean or silently share an organization's global token among unrelated businesses. Platform-specific approvals may require operator action.

## 10. Team, Billing, Profile

### Team

List actual invited/active users with business scopes; invite by email, role, and selected business(es); signing and expiry, re-send/revoke, activity/audit trail, cannot remove last owner. Viewers cannot publish/approve/edit, Editors cannot bill, Reviewers can approve assigned scopes, owners control billing and deletion. API enforces role, frontend merely mirrors. Team user may work on 2 businesses without 2 customer accounts.

### Billing

Account-level plan with **3 active businesses** quota as configured; transparent plan entitlements, active brand count, credit wallets, video/image costs, billing cycle, invoices, overage/pause, cancellation and payment recovery. Per-business usage allocation without duplication. Integrate Stripe (or selected provider) server-side, verify webhooks/idempotency; no fake invoice/card numbers. Usage and credit reservation before expensive generation, commit actual usage afterward, release on failure according to policy. Plan change cannot be toast-only.

### Profile

Authenticated user name/photo, email verification, password change/reset/MFA/sessions through identity provider capabilities, logout devices, notifications, time zone/locale, export personal data, account deletion with security confirmations. App/provider keys available only in restricted **operator** settings or securely managed BYOK flows when enabled, never hardcoded demo keys. Avoid putting “Settings” first in navigation; profile menu accessible in top right.

## 11. UI → architecture reuse map

| Desvio UI area | Existing components to reuse | What we must develop in Desvio |
|---|---|---|
| Global shell, account/business auth | Existing UI, auth SDK/provider, PostgreSQL | New business selector, 3-business entitlement, server RBAC, route guards |
| Brands onboarding | Crawl4AI, Docling, PostgreSQL/pgvector, Temporal | Three-step wizard, evidence extraction/fact review, upload conflict UI and brand versioning |
| Content Plan | Deep Agents/skills, Temporal | 30-day planner, calendar views, content slots, conflict-safe scheduling |
| Review Inbox | Postgres, Temporal | Social header tabs, versioned approvals, edit/reject feedback queue and audit state machine |
| Canvas | Deep Agents, OpenAI SDK, Higgsfield SDK, Fabric.js, FFmpeg | Chat-centered studio, skill routing, editable project schema, asset import/export, cost controls |
| Publishing & Analytics | Postiz headless, PostgreSQL, analytics adapters | Tenant-safe OAuth bridge, statuses, real performance sync, evidence-backed AI analysis |
| Memory | PostgreSQL + pgvector, Langfuse | Business-scoped authoritative facts/learning UI, evidence, confidence, review & rollback |
| Connections | Postiz where supported, official platform APIs | Secure OAuth lifecycle and per-business authorization UI |
| Team | Identity provider, email provider | Role/membership management and business-level grants |
| Billing | Stripe SDK, provider webhooks | Entitlements, credits, metering, billing UI, reconciliation |
| Profile | Auth provider | Personal preferences, sessions, security flows, export/deletion |

**Optional:** Portkey for model routing if useful; GrowthBook for selected controlled experiments when data volume justifies. Don't deploy every optional repository merely because it's listed.

## 12. Out-of-scope and correct feature labeling

Do not promise paid Meta/Google/TikTok Ads Manager campaign buying via Postiz. Paid ad capability requires separate API auth, policy approvals, creative specs, explicit account budget authorization and tests; until built, Canvas can export ad creatives but **Publishing & Analytics must label paid execution unavailable**. Do not promise API-generated “UGC actors” without provider and rights verification. Do not promise pixel-perfect full Canva or Premiere editing from Fabric.js/FFmpeg alone; implement documented editing affordances that actually work.

## 13. Non-negotiable tests / no-fake completion gates

| ID | End-to-end test and evidence |
|---|---|
| V5-001 | New user signs up: **zero** brands and honest onboarding CTA, no Corner Café seeded data. |
| V5-002 | Create brands A, B, C; fourth create rejected by server `BUSINESS_LIMIT_REACHED`; concurrent creates cannot exceed cap. |
| V5-003 | Switch A to B with pending Canvas job for A: job/result remains assigned to A; B sees no A assets/analytics/messages. |
| V5-004 | Website crawl returns real source-backed findings; service error/timeout visibly recoverable; no fake timers. |
| V5-005 | Upload PDF/PPTX; findings show source page/slide; resolve conflicting color/logo and activate versioned brand. |
| V5-006 | Three-step onboarding resumes after refresh and missing required claim prevents unsafe approval. |
| V5-007 | Create real 30-day plan; month navigation, editing, rescheduling persist and work across reload and timezones. |
| V5-008 | Review channel header chooses only appropriate variants; feedback/regenerate persists new version; stale approval conflicts. |
| V5-009 | Canvas real OpenAI generate/edit/render/save/reopen/export with reference brand and cost; keyless mode reports blocked honestly. |
| V5-010 | Higgsfield real async create/status/download/copy, cancellation/failure/timeout and cost handling, no duplicate submissions. |
| V5-011 | OAuth with authorized test social account, tenant-specific identity + token lifecycle; negative unauthorized access. |
| V5-012 | Postiz upload/schedule/actual publish/status link and idempotent retry, provider-side bad-media failure reported. |
| V5-013 | Analytics only shows metrics returned by real providers, source/freshness visible; insight cites actual posts. |
| V5-014 | Memory recommendation approved then changes future brief; approved product facts unaffected; rollback works. |
| V5-015 | Member invited only to business C cannot view business A/B, approve another business or view billing. |
| V5-016 | Actual plan webhook updates 3-business limit and account credits; repeated webhook does not double provision. |
| V5-017 | Account profile password/session/MFA actions invoke real identity provider; sensitive action protects existing sessions. |
| V5-018 | Every visible UI control has `UI_CONTROL_MATRIX.csv` mapping and test or explicit truthful disabled/owner-approved exclusion. |
| V5-019 | Production mode contains no static sample posts, 6-second success timers, local-only integration toggles, fabricated insights or invoice fixtures. |
| V5-020 | Load/concurrency test demonstrates fair job limits, per-account budgets, Postiz adapter isolation, graceful 429 and job queues under target capacity. |

For externally charged APIs, offline contract tests and live opt-in smoke tests are separate gates. If no key available, status cannot exceed `ADAPTER_READY`; do not claim completed fully working SaaS until relevant live tests pass.

## 14. Engineering milestones — exact order to avoid frontend-only outcome

- **0. Repository audit / traceability:** inspect actual code, produce `IMPLEMENTATION_STATUS.md`, update matrix (component/file/API/DB/job/test), snapshot supplied UI, resolve licensing and provider capabilities. No redesign.
- **1. Business foundation:** auth, account, 3-business server quota, selector, RBAC, profile and first real Brands index. Tests V5-001/002/003/015.
- **2. Onboarding and memory:** Crawl4AI, Docling, three-step wizard, review UI, versioned approved facts. V5-004/005/006.
- **3. Canvas first complete creative loop:** Deep Agents + actual skill files + GPT Images + Fabric.js, persistent threads/assets/versions, usage, review. V5-009/018.
- **4. Plan and Review:** 30-day generation, per-channel tabs, approvals/revisions and calendar. V5-007/008.
- **5. Connections and publishing:** real OAuth/proven Postiz adapter, upload/schedule/reconcile and status. V5-011/012.
- **6. Video + analytics learning:** Higgsfield/FFmpeg async, owned storage, Postiz metrics, evidence-based insights/Memory. V5-010/013/014.
- **7. Billing + team + scale:** Stripe entitlements, security/session flows, cost controls and load/recovery tests. V5-015/016/017/019/020.

Do not implement 1–2 frontend pages per milestone and call them done. Ship each milestone only with a functional back-to-front test, traceable persistence and truthful provider state. Keep missing keys isolated to `LIVE_VERIFIED` gates, not unimplemented connectors.

## 15. First-user acceptance journey (must be filmed/tested using real data)

User registers → Overview shows “No businesses yet” → Brands `Add business` shows `0/3` → website entered → bounded crawl and optional PDF/PPTX import → user confirms/corrects AI findings → selects objective/social preferences → activates Brand Brain v1 → content plan generates 30 actual slots → opens Canvas, asks “Create a premium Instagram carousel and a 15-second product video” → real skills/models run (where configured), project and video persist → Review Inbox Instagram header shows exact pending posts for next 30 days → user edits caption, requests image revision, approves chosen version → Connections authorizes Instagram and proves account identity → Publish/Schedule via Postiz → actual status, platform URL and supported metrics arrive → Analyst creates grounded insight → Memory records proposed learning → user accepts/declines learning → next Canvas generation applies confirmed brand plus approved lesson. Switching business shows independent data from start to finish.

**Finish-line expectation:** Operator provisions infrastructure, adds API keys, sets up authorized OAuth/billing and uses the product. Codex must implement the connections and tests, not leave integration TODOs. External app reviews, credential funding, legal/security approvals and infrastructure provisioning are operational prerequisites, not missing code to hide.
