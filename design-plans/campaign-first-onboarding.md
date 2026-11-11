# Updated monthly content flow

Latest user decision (10 November 2026): remove the customer-facing Campaigns concept. Keep custom creation through chat/canvas. Replace its navigation entry with Create; preserve other menus and saved media/history. Internal plan grouping remains for reliable generation and accounting.

Required final journey: implement the supplied DESVIO-Complete-Onboarding ZIP's five-step brief, references, uploads and summary using real services; research; initial mood board and one included feedback revision; approve direction; review monthly topics and dates; explicitly approve the plan; generate content; edit/regenerate and approve individual posts; schedule only authorized approved versions. No demo research, uploads or metrics.

Current increment: added persisted plan approval and exact post revision checks before automated generation, monthly-plan review controls, and Home/primary navigation changes. API and web builds pass. Database-backed regression tests passed (10); extended brief contract tests passed (4); mock-API responsive browser tests passed (3). Not deployed or end-to-end complete. The five-step brief now includes business/customer fields, 52 reference examples with ranked selection and accessible enlargement, real file upload access, and grouped summary. Selected reference metadata reaches research; edited brief website feeds the existing safe capture path. Remaining: social profile choices backed by plan policy, account email display, optional extras handling, reference-image visual interpretation, uploaded asset binding/consent, competitor research, post-specific asset requests, calendar approval placement, legacy campaign entry-point cleanup, and live verification/deployment. Source-only and mock checks do not prove production readiness.

## Earlier implementation notes (superseded where conflicting)

# Campaign-first onboarding and client dashboard

Status: approved for implementation. Initial saved-brief, research and dashboard slice implemented locally; full mood board and campaign orchestration remain unfinished and unpublished.
Written against: 3929298, feat/astryx-refinement, 10 November 2026.

## Outcome

Make Desvio feel like a creative service: answer five simple questions, approve a visual direction, choose a campaign period and content quantity, then review finished posts. Retain campaigns as the organizing unit. Retain every existing menu item, label, order and destination unchanged. Keep the existing Create header action and chat/canvas routes. The dashboard reference guides content layout only, not navigation.

Reference: /Users/viloljoshi/Downloads/dashboard.html. Its dashboard was rendered and inspected; screenshot: campaign-onboarding-reference/dashboard.png. Use its dashboard information hierarchy, warm neutral surfaces, dark attention card, restrained lime accents, bordered cards, thumbnail rows and clear review actions. It is a fictional local-storage demo, not a backend implementation. Do not import its sample analytics, sample brand, subscription promises, fake tasks, or human-team claims.

## Scope and decisions

- Change the main onboarding and campaign launch journey, dashboard, and related review entry points only.
- Keep current account access, brand ownership, integrations, artwork editor, chat history, generation providers, scheduling and publishing protections.
- No unrelated application-wide redesign or new advertising service.
- Proposed interpretation: two mood board versions total, initial plus one feedback regeneration. Technical failures do not consume the feedback revision.
- Mood board contains one actual static creative and one actual carousel, with navigable slides, not merely two topic suggestions. Default sample carousel: three slides to demonstrate cover, content and closing treatment. No video generation during this stage.
- First campaign defaults to static and carousel content. Existing video workflows remain accessible in Create; adding video to automatic campaign production is outside this initial change.
- Approving a direction is not approving claims, posts, or publication.

## Customer journey

### 1. A five-question brief

Show one short step at a time, save progress on the server, and let users go back or resume later. Prefill existing business data. Avoid asking users to repeat anything research or prior onboarding already supplies.

1. **What does your business do?** Business name, short description, optional website.
2. **Who do you want to reach?** Audience and location, with plain-language examples.
3. **What would you like your content to achieve?** One main goal, such as enquiries, awareness or product interest; optional desired customer action.
4. **What should your brand look and sound like?** Optional logo/photos/guidelines and visual direction choices; include “Recommend a direction for me.”
5. **Anything we should feature or avoid?** Upcoming launch, offer, important date, must-use wording or restrictions, all optional.

These are five conceptual questions, not five large forms hiding many mandatory fields. Platforms, posting dates and quantities come later. Keep upload permissions concise and preserve the existing explicit image reuse rules.

### 2. Research and prepare the direction

Reuse the research pipeline and approved brand context. Research supplied public business sources, attach source URLs internally, and summarize only useful findings. If no website is available, work from supplied answers and assets rather than blocking onboarding.

