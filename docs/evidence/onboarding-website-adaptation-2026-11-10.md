# Website onboarding adaptation

Source: user-supplied DESVIO-Netlify-2026-10-20.zip, static enquiry form and creative direction examples. Inspected as reference content; no supplied scripts executed.

## Implemented

- Existing business name/website and goal/success/avoid questions remain connected to onboarding.
- Added optional market, language, launch timing and visual-direction questionnaire to onboarding and Content Preferences.
- Imported 16 compact 480px WebP direction examples with descriptive labels and an editable direction. These are explicitly inspiration, not generated business assets or approved brand facts.
- Persisted bounded `creative_brief` JSON in tenant-scoped business onboarding, retaining revision conflict checks, old-client compatibility and existing access rules.
- Pass preferences into content planning and chat context. Latest chat requests can override preferences; preferences do not authorize publishing or establish factual claims.
- Reused existing profile name/email rather than collecting duplicate contact details. Excluded draft plan prices, free-preview promises and fictional campaign references from the marketing site.

## Validation

- API TypeScript build and production web build passed.
- Two contract tests passed for validation and chat prompt context.
- Isolated PostgreSQL migration replay and questionnaire persistence test passed: save/read/clear, omitted field compatibility, stale revision, invalid size and unrelated account denial.
- Three browser fixture tests passed: questionnaire save/reload, existing single/multi selectors, keyboard interactions, accessibility scan, 320px and 390px layout. Preview image loading verified separately. Browser fixtures do not prove live generation.
- Broad intake runner initially blocked by unavailable pinned document-parser packages. Focused `--creative-brief` suite avoids unrelated document dependencies.

## Location

New business onboarding, final direction step, and Content Preferences > Your creative brief. New answers affect future work, not existing creatives. No paid generation or publishing was performed for this change.
