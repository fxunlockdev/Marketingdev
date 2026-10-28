# Compact campaign creation and calendar layout

Written against: d19d188dde5240f4427e9625228f64338897fd5b plus current working changes.

## Evidence chain
- Surface: /b/:id/content-plan and /b/:id/campaigns, user screenshots October29 01:16,01:18.
- Design language: white surfaces, neutral borders, black primary buttons, visual content cards, compact controls. Sources: apps/web/app/studio.css and user-provided Blaze calendar/New Post reference screenshots. Exceptions: none documented.
- Owners: apps/web/components/businesses.tsx renders the shell page title; content-workspace.tsx renders a second Calendar heading. studio.css and v5.css own layout sizing.

| Problem | Evidence | Proposed change | Scope | Confidence |
|---|---|---|---|---|
| Calendar heading duplicated with excessive space before controls | Runtime screenshot; shell workspace-page-title plus content-workspace section-heading h1 | Use one visible Calendar title, preserve an accessible heading/focus target; compact action row and activity disclosure | Calendar/Approvals shared layout, preserve Approvals description | High |
| Calendar action clipped at right viewport | Runtime screenshot; visual week grid has seven minimum-width tracks inside a grid workspace | Contain horizontal scrolling within week board; ensure min-width:0 on all owning grid/flex ancestors, wrapping header actions | Workspace/calendar; verify other routes | High on symptom; confirm ancestor causing overflow before edit |
| New Post reference controls are nested and upload is unavailable | Runtime screenshot shows Reference images > Brand image references and no upload | One reference area with upload, selectable previews and remove; use existing persisted asset pipeline | Campaign New Post | High |

## Design decision
Highest leverage: contain calendar width at its layout owner so the page header and actions remain visible while only the visual board scrolls. Maintain existing neutral design rather than introduce another theme.

## Reuse
Reuse existing Field, button styles, asset upload and reference selection pipeline. Do not introduce parallel upload storage or change generation credit behavior.

## Changes
1. apps/web/components/content-workspace.tsx: eliminate repeated visible title in shell context, preserve heading focus restoration and accessible naming. Keep create action close to toolbar, not separated by large empty space.
2. apps/web/app/studio.css and relevant v5 layout owners: inspect actual computed width, apply min-width:0/max-width:100% only where needed; retain board horizontal scroll, no body overflow.
3. Campaign New Post owner: assigned independently to campaign_creation; direct upload and flat reference panel, constrained viewport height with stable footer. Preserve topic/context/date/channel generation semantics.

## Validation
- Render calendar at375,768,1280,1440 widths; body.scrollWidth <= viewport; header create action fully visible; board can scroll independently.
- Calendar navigation, filtering, card opening, focus return and create panel still function.
- New Post: long campaign title, upload pending/error/success, selected image removal, mobile keyboard, modal scrolling; actual selected IDs arrive at generation API.
- Repository: npm exec --workspace apps/web tsc -- --noEmit (or repository equivalent) passes.

## Scope
Inherit calendar shared layout; verify approvals/campaigns/home. Exclude backend generation and publishing logic. Do not hide overflow globally to mask clipped controls.

## Stop conditions
If source ownership differs or computed width disproves cause, investigate owner before editing. Preserve existing uncommitted changes.

## Design documentation
After visual verification, keep this plan as evidence; no new global design language needed.

## Follow-up measurements (October 29)
Before this follow-up, the existing min-width fixes already contained the board at all measured widths. At viewport375/768/1280/1440, document.scrollWidth was exactly375/768/1280/1440; the create action right edge was355/740/1244/1404. The week board independently scrolled1892/2172/2760/3012px inside311/462/958/1118px. The reported clipping is not reproducible in current local source; no global overflow hiding or broader shell change was applied. This follow-up removes the duplicate visible Calendar heading while preserving its accessible focus target, and puts Create content plan in the wrapping toolbar. Approvals retains its heading and description.

A further rendered check found the image/card shrinkage owner: generic button `justify-content:center` created a147.484px auto grid track inside a418px card content box. The calendar week card now declares a single `minmax(0,1fr)` track with stretched content and left-aligned text. Recheck reports418px for card/header/media/action width. All four viewport checks, independent week scrolling, navigation, filters, and creation-panel toggling pass after this fix.