Show plain progress states: “Learning about your business”, “Choosing your visual direction”, “Creating your previews”. Preserve progress after reload and show a useful next action on failure. Do not show fabricated percentages or exact completion times.

Ask a follow-up only for a material conflict or missing fact required to proceed. Research suggestions must not silently become verified business claims. Existing confirmed facts retain their provenance. Draft previews must avoid unsupported assertions and label conceptual imagery where relevant.

### 3. Review a real mood board

Create a draft campaign container before producing previews, so all research, direction versions and sample assets belong to that campaign.

The board includes:
- One-sentence creative direction and a short rationale tied to the brief.
- Primary, secondary and accent colours with actual values.
- Heading/body font samples using fonts available in the editor and export pipeline.
- Photography/illustration treatment and a short voice example.
- A generated static post with its caption.
- A generated carousel with all slides and caption.

Primary action: **Use this direction**. Secondary action: **Request changes** opens one simple feedback box. Feedback regenerates a second version; retain both and let the user compare or approve either. Clearly show “One revision included” before revision, and “Revision used” after it.

After the included revision, users may approve a version, pause, or correct their brief and seek assistance. Do not force approval, endlessly regenerate, or reset the quota by refreshing, opening another tab or starting a new request. The revision allowance is tied to the onboarding delivery, with explicit rules for future campaigns.

Lock the selected version, including palette, fonts, creative rules, source/skill versions, and sample asset IDs. Offer it as the saved business direction for future campaigns; later campaigns may reuse it without repeating onboarding. Never rewrite existing campaign artwork when defaults change.

### 4. Choose the campaign

After direction approval, show a compact setup card:
- Enabled platforms, respecting organization configuration and supported formats.
- One week or one calendar month, start date and visible time zone.
- Number of posts within the remaining allowance, with a recommended mix.
- A short campaign summary and **Create my content** button.

Generation can proceed without connected social accounts. Connection is required for publishing, not for creating drafts. Disabled platforms are absent. Do not silently schedule past dates if production runs long.

Entitlements need explicit mapping: a carousel is one content item with multiple slides; platform adaptations and slide counts must be priced consistently with the commercial plan. Show the actual allowance and reserve it atomically. Do not infer a post allowance from the current business-slot limit. Establish whether mood board samples are included and how they count before enabling paid usage. Recommended approach: a bounded onboarding sample allowance, with approved samples reusable in the campaign rather than regenerated unnecessarily.

### 5. Plan and generate

Use the existing research/planning pipeline with the approved brief, locked direction, verified facts, business preferences, approved references and pinned skills. Use the requested GPT-6 only through an available, verified API configuration; block with an actionable configuration error rather than silently substituting a model.

Plan the complete chosen period, then generate each slot as an independent durable job. Avoid a new mandatory plan-review form: users already authorized this with Create my content. Make topics and dates inspectable and editable without blocking the default journey.

Show “4 of 12 posts ready” with progressive thumbnails. Keep successful posts accessible while others finish. Failed slots can be retried individually without regenerating successful work. Reconcile ambiguous provider outcomes before submitting again. Reuse approved preview assets when they fit a planned slot.

### 6. Review and revise

Review cards show artwork, carousel slide navigation, caption, platform and planned date. Actions:
- **Approve** the exact version reviewed.
- **Request changes** with a short feedback box and optional chat editing.
- **Reject** removes it from the ready queue while preserving history; offer replacement explicitly rather than generating indefinitely.

New revisions become drafts and require fresh approval. Preserve earlier versions and feedback. Keep publication and scheduling rules explicit: no mood board or batch-generation approval implies permission to publish. Reuse existing authorized scheduling behavior and exact-version checks. If a scheduled item changes, require appropriate reapproval rather than publishing an unreviewed revision.

## Dashboard and navigation

Adopt the supplied reference at desktop and responsive widths:
1. Greeting and current campaign/period, no large chat hero.
2. **Your attention** dark card: real decisions, failed items requiring action, or an onboarding continuation. Every row opens the correct saved item.
3. **Month ahead** card with real upcoming thumbnails, dates and statuses. For a weekly campaign, show “Week ahead”.
4. **Performance** using available real metrics. Show an honest empty state if there are no connected accounts or results.
5. **Research & ideas** showing saved, sourced findings and optional ideas, not fabricated category trends.

