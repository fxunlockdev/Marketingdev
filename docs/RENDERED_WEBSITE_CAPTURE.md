# Self-hosted rendered website capture

Status: implemented locally; disabled until a tested immutable renderer image is supplied. No paid capture provider or external generation calls are used by this renderer. The existing GPT research and later brand analysis retain their own allowance and durable call controls.

The current direct HTML parser cannot execute website JavaScript. `RenderedWebsiteResearch` composes the current research/photo capture with `WebsiteRenderer` when evidence is absent or no usable photographs were found. Failed supplemental rendering preserves already useful research with a visual-error record. An unknown GPT submission never launches another research or rendered fallback. Cancellation propagates.

## Configuration and wiring

The renderer accepts only an immutable `sha256:<64 hex>` local Docker image. A missing/invalid digest is not configured. No image is pulled from caller input and no customer route exposes the image setting. Operator activation must build/import and validate the image before providing `WEBSITE_RENDER_IMAGE` through the existing trusted worker controls.

Worker construction after validation:

```ts
new RenderedWebsiteResearch(
  new OpenAIWebsiteResearch(process.env.OPENAI_API_KEY, undefined, new WebsitePhotos()),
  new WebsiteRenderer(process.env.WEBSITE_RENDER_IMAGE),
)
```

Worker configuration, fingerprints and activation allowlists now support the validated optional image. The deployed inventory has not been changed. Setting a string alone is not live verification. Existing Maxun paid fallback stays unactivated and separately gated.

## Execution boundary

A dedicated ephemeral Chromium container runs as uid65534 with network none, dropped capabilities, no-new-privileges, read-only root, finite memory/CPU/PIDs, bounded tmpfs and a 50-second parent timeout. It receives no credentials, Docker socket, business documents or host mounts. Site scripts cannot access the worker's network.

The fixed runtime intercepts resource requests and exchanges JSON lines with the parent. The parent accepts only bounded GET resources, checks every public DNS answer and pins the connection via SafeWeb, reads robots, constrains document/API origins, rejects foreign redirects, filters MIME, and strips cookies/auth headers. Passive public CDN resources may load through the same checks. Aggregate resource caps are80 requests/20MiB/45seconds, and IPC output is limited12MiB. Service workers, WebSockets, downloads, dialogs and popups are blocked or closed. Third-party script text remains untrusted and runs only inside the network-disabled child.

Up to three pages return rendered text, selected links, an actual desktop screenshot, and rendered image candidates. Image bytes must already have passed the broker before photo extraction. Screenshots must decode as1440×1000 JPEG; extracted photographs pass raster decoding, dimensions/pixel limits, normalization and content hashing. Their original public URL and page URL are retained. Full-page screenshots are never relabeled as product photographs.

IntakeJobs persists the normalized evidence under the authenticated organization/brand/job, then existing durable analysis handoff runs. The renderer rechecks permission during every resource fetch and after child completion. It does not approve inferred brand facts or publish anything.

## Coverage limits

Desktop capture only; reports partial coverage. Sites requiring login, POST APIs, cross-origin data APIs, CAPTCHA, unsupported MIME or denied robots may remain unavailable. Scroll capture is bounded to1400px and initial settling is bounded; this does not claim full-site/mobile capture. Missing or blocked evidence is not replaced with generated images or fabricated text.

## Verification commands

- `npm run build`
- `node --test tests/contracts/website-render-broker.test.mjs tests/contracts/rendered-website-research.test.mjs`
- `node --test tests/rendered-intake/runtime.test.mjs` (real local Chromium, all website responses supplied by fixtures)
- Build `apps/website-renderer/Dockerfile`, inspect immutable local digest, then `WEBSITE_RENDER_TEST_IMAGE=sha256:... node --test tests/rendered-intake/container.test.mjs` (actual network-none sandbox, fixture transport; skipped without explicit image)

No fixture result proves arbitrary live website capture. Actual funded GPT analysis, owner URL acceptance and deployment remain separate evidence gates.

## Local acceptance evidence — 26 October

API build passed. Eight offline broker/wrapper/real-Chromium tests passed, including private/mixed DNS denial, prototype policy keys, malformed IPC values, and attempted history-based source attribution. The actual non-root `network:none` container fixture passed1/1 with no skips and extracted both JavaScript-inserted text and a rendered photo. Nativearm64 test image: `sha256:0ce1176fe724305f652fc844795b43607db568b4a94d2b1a84f74e66223f39d8`. This is not deployment or live-site evidence. Production amd64 image build and optional worker wiring are complete. Running that image under this arm64 host’s emulation crashes Chromium at launch; the same image subsequently passed the native amd64 dev-host acceptance with actual isolation flags, JavaScript-rendered text, photo and screenshot. No activation was performed. Intake storage foundation passed 19/19, including actual private object persistence, scoped provenance and idempotent replay for normalized rendered fixtures. Final targeted contracts passed 14/14. Build with `node scripts/build-website-renderer.mjs linux/amd64`; the script limits Docker context to four files and works with legacy Docker builders.

### Optional worker rollout preparation

Local worker wiring now composes `RenderedWebsiteResearch`; missing `WEBSITE_RENDER_IMAGE` preserves the existing research path. Worker config rejects mutable or empty image values. The host allowlist forwards the digest, includes it in the configuration fingerprint, and requires the corresponding local Linuxamd64 image during preflight. The inventory validator and bundle permit a sixth explicit `website_renderer` role while preserving the five required existing roles. No inventory entry is added automatically: current host desired configuration remains unchanged until the reviewed image is deliberately entered. These code changes alone do not activate a renderer or prove its host availability.

Native host acceptance can run `python3 scripts/verify-website-render-image.py sha256:...` using only Python standard library and Docker. It supplies fixture resources over IPC and never activates a worker. Separate `bundle-website-render.mjs`, `transfer-website-render.mjs`, and `verify-website-render.mjs` scripts preserve the existing worker bundle and image inventory. Transfer verifies SHA/size and removes the temporary private object.

Native amd64 accepted image: `sha256:11931e9ad1bebc55463e4e1dbf9931fafd91b3c24c5bdf9656b9ae1d77ec1444`. See `docs/evidence/railway-website-render-acceptance.json`. The separate transfer SHA and temporary-object removal proof are in `docs/evidence/railway-website-render-transfer.json`. Worker activation and live owner website acceptance remain pending.
