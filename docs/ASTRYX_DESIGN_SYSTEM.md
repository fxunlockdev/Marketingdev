# Astryx in Desvio

Desvio uses Astryx 0.7.11 for its theme boundary, shared action buttons and loading indicator. The prebuilt neutral theme and component CSS are imported once in the root layout. StyleX 0.19.0 is pinned alongside it. The upstream MIT notice is served at `/licenses/astryx.txt`.

The visual identity remains Desvio: local Sans/Serif fonts, ink primary actions, violet focus and selection, soft neutral surfaces, and pastel creation cards. `apps/web/app/design-system.css` maps Astryx variables to that identity and defines shared field, panel and spacing tokens.

## Component boundaries

- `DesignSystem` installs the prebuilt theme without runtime style generation.
- `ActionButton` preserves existing form submission, disabled states, accessible names and event handlers. It adopts Astryx interaction feedback. Explicit `isLoading` is used for post creation and video submission.
- `Loading` uses Astryx Spinner with one announced status. Empty button live regions are hidden until they have content.
- Existing Base UI single/multiple selectors retain their keyboard model, portals, search, checked options and native form values. There is one selection implementation, not two competing dropdown systems.
- Domain controls such as calendar navigation, artwork layers, chat choices and mobile navigation retain their existing behavior and scoped styles.

## Scope

Shared controls were applied to campaign creation, post creation, business/onboarding and Brand Kit actions, team, profile, content preferences, integrations, archive, lessons, creative export and chat video setup. Shared spacing also covers page headers, settings panels, empty states, chat action groups and form hints. Creation cards explicitly preserve the supplied lavender/yellow/green hierarchy.

## Validation and limits

Production web build and TypeScript pass. Browser fixtures verify form payloads, role restrictions, save/restore, disabled actions, dropdown keyboard interaction, modal containment, reduced motion, mobile navigation and chat history. Screenshots cover 11 authenticated read-only pages at 1440px and 390px, with no document or dialog overflow. New Post is additionally checked at tablet, 320px and short desktop heights.

Mocked provider responses in UI tests validate interface behavior, not new paid image/video output. No customer content is generated, approved or published by the visual audit. Provider integrations and export renderers were not changed by this UI release.