Primary navigation: Dashboard, Campaigns, Calendar, Approvals, Create. Retain brand/settings/integrations/team/billing access in a quieter secondary group. Reuse existing pages behind these destinations. Do not add the prototype's Onboarding demo or claim a staffed “Meet our agents” service.

Existing customers land on their normal dashboard and keep all campaigns. Offer this guided flow when they start a new campaign; do not require repeat onboarding or invalidate approvals. Keep direct Create URLs and chat history working.

## Implementation owners and reuse

| Area | Existing owners | Planned work |
| --- | --- | --- |
| Navigation and dashboard | apps/web/components/businesses.tsx, business-overview.tsx, home-create.tsx | Add Create navigation; replace the dashboard hero with attention/upcoming layout using real data. Preserve canvas route and saved conversations. |
| Brief and preferences | apps/api/src/businesses.ts, creative-brief.ts; apps/web/components/creative-brief.tsx, content-preferences.tsx | Map five questions onto existing stored fields where possible; add missing fields with versioned migrations. Preserve optimistic concurrency. |
| Research | apps/api/src/openai-website-research.ts, rendered-website-research.ts, brand-analysis.ts, brand-brain.ts | Reuse bounded research and provenance. Distinguish suggestions from approved facts. |
| Mood board | apps/api/src/brand-visual-review.ts, creative-jobs.ts, carousel-jobs.ts, creative-skill-pins.ts | Add a campaign-scoped direction aggregate, preview jobs, two-version revision policy and lock operation. Existing visual reviews alone are not the complete new workflow. |
| Planning and production | apps/api/src/planning.ts, planning-jobs.ts, generation-plan.ts, content-plan.ts, creative-budget.ts | Bind generation to locked direction and allowance reservation; orchestrate progressive production and partial recovery. |
| Review | apps/web/components/campaign-review.tsx, creative-editor.tsx; apps/api/src/slot-creatives.ts, creative-exports.ts | Reuse artwork/edit/export/version flows, simplify the entry surface and add feedback-driven revision routing. |
| Visual components | apps/web/app/website-brand.css; apps/web/components/design-system.tsx, primitives.tsx, desvio-select.tsx | Reuse current brand tokens and accessible controls. Add reference-specific dashboard composition, not a second disconnected UI system. |

Proposed durable records: campaign brief revision, research snapshot, mood board version and asset links, direction approval, onboarding revision counter, content allowance reservation, and slot generation links. Resolve final table names against existing migrations before implementation. Persist organization/business ownership, actors, versions and idempotency keys throughout.

State sequence: brief draft → research → direction generation → direction review → direction locked → campaign setup → planning → generation → post review → scheduled/published through existing publication gates. Model failure/retry/paused states explicitly, not as a single generic error. Changing a locked brief or direction creates a new revision; never silently modifies in-flight work.

## Delivery sequence

1. Agree this journey and commercial allowance semantics. Inventory existing endpoints, permissions and provider configuration. Finalize screen states and data contracts.
2. Implement saved five-question onboarding and research handoff behind a rollout flag.
3. Implement real static/carousel mood boards, feedback limits, comparison and locking.
4. Connect entitlement-aware campaign setup and existing planning/generation jobs.
5. Implement attention-first dashboard, Create sidebar entry and simplified versioned review.
6. Verify representative desktop/mobile journeys and real provider jobs, then enable for a small test cohort before general rollout. Rollback must restore the prior entry experience while retaining new campaign data and in-flight jobs.

## Acceptance and release checks

- New business: five-question brief → research → actual static and carousel previews → direction approval → weekly/monthly generation → approve/revise/reject.
- Existing business: reuse confirmed facts and direction; existing campaigns, direct links and Create history remain usable.
- Reload/browser close at every stage resumes the same work. Cross-device resume uses server state, not localStorage alone.
- Two simultaneous clicks/tabs cannot consume multiple revision rounds, duplicate campaigns or overspend allowances.
- Research failure, no website, missing assets, rate limits and expired asset URLs have recoverable states.
- Partial carousel/production failure preserves completed assets and retries only missing work. Ambiguous paid requests are reconciled.
- Wrong-business access, restricted roles, stale approvals and concurrent edits are rejected server-side.
- Disabled platforms, unavailable model and insufficient allowance cannot proceed silently.
- Mood board approval never publishes. Editing an approved post invalidates approval for the new version.
- Dashboard metrics are real or explicitly unavailable; no prototype sample values appear.
- At 390px, 768px and 1440px: no horizontal overflow, clipped controls or hidden primary action. Keyboard navigation, focus return, labels, loading announcements and contrast verified.
- Screenshot comparisons against the reference cover empty, loading, populated, error and narrow layouts. Preserve customer artwork proportions and font rendering.
- Live verification includes a static preview, a full carousel, feedback regeneration, saved lock, a campaign batch and post revision. Report separately what was simulated, tested locally and verified against live providers. No live social publishing without explicit test authorization.

