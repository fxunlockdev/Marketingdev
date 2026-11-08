# Shared selectors, 2026-11-08

Scope: all native dropdown field call sites in the web app now use a shared Desvio selector. Single-choice fields show a simple option list and close on selection. Multi-choice fields show checkbox rows and a selected count; selecting a row keeps the menu open. Business access, campaign channels and preferred channels use this multi-choice pattern. Time zones use the same surface with city/alias search. Consent checkboxes, switches, visual reference cards and navigation tabs keep their distinct semantics.

Implementation: pinned Base UI React 1.9.0 primitives provide keyboard navigation, focus restoration and positioning. Existing native select change handlers and form values remain connected. Disabled fieldsets and options are respected, including the current business that cannot be removed from invitation scope. Popups portal into a containing native dialog when present, otherwise the document body. Reduced-motion preferences are respected.

Validation:
- Web TypeScript check passed.
- Production web build passed.
- Ten focused Playwright tests passed: selectors (2), dialog layout (2), existing design polish (1), and blog editor/creation (5). The blog fixture was corrected to include the existing post-ideas response contract.
- Fixtures verified multi-choice add/remove, single-choice keyboard selection, Escape/focus restoration, role and business invitation payload, preferences save/reload, timezone city aliases and empty search, locked options, popup accessibility scan, reduced motion, and responsive widths down to 320px.
- Fixture submissions are intercepted; no real invitations, preferences changes, paid generation or publication occurred.
- Authenticated read-only UI audit: 42 open menus across chat creation options, New Post, Team, Content Preferences, Brand Kit, Calendar and Approvals at 1440px and 390px. All popup bounds stayed inside the viewport. See local-menus.json. This is selector UI verification, not a fresh media-generation or publishing integration claim.

No backend, database, authorization, provider or billing configuration changed.

Regression test maintenance: native select interactions in the larger canvas, customer, publishing and connection suites now go through the visible shared control. Their source syntax was checked; those full service-backed suites were not rerun for this UI release.
