# Blaze journey audit

Observed in the user's authenticated browser on 2026-10-25. This is an incremental observation record, not a claim of full product coverage or implemented parity. The user is also advancing the browser. Only visible UI is evidence; internal service behavior is unknown.

## Coverage

| Journey | Observed | Still to verify |
| --- | --- | --- |
| Website onboarding | Entry, research animation, business fields | Validation, recovery, persisted edits |
| Strategy, campaign, scheduling | Selection, campaign fields, channels, days, mix | Quantity editing, saved custom schedule |
| Style and fonts | Full galleries, preview changes, save states | Generated result fidelity |
| Topics and references | Review rows, topic editor, reference chooser | Saved edits and stock replacement |
| Generation | Five-item batch, optional questions, four completed previews | Fifth pending item; exact credit debit |
| Home, calendar, campaigns | Visual cards, filters/views, campaign detail, creation dialog | Drag persistence, full new campaign submission |
| Brand Kit and preferences | All kit tabs, general preferences, source/media menus | Stock search/import, avatar/blog settings |
| Approvals, learnings, insights | Approval cards; account-gated learning/analytics | Approval/publishing and real analytics |
| Integrations and settings | Provider groups, account/general/members settings | OAuth connections; security/notification settings |
| Ads and SEO | Setup entry screens | Connected paid workflows, deliberately not started |

## Website to brand confirmation

- Minimal website input and a single Build My Profile action.
- While researching, changing headings include Learning about your business, Pulling photos & media, Identifying your brand.
- Visual explanation connects a website skeleton to a brand-profile card with an arrow. Example card is explicitly labeled Acme Studios (Example); its progressive Type/Audience/Position fields are illustrative, not verified extraction.
- Result screen heading asks to confirm business basics; sticky bottom Looks good action.
- Editable business name.
- Three large business-type choices: Services (consultants/agencies/freelancers), Local Businesses (restaurants/stores/salons), Products (e-commerce/manufacturers).
- Elevator pitch appears in a bordered rich-text area, with readable paragraphs and emphasis.
- Audience age minimum and maximum, audience gender (All genders/Women/Men).
- Primary market locations as removable chips with Add opening a location search combobox.
- Separate visual representation controls: age range, gender, ethnicity. These are creative depiction preferences, separate from the audience.
- Primary language select with locale variants.
- Market positioning rich text separates primary, secondary, tertiary positioning.
- Runwal result showed website-specific identity and location information, not scraped navigation or provenance IDs.

## Strategy selection

- Recommended Lifestyle Content selected prominently with large image, brief explanation, recommendation reason, and checked outline.
- Alternative cards: Offer & Promotion, Product Education, Problem/Solution; thumbnail plus short description.
- Bottom CTA reads Continue with Lifestyle Content.
- Page fits a narrow viewport with generous spacing and restrained borders. Current browser viewport is approximately 594 × 822; desktop layout has not been inspected live.

## Campaign generation transition

- Heading Writing your campaign theme with in-progress indicator.
- Explains that each campaign directs one week's content.
- Visual strategy card → arrow → campaign details card.
- Campaign name and theme fill progressively; completed row has a checkmark.
- Example name seen: Building Trust Through Storytelling. Do not assume this animation is the saved final campaign.

## Implementation principles pending full audit

- Preserve Desvio branding and real service contracts.
- Separate stages; move internal provider configuration and provenance out of ordinary creation flows.
- Bind visible feedback to real state. Label illustrative animations clearly; never fabricate research results or generation progress.
- New fields must persist and affect generation, not merely decorate the form.
- Verify transitions, refresh persistence, failures, and keyboard/mobile behavior before declaring a journey complete.

## Channels, schedule and first-week mix

- Channels grouped by delivery format: feed posts (Instagram, Facebook, LinkedIn, X, Google Business Profile), Stories (Instagram, Facebook), short-form video (Instagram Reels, TikTok, YouTube), long-form/email (Blog, Newsletter).
- Schedule radio choices: Everyday, Weekdays only, Let me select days. Custom days opens a Monday–Sunday multi-select menu.
- Continue becomes disabled and reads Saving while committing.
- Recommended weekly mix uses two-column thumbnail cards in narrow viewport. Initial counts: three still images, one carousel, one blog, one email; other formats zero.
- Visible costs: stills/stories 6 each, carousel 24, feed/short-form/avatar videos 40, blog 20, email 8; initial weekly total 70. These are observed Blaze prices, not Desvio pricing requirements.
- Total cost and a short explanatory disclosure sit above the sticky Looks Good action.
- Clicking a format label did not reveal an editor. Quantity editing remains unverified.
- Top overflow menu has Switch Workspace, Help Center, Sign Out.
- User authorized a maximum of 20 existing Blaze credits for exploration. No generation was submitted by the agent. Simultaneous user navigation changed selected channels while the agent was inspecting; do not interpret these changes as automatic product behavior.

## Unverified interaction contracts to resolve

| Interaction | Observed promise | Verification still required |
| --- | --- | --- |
| Confirm brand | Prefilled editable fields, Looks good advances to strategy | Reload persistence, edited-value influence on generation, invalid input |
| Choose strategy | Large selected card and named Continue action | Alternate choice feedback and persistence |
| Save schedule | Saving feedback and disabled submit | Custom days persistence and generated date alignment |
| Confirm mix | Explicit total credit preview | Editable counts, final generation trigger, debit timing, failure recovery |