## Current evidence and limits

The existing account entitlement endpoint inspected exposes business counts, not a demonstrated complete post subscription allowance. That is a dependency, not a finished capability. Existing planning requires confirmed brand context and completed onboarding preferences; the new order must satisfy those conditions intentionally. Existing campaign review and creative jobs offer reuse, but the complete proposed orchestration has not been built or live-tested.

Original planning pass produced only the plan and rendered reference. The implementation pass has now added the saved brief, dedicated research contract and dashboard changes locally. No deployment or live provider generation has been performed for this new flow.

## User refinement: dedicated business research agent and product focus

The customer-facing product is the dashboard, calendar, easy content management and automated posting. Research and orchestration operate behind those surfaces. Do not make customers operate agents or understand technical job states.

Build a dedicated business research agent orchestration layer, reusing existing research tools and skill infrastructure where appropriate. This is a product agent, not a separate conversational agent the customer must manage.

### Agent contract

Inputs: onboarding answers, supplied website and permitted assets, existing approved brand facts, campaign goal and period, and previous customer feedback. Reference script information can inform presentation and workflow, but fictional examples are not evidence about a customer's business.

Outputs must be structured and versioned:
- Business summary, offer, audience and geography.
- Evidence-backed differentiators, voice and relevant business details.
- Existing visual identity separated from proposed palette, fonts and image direction.
- Content pillars and campaign opportunities with rationale.
- Unknowns, conflicts, source URLs, retrieval dates and evidence supporting each factual claim.
- A concise customer-facing summary and a complete downstream creative brief.

Workflow: gather supplied context → research permitted public sources → extract supported facts → reconcile with confirmed facts and user answers → identify meaningful gaps → prepare creative recommendations → validate the result → hand off to mood board generation. Research pages and uploaded documents are untrusted input, never agent instructions. Use bounded time, pages and cost; record tool results and failures. Avoid repeated research through appropriately scoped caching, while refreshing facts that may have changed.

Ask only when a missing or conflicting detail materially affects the output. Optional gaps should yield a clearly proposed direction, not a blocking questionnaire. Never invent offers, prices, project specifications or claims. Show a short editable “What we learned about your business” summary inside onboarding; keep source detail expandable. User corrections must persist and inform future campaigns.

Quality evaluation before rollout: representative businesses across property, hospitality, retail, services and businesses without websites; measure factual support, useful creative specificity, conflict handling, unnecessary question rate, latency and cost. Include stale sources, contradictory sources, inaccessible websites and malicious embedded instructions. No claim of a high-quality agent based solely on a working API call.

### Product priorities

1. Dashboard: what needs approval, what is being created, upcoming posts and items requiring attention.
2. Calendar: clear visual schedule, post previews, accessible date changes, and recoverable scheduling conflicts.
3. Easy management: approve, request changes, reject, pause and resume campaigns without technical forms.
4. Automated posting: once users authorize a schedule and approve the applicable content versions, publish through existing connected accounts and configured platform capabilities. Provide visible scheduled, published and failed states; reconcile uncertain submissions before retrying to prevent duplicates. Show connection-expiry and publishing failures as actionable tasks.
5. Create: optional sidebar workflow for bespoke work, retaining saved chat and canvas functionality.

Research/agent details must not displace these primary tasks. No separate “Meet our agents” destination is required for launch. Automation never bypasses account permissions, exact-version approval or existing publishing authorization. The dashboard must distinguish an approved draft from a genuinely scheduled post and a verified publication.

## Approved refinements, 10 November 2026

