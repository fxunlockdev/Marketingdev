# Media loading performance

Scope: generated images, carousel slides, video posters and mood board previews on Home, Calendar, Approvals, the post editor, the mood board and plan review. Written 12 Nov 2026 on branch `app-fixes-perf`.

Every number below is labelled **measured** (with its source) or **estimated**. Nothing here was measured on a deployed environment in this pass.

## How an image reached the browser before

| Finding | Evidence |
|---|---|
| Every API response is `Cache-Control: no-store` and every client fetch uses `cache:'no-store'`. Nothing is ever reused. | `app.ts:471`, `load-private-image.ts`, `api.ts` |
| Card previews are one 640px WebP, built on demand and kept only in API memory (16 MiB, 15 min). A restart or second instance rebuilds from the 2 MB original. | `image-previews.ts` before this change |
| Images are fetched by JavaScript into a blob, then shown. Nothing paints until the whole file arrives; the blob is discarded on unmount, so returning to a view downloads it again. | `post-thumbnail.tsx`, `carousels.tsx`, `private-visual.tsx` |
| CSP `img-src 'self' blob: data:` forbids `<img>` pointing at storage; `connect-src` allows it only via `fetch`. Same-origin `/api/...` images are allowed. | `apps/web/proxy.ts` |
| A 64px Home thumbnail and a 420px calendar card receive the same 640px file. | `business-overview.module.css`, `studio.css:400` |
| Carousel cover: one request for the whole carousel record, then the preview. | `post-thumbnail.tsx` |
| Video poster, post editor background, carousel slides, plan-review references: a grant request, then the full original from storage, hashed in JavaScript. | `post-thumbnail.tsx`, `creative-editor.tsx`, `carousels.tsx`, `private-visual.tsx` |

Measured earlier on the hosted dev environment (`docs/evidence/image-preview-performance/measured.json`, 9 Nov): originals 2.13 / 2.36 / 2.57 MB taking 1.7–3.4 s; 640px previews 92,796 / 50,746 / 56,840 bytes; first build 512–1432 ms; **every repeat 304–374 ms**, because nothing is cached.

## What changed

1. **Three stored widths**: 320, 640, 1280px WebP (`media-variants.ts`, `image-previews.ts`). Stored once in private storage at `previews/v1/<original key>/w<width>.webp`, inside the original's tenant prefix. Lookup order: memory, storage, then one transformation that is saved. The worker can call `pregenerate()` at creation time.
2. **Caching**: successful preview replies carry `Cache-Control: private, max-age=31536000, immutable` and a strong ETag built from the source hash and width. A matching `If-None-Match` is answered `304` after authorization, with no storage read. Errors keep `no-store`. Media rows are insert-only, so a URL can never change content.
3. **Authorization is unchanged in strength**: every request runs the same session guard and `Canvas.scope` transaction as before, with explicit tenant filters added, and the object key must sit in the caller's tenant prefix. Signed URLs are not used for previews at all, so none are lengthened.
4. **`<MediaImage>` / `<PostCover>`** (`media-image.tsx`): plain `<img>` on a stable URL with `srcset`/`sizes`, stored width and height, `loading="lazy"` and `decoding="async"`, `fetchpriority="high"` for the first image, a skeleton, separate "not generated yet" and "failed" states, and no skeleton or fade for an image already shown in the tab.
5. **Waterfalls**: preview URLs are built from ids the listings already return, so there is no lookup request to batch. A new cover route removes the carousel record request.
6. **Image optimizer closed** (`next.config.mjs`): `/_next/image` has one server-side cache that is not per user, so it is not allowed to fetch local paths.

## Requests and bytes per image

"Before" bytes are the hosted measurements above. "After" bytes for 640px are the same measured files; 320 and 1280 are **estimated** from pixel area (about a quarter and up to four times the 640 file) because the only local fixture is synthetic noise (measured: PNG 103 KB → 1.6 / 5.9 / 12.9 KB, encode 61 / 129 / 207 ms on this Mac under load).

| Surface | Before | After, first view | After, repeat view |
|---|---|---|---|
| Calendar cards, static post (`content-workspace.tsx`, done) | 1 request, 51–93 KB, 300–370 ms each time | 1 request; 640 or 1280 variant by slot | 0 requests (browser cache) once the API change below is merged |
| Calendar card, carousel cover (done) | 2 requests (record + preview) | 1 request once the cover route is mounted; until then 2, as before, after one failed attempt per session | 0 |
| Calendar card, video poster | 2 requests, PNG up to 2 MB | unchanged (see "Not done") | unchanged |
| Chat carousel slide (`chat-media.tsx`, done) | 2 requests, full PNG about 2 MB (measured originals 2.1–2.6 MB) | 1 request, 1280 variant, **estimated** 150–350 KB | 0 |
| Home, Approvals, mood board, archive, strategies (`post-thumbnail.tsx`) | 1 request, 51–93 KB for a 64px slot | not changed here; with `PostCover`: 320 variant, **estimated** 13–25 KB | 0 |
| Post editor canvas, carousel review, plan-review references | grant + full original | not changed here | — |

Proven by tests, not by a browser: variant widths and sizes, one-time generation, storage reuse by a fresh process, no original read after pre-generation, 304 without storage access, authorization before any cache, headers on success versus errors (`tests/contracts/media-previews.test.mjs`, 14 tests). Proven locally by hand: the Next.js rewrite passes `Cache-Control`, `ETag` and `304` through unchanged.

## Until the API route change is merged

The web changes are safe on today's API: the existing preview routes ignore `?w=` and return the 640px file with `no-store`, exactly as now. The gains then are native lazy loading, parallel fetches and progressive paint only. Caching, sized variants and persistence start when `createMediaController` is mounted.

## Not done

- Video posters still load the original PNG: a browser test compares the calendar poster pixel-for-pixel with the original.
- `post-thumbnail.tsx`, `carousels.tsx`, `canvas.tsx`, `creative-editor.tsx`, `private-visual.tsx`, `guided-moodboard.tsx`, `business-overview.tsx` are owned elsewhere.
- No AVIF: WebP at these sizes is already small, and AVIF encoding is several times slower on the first request.
- Migration 120 is unused. Keys are derived from the original's key, so no table is needed.

## Verify on a deployed environment

1. Preview responses arrive with `cache-control: private, max-age=31536000, immutable` through the Railway edge (no edge rewriting, no shared caching).
2. Second visit to Calendar and Home: image rows show "(disk cache)" / 0 bytes transferred.
3. First-view timing per variant, and first-ever (cold) generation timing, against the 300–370 ms baseline.
4. `previews/v1/` objects appear in the bucket and a restarted API serves them without reading originals.
5. The storage credentials allow `PutObject` under `previews/`.
6. `/_next/image?url=/api/...` returns an error.
7. LCP and CLS on Home and Calendar (targets: LCP under 2.5 s, CLS under 0.1).
8. Decide whether sign-out should send `Clear-Site-Data: "cache"`, since cached previews remain in that browser profile.
