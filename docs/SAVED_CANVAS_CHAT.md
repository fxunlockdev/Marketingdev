# Saved canvas artwork in chat

Saving a manual creative version adds an immutable image preview to its linked conversation, in chronological order. The preview uses the saved design, including fonts, curve, backing and position; it is not just the background image. It remains available after reload and through History. Later saves add new previews without modifying earlier ones.

The conversation reader authorizes ownership before selecting manual versions from projects attached to that conversation. Version IDs are attachment IDs. Existing save idempotency (parent, design/caption hash and actor) also deduplicates attachments after ambiguous network responses. No image generation or second message write is required. A failed save without a committed version adds nothing. Saves update the conversation's last activity in the same transaction.

The client refreshes the conversation after a successful save, with existing polling recovering a lost acknowledgement. Immutable previews are memoized, and offscreen Fabric canvases are released to limit memory use in longer histories. Existing manual versions also appear when their conversation is reopened. These changes apply to conversation-linked creatives; unrelated projects are not attached to an arbitrary chat.

Validation: API and web type checks; isolated browser flow with real persistence and rendering and mocked external generation. The browser test drops a committed save response, retries, verifies one attachment, reloads it, checks curved text persistence and PNG download, adds another version and verifies the first attachment is unchanged, then continues the AI conversation. Desktop and mobile overflow checks remain part of that flow.
