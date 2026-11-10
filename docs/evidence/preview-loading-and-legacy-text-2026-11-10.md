# Home preview loading and legacy draft text

## Verified cause

Authenticated dev overview returned in 340 ms. The two available image previews were 50,746 and 56,840 bytes and returned in 410–549 ms on the first measured pass, 434–445 ms on the second. Full authenticated navigation to the first image was 3,026 ms in a separate check. These are observations from this connection, not a latency guarantee.

The upcoming carousel had state `content_needed`, no carousel version, no design and no generation job. It was not waiting for an image download.

The two upcoming static drafts had saved Arial layers with low-contrast colors, no backing and small footer copy. These were old editable overlays, not text newly invented by the thumbnail renderer. Current generation defaults already use readable headline backing and omit footer copy.

## Changes

- Begin fetching the first four home previews immediately, independent of visibility callbacks. Remaining thumbnails retain lazy loading.
- Coalesce concurrent requests for the same private preview. Cancelling one consumer does not cancel another; cancelling all consumers aborts the transfer. Completed responses are not retained, and access denial cannot fall back to originals.
- Explain uncreated images, videos and carousels explicitly, and expose a format-specific create action on untouched home ideas.
- Keep internal additional-direction text out of fallback home card titles.
- Saved clean, text-free versions of the two affected unapproved drafts through authenticated APIs. Original photos and post captions were retained. Previous creative versions remain in history. Slot attachment used revision checks. No generation, approval or publishing occurred.

## Validation

- Web TypeScript check passed.
- Production web build passed.
- Private image and preview loader tests: 12 passed, covering denial, recovery, size/type/integrity, concurrent consumers and cancellation.
- Production browser regression: passed. Confirms first-row fetch without visibility callbacks, one concurrent fetch for duplicate cards, saved overlays preserved when intentionally present, explicit empty carousel and reauthentication on page reload.
- Live read-back confirmed both repaired slots have zero image text layers, unchanged captions and media, and preserved previous versions.

Deployment and hosted verification are recorded after release.
