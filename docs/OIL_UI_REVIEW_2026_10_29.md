# Oil UI review — 29 October 2026

## Direction
Preserve the supplied redesign: lavender workspace, white rounded panels, black active navigation and primary actions, serif display headings, and actual campaign media. Preserve existing generation, upload, ideas, scheduling and approval handlers.

## Corrections
- New Post has a fixed header/footer and a scrollable body. Format, channel and posting time share a compact aligned row; mobile uses a responsive arrangement. Create Post remains visible in short windows.
- Scoped the campaign-header button rule so it cannot turn the modal primary action white.
- Removed duplicate ideas/loading explanation; retained errors, context and reference controls.
- Calendar moves plan activity into options, reduces redundant helper text and highlights today in the business timezone.
- Brand Kit has its page heading, rounded navigation with black active state and a unified media grid. Approval controls remain available.
- Preferences and Insights follow the supplied heading, panel and metric-card treatment, using real values.
- Send for review follows the final creative. Revise creative is secondary when a creative already exists. Completed campaigns no longer imply generation is still running.

## Review and checks
One independent visual review and one independent interaction walkthrough. Findings above were corrected. No numerical quality score was assigned. Existing motion was retained; no new animation was introduced.

Production build and type checks passed. Eight routes were checked at desktop and mobile widths, with no horizontal overflow or page JavaScript errors. Composer checks cover 1440×900, 1280×720, 924×540, 390×700 and 390×500; failure preserves the topic and context. Drawer checks cover three widths, Escape and the unsaved-edit guard. Calendar and Brand Kit were also checked at 924, 1440 and 390 pixels.

Evidence lives in the ignored task work directory: `oil-composer-evidence.json`, `oil-brand-calendar-evidence.json`, `redesign-ui-evidence.json`, `drawer-reference-evidence.json`, associated screenshots and `oil-review/brief.md`.

## Limits
This is a UI correction pass, not a claim that every one of the 24 reference screens or every external-provider workflow is verified. No new paid image/video generation or social publication was performed in this review. Local preview requests used real saved data with write operations blocked; idea requests reused cached results. Deployment verification is recorded separately in the task work directory.
