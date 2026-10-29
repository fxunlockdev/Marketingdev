# Private image loading follow-up

The user's screenshot showed loading placeholders in both campaign cards and the post editor. Direct authenticated reads confirmed all five saved campaign images still existed and passed byte/hash/image-decode checks. The exact network condition in the user's browser could not be reconstructed from the screenshot.

Verified weaknesses fixed:
- Storage downloads previously had no deadline. Campaign thumbnails, the editor and final-image review now use a shared bounded loader, with one fresh authenticated grant/retry after failure.
- Image type, byte count, maximum size and supplied SHA-256 remain validated. Signed URLs and private bytes are not persisted or logged.
- Font loading no longer prevents the editor photo from rendering.
- Failed thumbnails retry when the browser comes back online or regains focus. The editor retains its explicit Reload image action.
- Brand reference downloads now have a deadline.
- Drawer dimensions and long campaign text are constrained to the viewport, with spacing before the creative.

Validation: production build; TypeScript; five loader assertions; browser transient-storage-failure recovery; repeated failure exposes Reload image and then recovers; rendered canvas contains 9,288 sampled colors rather than a blank surface; drawer overflow checks at 1280, 924 and 390 pixels; unsaved-edit close protection retained. Fault injection was limited to read-only local preview requests using actual saved media, with all business mutations blocked.

Task evidence: work/private-image-recovery-evidence.json, work/private-image-reload-evidence.json and their screenshots. Live verification is separate from injected-failure verification. No paid generation or publication was run for this fix.