- User approved implementation of this plan.
- Mood board previews are included in onboarding, not deducted from the campaign post allowance. The included delivery remains one static and one three-slide carousel, initial plus one successful feedback regeneration. Provider cost metering and capacity checks still apply.
- New mood board visual reference: `Screenshot 2026-11-10 at 8.32.28 PM.png` supplied in chat. Use an art-directed, asymmetrical tile composition with a large hero creative, actual heading/body font specimens, palette swatches, supporting image/detail tiles, and the navigable carousel. Responsive reflow must preserve reading order and artwork proportions. Approval and revision controls sit below the composition.
- Adapt the composition to each business. Do not copy the reference's NovaVolt identity, Aeonik license-dependent font, metrics or unsupported environmental claims. Use the verified font catalog and actual generated preview assets.

- Initial subscription allowance approved by the user: 20 static posts, 5 carousels and 5 videos per month, configurable for later changes. Onboarding previews are separate. The initial automated campaign still uses static/carousel content; video remains available through Create. This quota must be implemented and atomically enforced before enabling the new flow, not merely displayed.

### Calendar-first approval follow-through
- Calendar now shows saved concepts, dates and formats with per-post editing and an explicit approval action before asset production.
- Image, carousel, video and batch generation entry points check the approved guided-plan revision. Independent Canvas creation is unaffected; production-stage post revisions do not force whole-month reapproval.
- Focused contract checks pass (6 checks including brief contracts). This is local implementation evidence, not deployed or live generation verification. Full journey and remaining reference parity work remain open.

### Recurring monthly journey and Calendar handoff
- Onboarding now hands the prepared plan to Calendar, where concepts and dates are reviewed before production. The redundant approval list in onboarding was removed.
- Calendar's planning entry and legacy new-campaign route use the guided flow. The legacy campaigns landing shows Calendar, preserving existing saved links without exposing a separate campaigns list.
- A production-started plan no longer blocks the next plan in the UI. Users reuse their locked direction and see remaining allowances; server-side checks still apply.
- Calendar shows planning/production status, retries saved failed requests, and periodically refreshes state. Post editor terminology replaces remaining campaign wording on this surface.
- Web production build passed. Four mocked browser scenarios passed, including responsive onboarding, mood board revision/approval, repeat planning, exact-revision Calendar approval and reload persistence. These are not live provider or deployment verification. Automatic monthly videos, full reference parity and complete deployed journey remain unfinished.

### Monthly video concepts
- Monthly planning accepts 0–5 videos alongside static posts and carousels, checks the shared video allowance, and preserves reel/vertical placement (LinkedIn uses feed/landscape).
- Approval creates durable batch items for video concepts while images/carousels queue independently. Videos without starting references remain awaiting selection; they are not presented as generated or charged as completed output.
- Calendar and onboarding progress identify videos needing images. The existing video post editor returns to Calendar.
- Tests exercise 30 planned concepts and an idempotent 25-job image/carousel batch with five held video items. Automatic reference resolution/video submission remains unfinished; current behavior explicitly requires choosing each starting image.

### Selected monthly video handoff
- Calendar review now offers one approved uploaded starting image per video. The exact image checksum and concept revision are bound when the user approves the calendar; missing selections remain explicit rather than selecting arbitrary brand media.
- Migration 099 adds persisted video selections and safe errors. A server scanner resumes selected videos through VideoCanvas with stable request keys, existing metering and reference validation, and explicit generation authorization by the approving owner/admin. One active video per brand is respected.
- Revoked references stop submission; saved retry recovers after correction. Existing video requests are never blindly regenerated. No automatic publishing was added.
- Local TypeScript/web production builds pass. Ten PostgreSQL workflow tests and five MOCK API browser tests pass, including video selection on mobile, revoked-reference recovery, idempotent submission, scanner exit, quota checks and calendar revision approval. These tests do not prove provider output. Migration 099, API/web changes and the full updated flow remain undeployed and require live validation.

### Confirmed simplified customer journey (November 11)
1. Complete basic onboarding and approve a visual direction.
2. Review concepts and proposed dates together in Calendar.
3. Explicitly approve that plan before any monthly asset generation.
4. Review generated assets in Approvals; edit or recreate individual posts without restarting the month.
5. Approve exact finished versions for scheduling through connected platforms.
6. Use Create for independent custom posts at any time.

Campaign grouping is internal, not a separate customer task or sidebar destination. Calendar approval authorizes generation only, not automatic approval or publication of resulting assets.
