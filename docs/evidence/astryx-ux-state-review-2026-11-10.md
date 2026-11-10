# Astryx UX state review

Reference: installed `@astryxdesign/core` 0.7.11 Button and Spinner documentation, and https://github.com/meta/astryx. Desvio retains its brand typography and colors; Astryx is a component system, not a pixel-exact application page specification.

## Implemented

- Integration actions use the shared Astryx Button with real pending feedback naming the selected platform.
- Disabled actions retain readable foreground/background contrast throughout the application shell, creation workspace and authentication views.
- Integration cards use shared spacing/radius tokens and align actions consistently.
- View-only users receive an explicit permissions explanation.
- Failed initial account loading offers a retry. View-only status refresh performs a read, not a management request.
- Existing selectors, dialogs, form layout and loading components remain connected to their original persistence and authorization flows.

## Verification

Production build passes. Sixteen existing browser regression tests passed across campaign/blog editing, denied actions, uncertain generation recovery, selectors, dialogs, prompt suggestions, preview loading, generation progress and connection callbacks. A new connection-feedback test passes with controlled API responses, covering pending action feedback, disabled styling, error recovery, single submission, view-only explanation and 390/768/1440 viewport overflow.

These tests do not connect external social accounts, publish posts or prove every possible customer journey. Real-account page layout audit and deployment results are appended after completion.
