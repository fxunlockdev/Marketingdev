# Chat start menu

The chat start screen follows the supplied Create Chat prototype and the November 1 start-menu screenshot: lavender Post, yellow Campaign and green Add strategy cards; Make content shortcuts; and Get things done shortcuts. The original AI chat entry point had substituted five plain buttons and omitted the management shortcuts.

Creation shortcuts prepare a message for the user to complete, without submitting an incomplete paid request. Carousel and Add strategy enter the existing guided flows. Management shortcuts open the existing business-scoped screens: approvals, calendar/publishing workflow, integrations, brand profile, content preferences, team, new business, and insights. Existing unsaved-change navigation protection applies.

History remains available through a compact labeled clock button in the header. The initial menu begins at the top, including on smaller screens; conversations continue following new messages. The existing saved-image attachments and immutable version history are unchanged.

## Verification

- Authenticated browser exercise: all 16 actions and History, with read-only access to the dev backend.
- Layout review at 1041 × 743 (reference logical size), 1440 × 1000 and 390 × 844; no horizontal overflow or browser errors.
- Screenshot comparison against the supplied reference. The red annotations and reference scroll position are not product elements. Intentional differences: accessible History button, darker section labels, full Post card at the beginning of the menu, and scrolling on small screens.
- Isolated AI canvas regression uses mocked OpenAI and image generation; covers lost-response recovery, saved-image attachments, editing, reopening history and mobile layout. No live social publishing or paid generation is used for this change.

This is a start-screen correction, not a claim that every application screen is pixel-identical to the prototype.