Selected UI skill: `kemiljk/interaction-contracts` through ui-skills. Apply observable trigger/state/persistence/recovery/accessibility contracts to Desvio implementation after the remaining live audit.

## Visual style selection

- Entire step switches to black background; hero photographic preview occupies most of the viewport.
- Three initial suggestions: Dramatic Luxe, Golden Hour, High Bloom. Bottom thumbnail strip includes See All.
- See All opens a three-column image grid, selected tile outlined in white, with selected style name and sticky Use this style button.
- Observed library: Day One, Executive Warmth, Amber Glow, Cyan Crisp, Night Owl, Dramatic Luxe, Classic Mono, High Bloom, Sun-Drenched, Golden Hour, Gauzy Portrait, Deep Contrast, Amber Shadow, Indigo Dusk, Electric Pulse, Hero Shot, Retro Frame, Negative Edge, Disposable Camera, Saturated Film.
- Clicking Golden Hour updates the selected style heading immediately. Returned to original Dramatic Luxe before continuing.
- Use this style in the gallery returns to the large preview; Use this style in the preview saves (disabled Saving state).
- These style names and sample photos are observation evidence, not assets to copy into Desvio. Equivalent original style presets must carry real generation instructions.

## Fonts and enhancement

- Font step keeps the selected style photo full-bleed, adding sample promotional copy rendered in the chosen typeface.
- Three suggested heading/body pairings, Browse All Fonts, and sticky Use this font.
- Full library shows font-pair sample tiles; selected choice returns to preview before saving. Existing pair used for inspection: Playfair Display / Helvetica World. Desvio must use licensed fonts or open alternatives.
- Enhancement mode uses one selected card among Optimized, Balanced, Brand-first, Strict brand control. Descriptions explain creative freedom versus preservation; strict mode states only unmodified Brand Kit assets and no carousels.
- Selecting Balanced visibly changes the preview from high to medium enhancement and updates selected state. Original sample thumbnail remains visible for comparison.

## Topic/reference review

- Grouped by format, each item combines a real reference thumbnail and a plain-language topic.
- Current observed list: three still-image topics, one carousel, one story. The user changed channel/mix settings during exploration; original 70-credit mix is no longer authoritative.
- Clicking a row opens Review and adjust topic: reference image with file chooser, focused multiline topic editor, Back, More and Help.
- More produced no visible change in the inspected topic editor. No topic text was changed; autosave behavior remains unverified.
- User clarified approximately 80 credits available after the earlier 20-credit message. Final generation cost must be observed before an agent-triggered spend; no such spend has been triggered by the agent.

## Generation and optional questionnaire

- Continue from the reviewed five-topic list initiated generation. Exact debit is not yet shown; do not report a confirmed cost. Visible format prices imply 48 credits for three stills, one carousel, one story, within the user's subsequent approximately 80-credit allowance. No additional generation should be initiated until balance/debit can be verified.
- Generation display: spinner, Generated 0/5 posts, elapsed timer, Email me a link to edit and post action. Email action was not used.
- Optional collapsible questionnaire overlays generation: brands that sound like you; words to avoid; customer pain points; upload brand photos for future generations.
- Questions offer Continue and Skip Question; upload offers Skip Step. Text questions were skipped without inventing brand answers, and no private files were uploaded.
- User continues navigating concurrently, so transitional failures/detached controls cannot be attributed to Blaze bugs.

## Verified Desvio implementation boundaries

- `apps/api/src/planning-contracts.ts`: current planner accepts LinkedIn/Instagram and static/video slots only. Blaze's additional channel and format choices cannot be exposed as working without extending the real typed generation and publication paths.
- `apps/api/src/brand-brain.ts`: existing fields include name, offering, audience, voice, colors, prohibited claims, positioning, CTA, fonts, products. Structured demographic, locale, category and preset controls need a deliberate persisted contract, not an unconnected UI.
- `apps/api/src/brand-visual-review.ts`: visual suggestions already support reviewed/edited direction and immutable approved snapshot facts. Style selection must preserve provenance and owner priority rather than overwrite research evidence.
- Existing generation and chat APIs can support a more visual review journey, but the observed reference-per-topic and batch-generation experience need explicit persistence, budget, and retry checks before claiming parity.

## Observed limitation to avoid carrying over

At five minutes, generation remained at 4/5. The narrow generation surface is black with only the progress row and email-link action; no completed-post entry point or cancel/retry control was visible. Desvio should expose available completed results and truthful per-item state while remaining jobs run. Do not reproduce this blocking presentation merely to achieve visual similarity.

Opening app.blaze.ai in a second tab successfully reached the dashboard while onboarding continued. The dashboard does expose completed cards alongside pending ones and a persistent generation bar. Thus this limitation is specific to the onboarding screen, not the overall product.

## Workspace and post review

