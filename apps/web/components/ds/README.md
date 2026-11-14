# Desvio design system (`components/ds`)

The shared components for the Apple-style redesign. Read `button.tsx` + `button.module.css`,
`card.tsx` + `card.module.css` and `materials.module.css` first: they are the reference pattern.

## Hard rules

1. **Tokens only.** Every value comes from `apps/web/app/tokens.css` (section "Design system v2"
   plus the brand palette above it). No hex, no rgb(), no one-off px for spacing/radius/type/shadow/
   duration. Hairline `1px`/`2px` borders, `50%`, `1em`-relative icon sizes and `0` are fine.
   `node scripts/check-ui-tokens.mjs` must still pass (it fails on any hex, `!important`, `outline: none`).
2. **Palette is fixed.** Only `--brand-*`, `--status-*` and the derived tints (`--ink-a*`, `--paper-a*`,
   `--surface-a*`, `--accent-a*`, `--link-a*`). Use `color-mix(in srgb, <token> N%, transparent)` for a new tint.
3. **Motion = transform + opacity only** (clip-path allowed for reveals). Never animate colour, shadow,
   width, height, top/left, margin or padding. Hover brightening is a tint pseudo-element whose
   *opacity* animates; hover lift is a shadow pseudo-element whose *opacity* animates (see button).
   - Things the user touches: `var(--spring-snappy)` (press, lift) or `var(--spring-bouncy)` (thumbs, pills).
   - Everything else: `var(--ease-out)`. Durations: `--motion-instant|fast|base|slow` (90/160/240/400ms).
   - Popups scale + fade from their trigger: Base UI sets `--transform-origin` on popups; use
     `[data-starting-style]` / `[data-ending-style]` for enter/exit.
   - Always add `@media (prefers-reduced-motion: reduce)` → no transform; fade only or instant.
4. **Glass only on floating layers** (menus, popovers, modals, toasts, sidebar, bars). Use
   `composes: glassThin|glassRegular|glassThick|glassDark from './materials.module.css'` (only valid
   inside a plain single-class rule like `.popup { composes: … }`), or add the class in TSX with
   `glass(tier)` from `./materials`. Set `--glass-shadow: var(--elevation-N)`. Content surfaces stay solid. Text on glass must pass WCAG AA.
5. **States on every interactive element:** default, hover, focus-visible, pressed, disabled, loading
   (where it applies). Focus is always
   `outline: var(--focus-width) solid var(--focus-color); outline-offset: var(--focus-offset);`
   (`--focus-color-on-dark` on ink/dark glass). Never remove an outline without replacing it.
6. **Accessibility:** 44px minimum hit target (visual 36px is fine with an extended hit area), full
   keyboard support, correct roles/labels, `forced-colors` border fallback where a surface has no border.
7. **Overlays and complex widgets are built on `@base-ui/react` 1.9** (already installed, unstyled,
   accessible): `dialog`, `popover`, `tooltip`, `toast`, `select`, `switch`, `checkbox`, `tabs`,
   `collapsible`, `menu`, `field`, `input`. Read the `.d.ts` in `node_modules/@base-ui/react/<part>/`
   to confirm the API before using it. Do not add dependencies.
8. **CSS Modules**, one `<name>.module.css` per component, camelCase class names, state via
   `data-*` attributes (Base UI's `data-*` or our own). Files stay under 400 lines.
9. **TypeScript:** named exports, explicit prop interfaces, no `any`, no `React.FC`, no default exports.
   Client components start with `"use client";`. Use `cx` from `./cx`.
10. **Legacy bleed:** old global stylesheets style bare elements (`button`, `input`, `h1–h3`, `a`,
    `dialog`, `summary`, `table`). Always set every property that matters on your own class
    (font, color, background, border, border-radius, margin, padding, appearance) so nothing leaks in.

## Type ramp

`font: var(--text-display|title|heading|subheading|body|callout|caption|micro)` with the matching
`letter-spacing: var(--tracking-display|title|heading|body|micro)`. Micro text is uppercase.

## Radius

`--radius-xs` 6 (checkbox) · `sm` 8 (menu items, small chips) · `md` 12 (inputs) · `lg` 16 (popovers,
compact cards) · `xl` 22 (cards, modals) · `2xl` 28 (sidebar, shell panels) · `full` (buttons, badges).
Nested corners step down one level.

## Elevation

`--elevation-1` resting card · `2` hover/raised · `3` popovers, menus, toasts · `4` modals.
`--hairline` is the 1px edge for solid surfaces.
