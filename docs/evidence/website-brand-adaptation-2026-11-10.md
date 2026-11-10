# Website branding adaptation

Source: user-supplied `DESVIO-Netlify-2026-10-20.zip`, specifically its bundled CSS, `brand/desvio-black-lime.svg`, favicon, and locally bundled typefaces.

## Scope

Adopt the website's ivory (#f4f0e7), charcoal (#161713), lime (#d9ff65), Space Grotesk headings, DM Sans body type, and supplied vector wordmark across the authenticated app, sign-in, onboarding, and chat canvas. Use a darker olive for small links/focus indicators so lime is not used as low-contrast text on white. Shared controls retain existing keyboard behavior, dimensions, validation and service calls. Font licenses are included with the local assets.

Presentation literals in existing styles now reference common brand tokens. Astryx semantic tokens share the same identity. Customer artwork, export font definitions, saved brand palettes, provider payloads, permissions, and API implementation are not changed.

## Validation

- Production Next build and web TypeScript check passed.
- 18 browser regression tests passed in both branding builds, including selectors, mobile menus, dialogs, permissions feedback, prompt suggestions, creative brief saving, thumbnail behavior, and generation progress recovery. APIs in these tests are fixtures; they do not verify external generation.
- Read-only authenticated page audit: 16 routes at 1440px and 390px, no horizontal overflow. Visual inspection covered home, chat and team/mobile. Final read-only audit also passed all 32 views without horizontal overflow. New Post dialog was visually inspected; remaining lavender reference/idea surfaces were changed to the shared ivory field token.
- No database migration, account changes, paid generation, or publishing is part of this change.

## Limits

This adapts the website's identity to product layouts; it does not copy marketing pages or replace functional workflows. Existing generated artwork retains its original colors and typography. Historical creative text quality is a separate data/rendering concern.

## Deployment

Dev web deployment `83754864-94aa-466c-99e5-b635e236a3d0` reached SUCCESS. Authenticated hosted verification passed on home, chat, team and content preferences at 1440px and 390px (8 views), including logo loading, shared palette and overflow. See `website-brand-live-2026-11-10.json`.