- Desktop observed at 1280 × 720: compact pale sidebar, white main surface, restrained borders, small action buttons, content cards dominate.
- Home: connection banner; upcoming cards with format/time, actual preview, caption excerpt, review status; campaign table with thumbnail/name/strategy/date range/generation state; upcoming actions and real-data empty analytics.
- Balance observed: 158 credits. Starting balance and actual debit not observed; do not infer exact spend.
- Story Preview opens a three-column full-screen review: chat left, large platform mockup center, schedule/channel/campaign/quick actions right.
- Top bar: Back, Calendar, title, Review status, overflow, Previous/Next, Don't Post, Approve, credits/profile.
- Chat suggestions cover photo content, background, text overlay, colors and logo. Composer supports Attach and send. No paid edit submitted.
- Right rail: posting date/time, platform connection state, campaign link, Edit Design, Regenerate video, Replace with Media.
- Bottom feedback: thumbs down/up and dismiss. No approval, publication, social connection or email action performed.

## Design editor

- Top: title/breadcrumb, Draft, Share, Actions, Undo/Redo, Elements, Media, Text, Templates, Backgrounds, Resize, Brand, Post.
- Canvas zoom observed at 25%; platform View as previews.
- Brand panel: logos, colors/palette, title/body fonts, real website media thumbnails.
- Text panel: Add Text Box, brand title/body presets, named style presets.
- Selected text layer: font family/size/weight; left/center/right alignment; bold/italic/strike/underline/uppercase; spacing; color/background/border/shadow/opacity; canvas alignment; rotation field and slider; Forward/To Front/Backward/To Back; copy/delete.
- Resize panel: platform-specific presets and dimensions grouped into social, standard sizes and marketplace. Includes square, portrait, landscape, story/reel, covers, profile pictures, Pinterest and marketplace product images. No resize applied.

## Calendar

- Default Compact view: day columns with large visual cards and drag handles; title/time/caption/status per card.
- Toolbar: previous/Today/next, date range, Review count, view menu, filters, credits.
- Observed view menu: List, Week, 5 Day, Compact. Month was not present here; retain user's explicit Month requirement for Desvio.
- Filter groups: Campaigns, Post Type, Accounts, Post Status, Projects.
- Status options: Draft, Review, Approved, Failed, Posted.
- Cards have selection checkbox and overflow; scheduling banner explains accounts need connecting.
- Drag/reschedule persistence and batch approval have not been executed.

## Brand Kit tabs

- Media Library: image/video counts; thumbnail grid, names/type/upload date, Used badge, selectable items. Add New Media offers upload, Google Drive import, AI generation, link import, stock images, stock videos.
- Brand Style: logos/Add More; visual style/Change; fonts/upload/pairing, separate title/body family and weight; colors/New Color; visual identity description/Edit. Current page displayed Selected style None despite earlier onboarding selection; cause is unverified.
- Brand Voice: Purpose and Audience textareas; add/remove chips for Tone, Emotion, Character, Syntax, Language.
- Brand Profile: independently editable business name, overview, positioning, competitors, competitive advantages, customer segments, revenue generators, growth areas, value drivers, emotional benefits, brand story, personality.
- Profile includes numerical customer-segment percentages without visible support. This is observed content, not verified business evidence; Desvio must not fabricate percentages.
- Source Materials: name/type/last-scanned/added table, rename/open/delete actions; Add Source Material offers upload, Google Drive, website, account, pasted text. No source deletion/import performed.

## Content Preferences

- Language; excluded words/concepts as chips; market locations; audience age/gender; representation age/gender/ethnicity; optional representation notes (explicitly applies to stock selection, not AI generation).
- Content Modification controls mirror enhancement choices with fidelity descriptions.
- Video preferences expose music, narrations, captions.
- Default CTA copy and URL.
- Smart Captions switch with platform-specific caption descriptions, currently off. No switch changed.
- General/avatars/blogs links exist. Clicking blogs changed URL hash but did not change visible general form in the observation; do not claim its underlying configuration was inspected.

## Campaign details and adding posts

- Campaign title input, image change, delete, duplicate, generation status and review link.
- Campaign Details: inline Theme textarea, CTA copy+URL, Audience textarea, Add Context and Context Settings.
- Schedule & Accounts: starts-on date, duration selector, connect-accounts link, weekly content mix.
- Review Posts displays preview cards and Add Posts.
- Add Posts opens a modal and automatically suggests a topic/reference before submission. Fields: topic, context, regenerate topic, format, posting date/time. Actions: New Post, Blank Post, Schedule 1 Post.
- Formats: still, carousel, feed video, short-form video, avatar video, story, blog, email.
- Closed the draft without scheduling or requesting regeneration. Opening the form triggered Finding Visual; its billing behavior is not shown.

## Approvals, learnings, insights and settings

- Approvals groups real preview cards by campaign and date range, with an Approve All action. Pending generation is visible beside completed posts. No approval was submitted.
- Learnings has a connection-gated entry with explanatory steps. Marketing performance claims are page copy, not verified evidence or Desvio requirements.
- Insights is gated by connecting Instagram; placeholder metrics behind the gate are not real performance and must not be copied as data.
- Campaign Create New offers Post, Campaign, Add Strategy. Campaign form includes strategy, brief, context via webpage/upload/Brand Kit, Cancel and Continue.
- Campaign Settings splits Content and Growth Settings. Growth offers automatic strategy expansion and post-frequency expansion; current Manual/Flat selections were left unchanged.
- Settings separates Account/Profile/Notifications and workspace General/Members/Billing/Security/Danger Zone.
- General includes name, interface color, paid white-label option, timezone combobox, autopilot, review-before-posting and snippets.
- Members contains invitation-link controls, allowed domains, and member role/email/added/active table. No invitations or access changes performed.
- Meta Ads entry requires Meta connection, campaign and budget setup. Example campaign figures are illustrative, not account results.
- SEO entry offers setup and explains keywords/blog publishing. No plan or paid ad spend initiated.

