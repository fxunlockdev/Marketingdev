# Desvio experience direction — owner V5 correction

The 21 October 2026 owner correction supersedes the earlier navigation and visual decisions below. Use DESVIO_UI_V5_PRODUCT_SPEC.md and NEW_NAV_AND_UX_HANDOFF.md, mapped to existing services through IMPLEMENTATION_STATUS.md. Keep the existing architecture.

One account owns up to three businesses by standard entitlement, with business-scoped access. The user sees businesses directly. Navigation: Overview → Brands → Content Plan → Review Inbox → Canvas → Publishing & Analytics → Memory → Connections → Team → Billing → Profile. Use the supplied warm cream/ink/terracotta/sage reference, not the previous blue/white palette.

Onboarding is exactly three short steps: Your business → Confirm your brand → Review goals & finish. AI must pre-fill the final recommendations from real scraped/uploaded/confirmed context; the user reviews/adjusts rather than completes a blank configuration form. Recommendations need evidence and honest uncertainty. Team/social connection setup can come later. Persist progress. No fake scrape or recommendation result.

## Historical direction — superseded where conflicting

# Desvio experience direction

Owner decisions: multiple client tenants; Desvio identity; brand-specific OpenAI/Higgsfield creatives, revisions and social publishing; end-to-end product goal. Working defaults: English, LinkedIn first then Instagram, explicit human approval. This is planned behavior, not shipped UI.

**Confirm brand → Create → Revise → Approve → Schedule → Learn.**

The marketer moves between client workspaces and needs to know what is approved, what needs attention and what will publish. Client and brand selectors stay visible. Organizations are authorization boundaries; staff can be explicitly invited into multiple clients. Every estimate, approval and scheduling confirmation names the client and brand.

## Simple navigation

- Home: next useful task, incomplete brand review, pending creative or failed publication. No decorative KPIs.
- Create: goal/brief, channel/format, grounded brand context, plan and cost before generation.
- Calendar: real draft/review/scheduled/published/failed/unknown states, account and timezone.
- Brand: approved facts/visuals/voice/products, provenance and proposed changes.

Reviews remain accessible from Home/Calendar. Connections, team, usage and admin setup live in role-restricted settings. Insights appear only when actual measurements exist.

## Onboarding and revision

Start with website plus optional PDF/PPTX; allow manual-only brands. Show partial findings/coverage. Correct/Wrong/Edit on business, product, audience, voice, visuals and prohibited claims, with sources. Resolve conflicts explicitly; save/resume; approve an immutable Brand Brain version.

Generate a small batch after a clear estimate. Copy, text/logo/layout/crop remain separate editable layers with autosave/undo. OpenAI image revisions create new versions. Video revisions change the storyboard/scene; regenerate affected scenes where supported, then recompose overlays/captions without new video calls. Do not promise arbitrary native video editing before model-contract proof.

Keep prior versions; show changes/cost. Approval binds exact version and account. Editing invalidates approval. Scheduling confirms final copy/media, destination and time. Failures preserve accepted edits and show a safe next step; unknown publication is not success.

## Visual direction after backend tests

Domain: brand evidence, briefs, editorial marks, revisions, client identity, campaign schedule. Color world: proof-paper white, charcoal ink, blue correction marks, slate panels, restrained approval green. Signature: a compact provenance strip linking brand version → creative version → approval → publication, details on demand.

Use editorial hierarchy, generous creative canvas, one action accent, clear focus and modest radii. Avoid KPI-card walls, chat-only workflows and vendor-based navigation. Intended 16px body/14px controls/24–32px headings, 4px spacing scale; semantic tokens and accessible native/headless primitives. Validate keyboard, contrast, reduced motion and mobile review against real UI states. No extensive UI before backing API/persistence/workflows/tests.
