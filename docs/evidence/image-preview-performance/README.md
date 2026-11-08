# Private card preview performance

2026-11-09 (Asia/Kuala_Lumpur). Scope: Home, campaigns, calendar, review, archive, and other surfaces sharing PostThumbnail. Full-resolution editing, export and publication assets are unchanged.

The original three Home images were 2.13, 2.36 and 2.57 MB. Their storage transfers took 1.68 to 3.40 seconds in the baseline browser run, in addition to authenticated grant requests. Cards were fetching whole originals after entering a 100px viewport margin.

New authenticated media/export preview routes return WebP derivatives bounded to 640px per side. Source hashes are validated before resizing. The API retains at most 16 MiB/256 previews for 15 minutes, coalesces concurrent requests, and runs at most two transformations concurrently with a bounded queue. Every request still checks session, business access and tenant-scoped source lookup before touching the cache. Transformation occurs outside the database transaction. Nothing is written to browser storage or disk; HTTP responses remain no-store. Failed/unsupported preview routes can fall back to the original image path. Card preloading begins 600px before the viewport.

Local validation: API and production web builds, web TypeScript, 14 offline assertions/subtests, and 2 browser tests passed. Coverage includes dimensions/aspect, source integrity, cache bounds/expiry, concurrency and failed-request recovery, authorization before cache access, anonymous/forbidden transfer behavior, size/type checks, rolling-deployment fallback, existing overlay rendering, mobile presentation, and uncreated carousel distinction.

Hosted API validation: same three real saved images returned 92,796 / 50,746 / 56,840 bytes, about 97% less data in total. First preparation requests took 512 to 1432ms; repeated requests took 304 to 374ms. Anonymous requests returned 401 and a different business scope returned 404. These are measurements from this run, not a latency SLA. See measured.json.

The screenshot's carousel is content_needed with no generation job or saved carousel version. Its placeholder is not a slow transfer. No paid generation, publishing, customer edits, database migrations, or infrastructure sizing changes were made.

Hosted web validation: deployment `1ea1ec5b-968f-425e-b3f3-06b5c94da625` reached SUCCESS, alongside API `3a33a82d-e65e-4463-936d-449244e15064`. The real authenticated Home browser fetched exactly three preview responses in 339 to 357ms, with 200,382 image bytes in total and no original media grants. All three images rendered with their existing text overlays. The uncreated carousel retained its truthful placeholder. Screenshot `home-live.png` was visually inspected. Both browser regression tests also passed against hosted assets with API fixtures.