## User-confirmed target sequence (2026-10-25)

The user's 18 screenshots and accompanying instructions are the implementation target, supplementing the live observations:

1. Learn brand; show understandable profile and business type.
2. Choose content strategy, then campaign name/theme/CTA/target URL.
3. Select platforms/days and adjustable quantities by post type, with an honest credit or cost total.
4. Visual style gallery and font-pair previews; choices must affect generated content.
5. Content enhancement/fidelity selection.
6. Review each topic with a replaceable website, uploaded or stock reference image.
7. Optional preferences questionnaire; durable batch generation and opt-in completion email.
8. Simple Home with upcoming previews and weekly campaigns; visual Calendar with requested Month option.
9. Dedicated Campaigns, Brand Kit, Content Preferences, Approvals, Learnings, Insights, Media Library and Archived Posts.
10. Create New offers Post/Campaign/Strategy; connections must complete real OAuth and publishing verification.

No fake unsupported channel buttons, invented credit balances, decorative unsaved fields, or timer-based completion. Keep the user's separately requested conversational Canvas. Additional supported formats/channels require persisted contracts and working adapters before release. User approved US$6 total API testing spend. All requested channels require plumbing; the owner will configure the Meta developer app. Monthly plans are US$500, US$800 and US$1,000, targeting 80% gross margin. The US$800 plan includes five reels per month and one static post daily. Provider-cost ceilings are US$100/160/200 respectively; generation, edits and retries must fit the allowance. Remaining tier quantities require cost validation; payment collection remains outside this goal.

## Implementation progress: Home and campaigns

- Home reads real upcoming posts and campaign summaries from the tenant-scoped overview API. Cancelled slots do not inflate campaign counts.
- Campaign links use a persisted plan identifier as a calendar filter. Reload preserves the filter; Show all campaigns removes it.
- Dedicated Campaigns navigation lists the saved plan catalog, grouped by Monday-starting weeks, including past campaigns. Creation now opens the dedicated campaign builder.
- Home keeps upcoming posts, campaigns and three primary counts visible. Activity, metrics details and learning proposals are expandable; publishing attention remains outside the collapsed section.
- This is not full onboarding/creation parity. The visual campaign wizard, asset selection flow, complete provider coverage, credit enforcement and live generation checks remain outstanding.
- Current channel restrictions exist in planning contracts, OAuth allowlists and database constraints, not just UI. All-channel support needs coordinated migrations, provider-specific adapters and contract verification.

## Implementation progress: Brand Kit

Dedicated Brand Kit navigation now opens the existing persistent profile/style review and media upload/reference approval services. Owners/admins can explicitly save a reviewed brand version; unsaved field edits prevent approval. The profile uses current AI findings and retained visual directions, while media remains private and requires explicit image-reuse approval. This reuses the real versioned brand service rather than duplicating brand data. Separate visual font/style galleries and a richer media grid remain outstanding.


## Implementation progress: Content Preferences

Dedicated saved-preference page now supports goal, 90-day target, posting frequency, time zone, channel selection and excluded topics. Uses the existing revision-checked, tenant-scoped settings consumed by planning requests. Unsaved navigation guard and explicit reload preserve drafts after conflicts. Verified by 22 passing customer browser tests, including persistence, conflicts and mobile accessibility. Local only. Instagram/LinkedIn are the current supported preference channels; this does not establish all-channel or complete Blaze preference parity.

## Implementation progress: campaign details and mix

Campaigns now opens a dedicated three-step builder: campaign details, channel/date/count selection, and review. Name, theme, CTA, normalized target link and campaign-specific channels persist in the planning request and saved plan; these do not overwrite business defaults. An uncertain submission is retained across reload with the same idempotency key. The actual isolated planning runtime accepts the structured campaign context and continues enforcing approved-fact grounding. Nineteen planning foundation tests and nine planning contract tests pass with mocked model transport; no paid generation was performed.

This is an initial functional portion of the requested journey, not complete parity. It supports Instagram/LinkedIn and image/video draft counts. Credit selection, visual style/font galleries, per-topic image replacement and all-channel publishing remain outstanding. Changes are local and not deployed.

Campaign browser verification: 23/23 customer tests pass after a clean build, including reload-safe submission and mobile accessibility. The Brand Kit read now holds the review version stable while retrieving its findings, and older UI refresh responses are discarded. No deployment performed.

## Campaign visual selections (verification in progress)

The campaign wizard has separate Style and Font steps after the content mix. Four selectable style previews use the entered campaign name; three typography treatments use locally bundled DM Sans and DM Serif Display from the Google Fonts library, with OFL licenses and source hashes in `apps/web/public/fonts`. These are original CSS previews, not copied Blaze artwork.

Choice changes are immediate and reversible with Back. They are submitted with the reviewed campaign and included in the existing reload-safe request. Server validation accepts only the supported style/font IDs. The saved campaign context reaches the isolated planner and the static-post generation request. Image generation receives typography as a design instruction; exact font rendering in raster AI output is not guaranteed. Brand Kit-wide default selection and existing campaign editing are still outstanding.


## Saved topics and reference-image review

