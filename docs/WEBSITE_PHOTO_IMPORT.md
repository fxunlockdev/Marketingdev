# Website photo import

Website research can collect up to six photos from a cited website page into the private brand image library. Photos remain separate from website screenshots and require the existing reference approval before use in creatives.

The collector reads ordinary HTML image, lazy image, srcset and social preview tags. It checks robots rules and public DNS at each page/image redirect, limits fetch size, request count and time, accepts JPEG/PNG/WebP, rejects oversized or animated images, strips metadata and saves normalized JPEGs. Identical normalized images are deduplicated.

Blocked websites, missing photos and invalid files produce coverage limitations without failing otherwise successful research. A saved research response is reused on recovery, preventing a second paid research request. Photos are excluded from automatic layout analysis, so importing them does not require a new vision allowance.

Migration 072 permits multiple distinct photos per source while preserving screenshot uniqueness. Tenant-scoped image downloads and reference approval use the existing storage and authorization services.

Limitations: one cited page per research job, static HTML only; no browser rendering, stock search or promise to collect every photo. This is a local implementation; deployment and live website acceptance remain outstanding.

## Verification

API and web builds passed. All 18 targeted contracts and 17 intake/storage integration tests passed. The storage test saves two distinct photos, verifies private downloads and cross-account denial, reuses paid research on replay, and completes automatic brand analysis with no vision allowance. A read-only live fetch from runwalrealty.com collected six normalized photos in 11 requests; SVG logos and a small telephone icon were skipped. No paid provider calls were made. Evidence: `docs/evidence/website-photo-import.json`.
