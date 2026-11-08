# Desvio interaction design

The supplied Desvio prototype remains the visual reference: lavender workspace, white rounded panels, editorial DM Serif headings, DM Sans controls, black primary actions and pastel creation cards. Agentation is a review aid, not a replacement design system.

## Motion and controls

- Button presses respond immediately with a 120ms, 2% compression. No animation delays an operation.
- Creation cards and links to creative surfaces lift 2px on a precise pointer. Navigation and forms stay anchored.
- Dialogs enter over 180ms with a 6px translation and opacity. Recurring polling does not replay entrance animations on content.
- Reduced motion removes translation and scaling. Keyboard focus remains visible without motion.
- Keep controls in their existing action hierarchy. Destructive actions remain red; disabled actions do not gain hover or press feedback.
- Generation progress continues to use real job state. Decorative motion never invents completion percentages.

Shared chrome refinements live in `apps/web/app/product-polish.css`. These rules do not change artwork coordinates, text fonts in generated images, export dimensions, providers, approvals or persistence. Component geometry stays scoped. Home card styling stays in its CSS module.

## Layout

- Use 20px between substantial panels, 16px inside card groups, 12px between actions and 8px between compact chips.
- Desktop navigation scrolls independently, keeping the business switcher and account actions reachable.
- Creation cards have clearance below the header. Mobile shortcuts use the available width without the desktop avatar indentation.
- Media cards use readable titles and contained previews. Calendar controls retain a 40px target.
- Recent conversation titles truncate at the end; their full accessible name is preserved.

## Local visual review with Agentation

Start the development server with `DESVIO_DESIGN_REVIEW=true npm run dev:web`. The toolbar is mounted only when both development mode and this explicit flag are present. Click **Start feedback mode**, select an element, write the observation, and choose **Add**, then **Copy feedback**. Attach the copied selector, component context and observation to the implementation task.

No endpoint or webhook is configured. Annotations stay in the browser unless the reviewer explicitly copies them. Keyboard shortcuts are disabled to avoid conflicting with the canvas. Do not add credentials or sensitive user content to annotations. Agentation is absent from the production interface, even if the environment flag is set.

The pinned package and its license are recorded in `THIRD_PARTY_NOTICES.md`. An actual captured review is in `agentation-review-2026-11-08.md`.

## Verification

Use the production build for final CSS-order checks. Run `tests/browser/design-polish.test.mjs` with `DESVIO_UI_BASE` pointed at that build and `DESVIO_EXPECT_PRODUCTION=1`. It checks title truncation, card clearance, hover/reduced motion, keyboard dialog focus and restoration, mobile bounds, and no content submission from review interactions. Run the existing prompt-suggestions browser journey as a regression check.

Inspect Home, chat/canvas, campaigns, Calendar, Approvals, Brand Kit, preferences, Integrations, Learnings, Insights, archive, Team, brands, Profile and Billing at desktop and mobile sizes. Read-only page review does not certify paid generation or external publishing workflows.