Static topics can be edited inline before generation. The saved topic retains up to three approved brand references; reload restores those choices, and the generation service uses them unless the user explicitly supplies a replacement selection. Revoked or wrong-brand references are rejected before submission. A revision conflict preserves the draft, offers a comparison with the current saved topic, and requires an explicit save to replace it.

Verification: 16/16 creative foundation checks passed with actual isolated skill execution, database, storage and durable jobs, and mocked paid transports. These include campaign design instructions, reference provenance/revocation, retry idempotency and concurrent-edit preservation. The focused browser journey passed topic editing, selected-image persistence and conflict recovery. Saved image thumbnails were subsequently added to the read-only topic view; their viewport-triggered loading is undergoing a separate browser recheck. Stock discovery, automatic site-photo selection, video inline review and direct bulk generation are not complete. Nothing in this batch has been deployed.


Visual recheck found and fixed low-contrast white cards within dark Canvas and an active loader incorrectly shown for future planning cycles. The focused browser flow now passes a measured 4.5:1 minimum topic-text contrast assertion, future-loader absence, saved image preview after scrolling/refresh and removal of a revoked reference. The rendered screenshot was inspected. These checks use fixture imagery and mocked paid transports; they do not certify live visual generation or complete UX parity.


## Brand-photo style and font previews

The style and font steps now load approved brand references through the existing scoped private-image service. Users can switch the preview image while comparing four layouts and three bundled font treatments; this preview choice does not overwrite per-post reference selections. Empty libraries retain the text/layout previews. Loading errors offer a retry, and image refresh reloads the private previews. Selector labels remain stable while images load.

The focused local browser journey passed approved-image loading, style/font choices, Back preservation, mobile overflow and accessibility checks, plus the existing topic-edit and reference-revocation journey. The screenshots use a solid-colour image fixture to verify layout and storage delivery; live brand photography and generated output quality are not certified by this check. Screenshot review prompted a wider headline area in the bold style, and the final recheck passed. No paid API calls or deployment were performed.

## Second live visual audit, 2026-10-25 evening

User explicitly superseded adapting these patterns to the current Desvio structure: rebuild the journey around the reference navigation and focused screens. In-app browser inspected at 836 × 822. No Blaze generation, publishing, saved edits, or purchases performed.

- Home: 190px pale-gray sidebar, 60px white header, content inset approximately 48px. Upcoming previews use native aspect ratios, compact metadata, short clipped captions and status overlays. Primary Create New button measured 28px high, 6px corner radius, 14px text. Sidebar Home link measured 170 × 35px, 8px radius, 10px padding. These compact desktop controls need adequately spaced touch targets in Desvio.
- Create New opens a centered chooser: Post / Campaign / Add Strategy. Campaign opens a focused dialog with Strategy, short brief, and context from webpage, upload or Brand Kit; Cancel / Continue footer. No inline chat history in this journey.
- Calendar: compact toolbar, Today and period arrows, review count, view and filter menus. Actual view menu observed: List / Week / 5 Day / Compact. Preserve the user's additional requested Month view in Desvio. Posts remain image-led across views.
- Brand Kit: separate local tab navigation for Media Library / Brand Style / Brand Voice / Brand Profile / Source Materials. Style page separates logos, photo style, font pair and individual font weights, colors, visual-identity description. Photo Styles opens an image gallery with Cancel / Confirm Selection. Existing style was unchanged.
- Content Preferences: single narrow white column, compact fields and chips, generous spacing between groups, no nested oversized cards. Full screenshot captured through browser inspection. Existing values unchanged.

Implementation in progress: dedicated `/campaign-review` removes the forced Canvas detour after campaign creation. Real saved topics/references and generated creatives are shown in visual cards with a sticky generation control. Quantity is selectable; existing server-side allowance enforcement remains authoritative. No claim of complete button-by-button parity or generated customer assets yet.

### Review, media, connections and secondary screens (evening continuation)

- Full-screen post review replaces the workspace sidebar. Top action bar: Back, Calendar, review status, previous/next, Don't Post, Approve. Left conversation, central native-format post preview, right schedule/accounts/campaign/quick edits. Do not bury the preview under the conversation transcript.
- Replace with Media is a focused dialog: Upload, Generate with AI, Add from Link; visual rows for generated assets, Brand Kit, Stock Photos and Stock Videos, with See All. No asset was selected or uploaded during inspection.
- Campaign detail separates theme/CTA/target/audience/context from schedule/accounts/content mix, followed by actual posts. Campaign list uses thumbnails, timing and status. Its narrow-screen title truncation is a reference defect to improve rather than reproduce.
- Integrations separates active campaign accounts from available channels, then blog/email/ads/other automation. Instagram Connect opens prerequisite guidance before OAuth. Inspected guidance only; no accounts connected. Provider requirements must follow our actual integration capability, not blindly repeat Blaze's account-type claims.
- Learnings in this unconnected account is a connection-gated introduction. Actual learned recommendations cannot be audited without connected performance data. Do not reproduce its marketing claims as verified Desvio results.
- Insights is likewise connection-gated; a visible Instagram connection action sits over an unavailable dashboard. No real metrics available in this reference account.
- Archive has a single quiet empty state and a Go to Calendar link. Copy explains that deleted posts and previous regenerated versions appear there. No archived data available to inspect.

### Verification of local dedicated review implementation

