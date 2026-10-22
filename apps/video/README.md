# Isolated video rendering stage

`runtime.py` validates and normalizes one untrusted MP4, optionally composing up to three timed top/bottom text overlays. It returns canonical H.264/AAC MP4 bytes, PNG poster, source/output hashes and the overlay recipe. It does not approve a creative or publish anything.

The service uses pinned FFmpeg **7.1.5-0+deb13u1** and exact ARM64 Debian archive hashes in `debian-arm64-packages.json`. `scripts/video-runtime-image.mjs` builds an immutable child of the pinned Python base. It verifies and extracts all dependencies without package scripts and builds with networking disabled. Runtime and dependencies are baked into the image. `scripts/fetch-document-deps.py video` acquires missing exact packages through signed Debian APT; unavailable versions fail rather than silently upgrading.

`apps/api/src/video-renderer.ts` runs an exact image digest without host mounts, network or application credentials, as UID 65534 with a read-only filesystem, dropped capabilities and bounded memory, CPU, processes, input/output and ephemeral storage. It validates decoded poster bytes, clip hashes/metadata and exact overlay provenance before returning them to its caller. ARM64 local proof is not AMD64/Railway deployment proof.

Text is written to code-owned UTF-8 files and rendered with fixed Liberation Sans, literal expansion disabled, validated colors and generated numeric timing expressions. Text wrapping and top/bottom layout are bounded; unsupported layouts fail explicitly. This is not a general timeline editor, arbitrary-font system or proof of broad language typography. Audio from the input is preserved when supported; music licensing/mixing is not implemented.

`make verify-video-runtime` executes original video skills with MOCK model responses, tests actual native decoding/overlays against synthetic clips, measures rendered pixels across overlay time boundaries, and exercises the Node adapter against the baked image. These are genuine media operations, not provider output-quality tests.

The Debian FFmpeg build enables GPL components including libx264. Copyright/license notices are preserved. Distribution/source obligations, vulnerability acceptance and cloud image/runtime acceptance remain release work.

Next: approved-reference leases, the parent generation workflow, immutable private video/poster records and revision lineage, exact-output review, Canvas controls, and authorized live Higgsfield acceptance. Preserve a clean immutable base clip for text-only re-renders; never repeatedly bake edits into an already composited source.
