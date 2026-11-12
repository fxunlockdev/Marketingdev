# Isolated video rendering stage

`runtime.py` validates and normalizes one untrusted MP4, optionally composing up to three timed top/bottom text overlays. It returns canonical H.264/AAC MP4 bytes, PNG poster, source/output hashes and the overlay recipe. It does not approve a creative or publish anything.

Encoding keeps quality: the source frame rate is kept (1-60 fps), H.264 high profile at CRF 17, preset medium, level 4.2, peak bitrate bounded (25 Mbit/s), yuv420p, faststart. Frames are only scaled when the requested final format needs it (or above the 1920x1080 envelope). Final formats: 1024x1024, 1024x1536, 1536x1024, 1080x1920, 1024x1280 and 1080x1350 (4:5 export). `tests/runtime/video-media.py` compares output with source for resolution, frame rate, bitrate and SSIM.

Reel mode (`{"version":2,"mode":"reel",...}`) joins one to five canonical shot clips with hard cuts at the output size, burns in script captions (Liberation Sans or Serif Bold, chosen from the brand font; a larger, opaque style for the one legibility re-render), keeps up to three overlays, appends an end card (brand name and call to action in brand colours) and lays a silent stereo bed. Music and voiceover are a seam: `audio` accepts only `{"bed":"silence"}` until a licensed, code-owned asset exists; no caller-supplied audio or URL is ever accepted. It returns sampled PNG frames for vision QA. The logo is not yet drawn on the end card.

The service uses pinned FFmpeg **7.1.5-0+deb13u1** and exact ARM64 Debian archive hashes in `debian-arm64-packages.json`. `scripts/video-runtime-image.mjs` builds an immutable child of the pinned Python base. It verifies and extracts all dependencies without package scripts and builds with networking disabled. Runtime and dependencies are baked into the image. `scripts/fetch-document-deps.py video` acquires missing exact packages through signed Debian APT; unavailable versions fail rather than silently upgrading.

`apps/api/src/video-renderer.ts` runs an exact image digest without host mounts, network or application credentials, as UID 65534 with a read-only filesystem, dropped capabilities and bounded memory, CPU, processes, input/output and ephemeral storage. It validates decoded poster bytes, clip hashes/metadata and exact overlay provenance before returning them to its caller. ARM64 local proof is not AMD64/Railway deployment proof.

Text is written to code-owned UTF-8 files and rendered with fixed Liberation Sans, literal expansion disabled, validated colors and generated numeric timing expressions. Text wrapping and top/bottom layout are bounded; unsupported layouts fail explicitly. This is not a general timeline editor, arbitrary-font system or proof of broad language typography. Audio from the input is preserved when supported; music licensing/mixing is not implemented.

`make verify-video-runtime` executes original video skills with MOCK model responses, tests actual native decoding/overlays against synthetic clips, measures rendered pixels across overlay time boundaries, and exercises the Node adapter against the baked image. These are genuine media operations, not provider output-quality tests.

The Debian FFmpeg build enables GPL components including libx264. Copyright/license notices are preserved. Distribution/source obligations, vulnerability acceptance and cloud image/runtime acceptance remain release work.

Next: approved-reference leases, the parent generation workflow, immutable private video/poster records and revision lineage, exact-output review, Canvas controls, and authorized live Higgsfield acceptance. Preserve a clean immutable base clip for text-only re-renders; never repeatedly bake edits into an already composited source.