Focused campaign-review browser scenario passed: custom plan, saved slots, topic editing, generation with mocked provider, real persisted output previews, dedicated route, mobile overflow/accessibility, then return to editing. This is offline integration evidence, not paid-provider verification or deployment evidence. Visual screenshot review exposed an overly intrusive sticky footer on mobile; it was changed to normal flow. The broader parity work remains incomplete.

### Actual visual design editor

Opened a saved carousel's Edit Design link without modifying its content. Dedicated editor hides the normal navigation, keeps the artwork central, and uses a compact top toolbar: Undo/Redo, Elements, Media, Text, Templates, Backgrounds, Resize, Brand and Post. Page controls offer duplicate/delete/add and page reorder/zoom. Brand Styles panel shows logo, colors, title/body fonts and media thumbnails. Media panel contains upload drop zone, Generate Image and Brand Kit thumbnails. These are separate from the full-screen social review shell and its conversation panel. Desvio should preserve this separation rather than place all tools inside one chat transcript. No content was edited, generated, approved or published in this audit.

After removing the sticky footer, the focused campaign-review browser scenario passed again (1 passed, 0 failed). Full release verification and live parity remain outstanding.

### Continued live editor and strategy inspection — 2026-10-25

- Text toolbar opens a compact panel with Add Text Box, Brand Kit Title/Body and visual preset samples. Resize shows named social formats with dimensions; Brand shows logo thumbnails, color swatches, font samples and media in a single panel beside the artwork. Inspected only; no design changed.
- Home → Create New → Add Strategy opens a visual recommendation sheet. Active Lifestyle Content appears separately from Offer & Promotion, Product Education and Problem/Solution. Each recommendation has an image, brief rationale and a Launch now credit amount (64 in this account). Change Growth Settings is a separate action. Launch actions were not clicked; no credits spent. This is a real strategy capability, not a label that can be honestly wired to the existing single-campaign route.
- Local post-review work now replaces the calendar when opening a saved post, retains the selected post in the URL, and returns focus to the calendar heading on close. Saved artwork is prominent; topic/schedule editing is collapsed for completed creatives and exposed for posts that still need generation. Browser verification is pending for this change.
- Carousel offline browser verification: two scenarios passed, including generated slide composition, exact-image review checks, reload, generated carousel, ZIP download, calendar attachment and mobile accessibility. Paid generation was mocked. The earlier timeout did not reproduce; terminal job diagnostics were added rather than claiming an unproven provider fix.

- Home → Create New → Post opens a campaign-scoped composer. After campaign context loads, it shows a picked reference-image tile, editable suggested topic, Add Context, Regenerate Topic, format selector and posting date. Formats inspected: still image, carousel, feed video, short-form video, avatar video, story, blog and email. New Post and Blank Post add entries before the final Schedule N Posts action. No schedule or regeneration action was submitted. This confirms that single-post creation should start with campaign context and a visual reference, not a blank text-heavy Canvas.

### Focused post review verification

The focused campaign scenario passed after the review layout change, then a strengthened run timed out waiting for two mock-provider image jobs (0/2 ready). Added non-success job-state diagnostics and matched the test planning activity's heartbeat wrapper to the production worker. A subsequent strengthened run passed: generated-image review on desktop/mobile, WCAG A/AA scan, no horizontal overflow, hidden calendar while reviewing, collapsed topic editor for ready artwork, close-button keyboard focus, URL cleanup, persisted video-brief edits and reload. Screenshots: `work/browser/focused-post-review-desktop.png` and `work/browser/focused-post-review-mobile.png` (test-only images). The intermittent generation delay was not reproduced or diagnosed and is not claimed fixed. Full production parity remains incomplete.

### Calendar detail and progress recovery — continuation

Inspected the real Week view: horizontally arranged, generous artwork columns; compact toolbar with Today, previous/next week, refresh, review count, view switch and filters. Filters are a two-level popover for Campaigns, Post Type, Accounts, Post Status and Projects; status choices are Draft, Review, Approved, Failed and Posted. No filters or post records were changed. Desvio’s exposed controls and seven compressed week columns remain a visual gap.

Fixed a separate campaign progress failure: a transient image-batch GET error now retries with bounded backoff, while permanent authorization/not-found errors stop. Retries never submit generation. Campaign changes clear stale progress state. The focused browser test deliberately returns one 503, then confirms automatic recovery, image generation, persisted previews, focused review and reload. Result: 1 passed, 0 failed, mocked paid providers. TypeScript passed. Deployment recorded separately; this is not full parity or live image-generation evidence.

### Calendar controls and weekly visual layout

Implemented a compact date/view toolbar with previous/Today/next navigation, collapsed native filters with working clear action, larger horizontally scrollable weekly post columns, and a collapsed planning activity row. Existing day, month, list, drag-to-reschedule and review flows remain. The focused saved-campaign scenario passed twice (including the final collapsed activity adjustment); final run also verifies filtering, >=240px cards, mobile document overflow, WCAG A/AA and prior generation/review persistence checks. Mocked providers only. Screenshots visually checked. Deployment pending at time of this entry.

Next verified gap: `PostThumbnail` only reads static creative design media. Saved video versions have a real poster endpoint, but it is not used by calendar cards. Carousel covers likewise need the saved first-slide preview. Home overview currently omits video/carousel version IDs. These are implementation gaps, not missing generated assets for already saved media.

### Campaign context and asset picker — live browser inspection

