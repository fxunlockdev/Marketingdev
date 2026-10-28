# Maxun Cloud capture integration

The owner selected **Maxun Cloud API**, superseding the earlier self-hosting proposal. No Maxun service is to be hosted on Railway. Source archive metadata in source.json is retained for audit; it is not a deployed dependency.

Cloud contract: https://docs.maxun.dev/api/cloud-api (checked 24 October 2026). Fixed base https://app.maxun.dev/api/v1, Authorization: Bearer from private MAXUN_API_KEY. POST /robots/crawl creates a scoped-name robot; POST /robots/{id}/runs starts it and returns a top-level id. GET /runs/{id} returns data including robotId, status, data.crawlData and screenshots. Creation requests capture markdown, html, text, links, screenshot-visible and screenshot-fullpage, domain mode, five-page cap, depth two, sitemap discovery and robots compliance. No extra Maxun LLM summary/extraction requested.

Account GET /me returned HTTP 200 using the owner's applied credential; no paid crawl was run. This is account authentication evidence only.

Deployed baseline:
- maxun-client.ts: fixed-origin authenticated requests, size/time limits, scoped robot names and run identity checks.
- maxun-workflow.ts / maxun-journal.ts / migration 058: tenant/job-scoped durable intent, atomic claims, polling replay and cancellation. Ambiguous submissions are not blindly repeated.
- maxun-evidence.ts: content-format preservation, source provenance, exact-host validation, missing/failed page handling.
- maxun-screenshots.ts: exact run/key association, public DNS-pinned downloads without credentials or redirects, image decoding and size/pixel limits.

Screenshot per-page keys and URL association are derived from the supplied audited OSS source (maxun-core interpret.js and server/src/storage/mino.ts); the Cloud documentation does not specify these nested details. They are supported fixture shapes, **not verified live Cloud output**. Unrecognized/ambiguous media must be reported as unavailable rather than guessed or assigned to the wrong page. Preserve full raw formats privately during persistence, not as executable HTML in the browser.

Capture is connected to IntakeJobs/private storage with durable automatic brand analysis. Tenant isolation, restart recovery, migrations and coordinated worker/API/web deployment are verified with mocked provider results. Old crawler code/dependencies are removed. Shared SafeWeb media security and document intake remain. Actual Cloud result shapes and output quality still require the owner’s live test. No arbitrary website can be guaranteed to allow capture.

Recorder, AI extraction, search, monitoring and document parsing are upstream capabilities, not completed Desvio features. Do not expose upstream dashboards or label the migration LIVE_VERIFIED before actual evidence.

## Recovery contract update — 24 October 2026

The deployed cutover and retired-crawler removal are complete. Owner live Cloud output verification remains pending.

Current local recovery work uses documented GET /robots (`type`, `q`, bounded `limit`/`offset`) and GET /robots/{id}/runs (`source=api`, `since`, `limit=2`). See https://docs.maxun.dev/api/cloud-api sections List and get robots, List/cancel/delete runs. Robot lookup requires a unique exact tenant/job-derived name, URL and crawl type. Run lookup requires the saved robot, API source and submission time; multiple/absent results never authorize another POST. Existing legacy submitting checkpoints without timestamps remain held. Bounded read-only retries may repair an in-flight/later activity replay, but already terminal unknown jobs still need an explicit recovery operation; do not call this complete operator recovery or LIVE_VERIFIED.
