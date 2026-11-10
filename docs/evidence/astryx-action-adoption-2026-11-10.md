# Astryx action adoption, 2026-11-10

## Change
Adopted the installed Astryx 0.7.11 Button through the shared ActionButton adapter for 61 additional actions in 12 components: businesses/navigation, team, connections, publishing, campaign reviews, uploads, brand references, blog articles, campaign images, campaign posts, carousel composition, and the image text editor.

Retained existing event handlers, form submission types, permission checks, disabled conditions, confirmation steps, and data mutations. The navigation toggle now explicitly uses type=button. Added an explicit responsive display rule so shared button styling cannot expose mobile navigation on desktop.

Specialized selectors, canvas manipulation, and complex choice controls retain their existing accessible implementations. This is not a claim that every control now comes from Astryx.

## Verification
- Production build passed.
- Existing browser suite: 16 tests passed initially; navigation test caught desktop Menu visibility. Fixed that regression.
- Updated the empty-status assertion to check all visible empty status elements, since multiple Astryx buttons now exist.
- Navigation, keyboard, reduced motion, History dialog, 320px and 390px test passed after correction.
- All 17 tests also passed together on the final production build after the correction. API fixtures cover saving/restoring articles, ambiguous generation recovery without duplicate submission, permissions, selectors, form payloads, integration error recovery, image previews, progress, and suggestions.
- Read-only actual-account layout audit: 16 routes at desktop/mobile, 32 views, no horizontal overflow. Screenshot review included integrations desktop and article editor mobile.
- No live publishing, invitations, or paid generation was performed for this component migration. Existing provider integration status is not upgraded by UI fixture tests.

## Limits
This verifies the changed component behavior and covered layouts. It does not establish every external provider journey or every possible viewport as production-ready.

## Dev release
- Code commit: 3e6e65d, pushed to dev.
- Railway web deployment 7ab07774-ccb5-4a48-88f0-4b037d549ae5 observed SUCCESS.
- Hosted browser checks: 9/9 passed for navigation, article save/restore/generation recovery, permissions, New Post, integration feedback, team selectors, and content preferences. These use intercepted API fixtures on the actual hosted frontend, not real provider mutations.