Home → Create New → Campaign opens a compact centered dialog with strategy selector, a short brief, and one context panel containing Add Webpage, Upload File and Select from Brand Kit. The Brand Kit picker presents source webpage checkboxes above a four-column image grid; image tiles show selection, descriptions and Used badges, with a fixed Cancel / Use Selected footer. The account has source pages for the homepage, company overview and ongoing residential projects, and 20 media items. This confirms a meaningful gap with Desvio’s single-page, six-photo capture and missing automatic planning references. Inspection only: no assets selected, no campaign submitted, no credits spent.

Saved-cover implementation now loads the exact saved first carousel slide and saved video poster, rather than showing generic placeholders. Local browser verification is in progress. The initial test attempted to fetch a blob URL, which the existing CSP correctly blocks; the corrected test compares decoded image pixels through canvas against persisted output without changing CSP.

Saved-cover verification completed: 2 browser scenarios passed, 0 failed; decoded saved carousel and video poster pixels match, and Home visibly displays both covers. API and Web deployments succeeded; public web health returned 200. Mock generation only. Evidence: `docs/evidence/saved-post-covers.json`. Full creation-flow parity remains outstanding.

### Multi-page photo enrichment deployed

Website research now enriches up to four same-host researched pages, retaining up to six photos per page and twenty distinct photos overall. Robots cache, request budget (48), total fetch window (60 seconds), cancellation checks, private-address protection, raster validation and byte/pixel limits are retained. A failed page does not discard successful pages. Fourteen contract tests and eighteen intake/storage integration tests passed; the latter prove persistence, replay without another mock provider charge, and tenant denial. A real public Runwal capture found eighteen distinct photos across homepage, company overview and ongoing projects, without AI calls. Worker deployed with verified image/scanner, Temporal pollers and database roles; evidence is `docs/evidence/multipage-website-photos.json`. This does not retrofit existing brands or select creative references automatically.

Next implementation gap: `PlanningInput` and the isolated skill runtime do not receive an approved reference catalog; `PlanningJobs` does not persist reference IDs on generated slots. Fixing this needs validated model selection from approved brand references, revocation checks and saved slot references—not random image assignment.

### Approved photo selection during planning

Implemented and deployed a bounded approved-reference catalog in campaign planning. Static slots may select up to three exact IDs; IDs from another brand, duplicated IDs, nonstatic selections and revoked selections are rejected. Planner database reads are scoped to the current job’s brand (migration 074); media storage keys are excluded from model input. Final selected IDs persist on slots and feed the existing campaign reference preview and generation input. Fourteen contract and twenty-three integration checks pass with mock paid providers. API and worker deployment succeeded, with exact runtime images and Temporal/database registration verified. Existing plans and unapproved website photos are not modified. A small duplicate-preview cleanup is undergoing browser verification separately.

### Workspace navigation and Home refinement

Moved the business switcher into the compact sidebar, replaced the topbar selector with contextual page title/welcome text, and added a profile avatar. Home now starts with upcoming posts instead of a large introductory hero. Campaign cards no longer repeat their selected reference below the main image. Expanded browser scenario passed (1/1): business selection, Home navigation, mobile menu, overflow, WCAG A/AA, existing campaign generation/review and persistence. Paid providers mocked. Web deployment 690527a0-9c3c-44fb-a10e-ee1dd7bfa26a is being verified.

### Brand Kit live inspection

Blaze defaults to Media Library, with a vertical inner navigation: Media Library, Brand Style, Brand Voice, Brand Profile, Source Materials. At a 989px viewport the media gallery is two columns with square images, short captions and used badges. Brand Style has Logo, Visual Style, Fonts, Colors and Visual Identity Description. Change visual style opens an almost full-width modal with four columns of portrait photo cards and a fixed Cancel / Confirm Selection footer. Font pairing opens the same modal frame with two columns of large live type samples. Title/body fonts and weight also have separate selectors on the style page. No preferences changed, no credits spent. Desvio still combines profile and style and needs this separation; simply copying controls without persisting their effect is not sufficient.

Workspace Web deployment 690527a0-9c3c-44fb-a10e-ee1dd7bfa26a confirmed SUCCESS. This ships the verified workspace refinement, not full product parity.

### Brand Kit sections and visual media library

Replaced the combined profile/style destination with Media Library (default), Brand Style, Brand Voice, Brand Profile and Source Materials. Existing brand findings and visual decisions remain backed by the same versioned API. Section navigation preserves the selected section on reload and retains the unsaved-edit guard. Documents and extraction remain accessible from Source Materials. Media shows private image tiles before opening approval controls, and approved references show compact previews automatically. The existing crop, approval and revocation endpoints remain in use. Four browser tests passed with actual local storage/scanner/backend and no paid AI: signup, manual brand setup, private upload/crop, and Brand Kit editing plus revoke/reapprove, desktop/mobile WCAG A/AA and overflow checks. TypeScript passed. Full photo-style/font-pairing management is still a separate gap. Deployment is being verified.

Brand Kit Web deployment e5630542-43bc-4b2f-9922-c13dd2389c2e confirmed SUCCESS; public web returned HTTP 200. Evidence: docs/evidence/brand-kit-sections.json.

### Campaign review connection recovery

