# Packaged video renderer and timed overlays

Status: local implementation verified at `3271363`; video-runtime (22), offline (4) and contracts (74) pass at matching unchanged source. Full security/browser regression remains pending for the connected workflow. No customer video enablement or live provider claim.

The existing normalization stage depended on test-only host mounts and discarded the timed overlays produced by the video skill. It now builds into an exact ARM64 image and composes the bounded caption/CTA recipe. The Node adapter supplies bytes over stdin and validates the returned source hash, image digest, video/poster hashes, dimensions, duration, MIME and exact recipe. Runtime has no network, credentials or host application mounts.

The official [FFmpeg filter documentation](https://www.ffmpeg.org/ffmpeg-filters.html) specifies literal `expansion=none`, text-file input and timeline enable expressions. Those contracts are exercised against the pinned 7.1.5 binary. Untrusted text is never interpolated into a filter string. Only validated colors/times and code-owned paths enter expressions. Font selection is fixed; long text wraps within bounded layouts or fails explicitly.

Tests decode actual output frames before, during and after an overlay, check literal punctuation/expansion-like text, reject malformed and overlapping timelines, and verify exact repeat-output hashes through the Node adapter. Existing codec/orientation/HDR/truncated-media/network/secret restrictions remain covered.

This is a building block for the original Higgsfield pipeline, not its replacement. Private approved reference leases, parent jobs, durable media/version persistence, revision/approval controls and customer video UI remain unfinished. Cloud architecture/runtime acceptance, broader typography, multi-scene/audio/logo composition and live output quality also remain open. The preserved unfinished reference work is still in stash ca2651e8fa72b25ed1d30458e9f8fb043a20e46a and must be reconciled with current migrations before use.