Campaign review now retries transient read failures up to four times with backoff, retaining saved previews during refresh and stopping follow-up reads on navigation. Authentication/permission and other permanent errors remain explicit. No generation submission is retried. The focused browser journey passed (1/1), including an injected 503, automatic recovery, unchanged saved planning request count, existing generated previews and focused review, mobile overflow and WCAG A/AA. Paid providers were mocked. Web typecheck passed. Deployment c0c662cb-5488-4a1e-a425-ef2bc904f080 is being verified.

Campaign review recovery deployment c0c662cb-5488-4a1e-a425-ef2bc904f080 confirmed SUCCESS; public health returned HTTP 200. Evidence: docs/evidence/campaign-review-recovery.json.

### Visual brand typography and colors

Added real bundled DM Sans / DM Serif Display pairing previews to brand fact creation and editing, with saved typography samples and hex-color swatches. Values persist through the existing versioned brand-fact and approval endpoints, entering approved brand context. Four browser tests passed, including selection, correction, approval, reload, mobile overflow and WCAG A/AA; screenshot visually inspected. No paid providers called. Unknown font names remain text rather than displaying an unrelated substitute. Remaining integration: approved font facts do not yet select the default editable-layer font for non-campaign generation.

Visual brand style web deployment 28ff9788-ae78-412e-92b0-5012dec3416b confirmed SUCCESS. Evidence: docs/evidence/brand-style-previews.json.

### Approved brand fonts in generated artwork

Shared the visual picker catalog with the generation service. A recognized, unambiguous approved font pairing now sets new editable artwork font families unless the campaign explicitly overrides it. Image edits preserve prior layouts/fonts. Unknown or conflicting font facts do not become renderer configuration. Seven contract tests and seventeen creative integration tests passed with mocked paid providers and real local services. Editable-layer font weights remain unsupported by the current design schema. Worker rollout pending.

Approved brand font worker rollout passed at 2026-10-26T08:05:05.763Z. Exact image sha256:0046cdbfdbfd81d04b6d859dcc7484b60aa24ebf2fb51e38ced335af545b8e60 is running with genuine workflow/activity pollers and verified DB roles. Previous worker retained for rollback; no paid calls made. Evidence: docs/evidence/brand-font-generation.json.

### Content Preferences — live reference inspection, 26 October

Inspected the existing Blaze account without changing its settings or spending credits. The page uses one narrow content column, section headings and dividers, compact labelled controls, and a persistent workspace sidebar/header. Content Guidelines contains language, excluded words, market locations, target audience age/gender, representation age/gender/ethnicity and a collapsed detail area. Content Modification offers four radio choices from growth-focused through strict brand control. Video Preferences has music, narration and caption switches. Default Call-to-Action has copy and URL fields; Smart Captions has a switch and channel-specific style choices. Current account selection is Balanced; inspection did not change it.

Desvio currently persists goal, success target, three supported channels, cadence, timezone and avoided topics. The additional reference controls are not yet implemented end to end. They must affect saved planning/generation context before being presented as working choices. Visual similarity alone is not completion evidence.

### 2026-10-26 live archive inspection
Read-only navigation from Files & Projects → Archived Posts opened `/workspaces/1033658/archive`. The empty state is centered in a white workspace under the compact header: “No archived posts yet”; it explicitly includes previous versions of regenerated posts and deleted posts. Thus parity needs retained historical post versions plus recoverable deletion, not simply a filter for canceled publishing jobs. This workspace had no archived examples to inspect; restoration and populated-grid behavior remain unverified. No account content changed.

### 2026-10-26 live strategy and growth inspection
Create New has three entries: Post, Campaign, Add Strategy. Add Strategy opens a large visual dialog separating Active Strategies from recommended strategies. This account shows active Lifestyle Content with a start date, illustration and explanation. Recommended Offer & Promotion, Product Education, and Problem/Solution each show a short purpose, recommendation reason, imagery and a Launch now action priced at 64 credits. No launch was clicked.

Change Growth Settings opens two independent radio groups. Introduction cadence: Aggressive (every 2 weeks), Moderate (3 weeks), Conservative (4 weeks), Manual; current Manual. Growth within a strategy: Competitive (+2 weekly posts per month, 40 credits), Smart (+1 weekly post per month, 20 credits), Flat; current Flat. The screen states a ceiling of 2 posts/day and 15/week. Save remains disabled without changes. Canceled without changing preferences. Blaze's percentage-growth marketing claims are observed copy, not verified outcomes and not appropriate Desvio promises. Desvio needs persisted strategy grouping, scheduling limits and explicit credit/spending behavior before exposing equivalent launch controls.

## 2026-10-26 fresh read-only reference observations

- Home Create New opens three visual choices: Post (single post added to campaign), Campaign (themed date range), Add Strategy (campaign group around goal).
- Add Strategies is a large image-led modal: Active Strategies followed by recommended visual banner cards. Observed Lifestyle Content active, Offer & Promotion, Product Education, Problem/Solution recommendations. Each proposed strategy has an individual Launch now credit amount. No launch performed and no credits spent.
- Change Growth Settings opens two radio groups: introduction cadence (every 2/3/4 weeks or Manual), and within-strategy weekly post increases (+2/month, +1/month, or Flat). Current account Manual + Flat. Cancelled without saving. Do not copy unsupported percentage-growth marketing claims into Desvio.
- Archive empty state explicitly includes previous versions of regenerated posts and deleted posts. Global discoverability of prior versions is required in addition to per-project version history.
