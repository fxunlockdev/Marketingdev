# Canonical creative exports and exact-image approval

Date: 2026-10-22. Status: implemented; acceptance evidence is generated separately.

## Decision

Persist a private PNG of the exact immutable creative version before publication. The existing Temporal worker dispatches `creative.export` to a network-disabled, read-only, non-root Fabric/node runtime. This extends the existing media pipeline and does not change the platform architecture. Migration 014 adds tenant-scoped immutable export requests, outputs and approval records. The worker cannot approve content.

The isolated image contains Fabric 7.4.0, canvas 3.2.0 and jsdom 26.1.0. Its Node base, npm lock and font package versions are pinned. Every export records the actual container digest, runtime hash, installed-system-package manifest hash and font file hashes. Arial, Georgia and Verdana are explicitly rendered using Liberation Sans, Liberation Serif and DejaVu Sans. Browser and server font engines may differ: the saved PNG is authoritative, and the UI discloses substitutions and requires review of that image. Existing version approvals do not automatically approve new pixels.

Only typed design data and a verified private PNG enter the renderer over stdin. No URLs, HTML, arbitrary Fabric JSON, keys, database access, network or host filesystem mounts are available. CPU, memory, process count, execution time, input/output size and pixel dimensions are bounded. Overflowing text fails with a saved actionable error. Images stay private; downloads use short-lived signed URLs. The browser checks the downloaded SHA-256 and length before enabling the image-review checkbox.

## Transactions and recovery

Enqueue binds actor, brand, version hash, renderer digest and idempotency key. Concurrent requests serialize per business, reuse a running/exported result, and reserve the maximum output size against a 512 MiB per-business export allowance. A daily limit bounds CPU work. Cancellation and revoked access prevent promotion. Historical renders may be retained if a newer edit appears, but can never overwrite or approve it.

Content-addressed storage and unique version/renderer constraints allow recovery after a storage write followed by a database failure without duplicate export records. Rendering is local CPU work, with no paid provider call. Current review and exact-pixel approval commit together; any failed approval insert rolls back the content decision. Replayed requests return the same approval. Changed versions, post revisions or renderer images require review again.

`CreativeExports.publicationProof` checks current slot approval, exact creative/source hashes, current project version, current renderer and a matching slot-specific pixel approval. Canvas approval alone does not authorize a channel post. The future publisher must invoke this check under the same locks immediately before submission; no Postiz publishing capability is claimed by this change.

## API and configuration

Authenticated business routes: GET/POST `creative-versions/:versionId/exports`, GET `creative-exports/:exportId/download`, POST `creative-exports/:exportId/approve`, POST `export-jobs/:jobId/cancel`. API and worker use the same exact `RENDER_RUNTIME_IMAGE=sha256:...`. Absent configuration is visibly unavailable. The runtime is built from an explicit allowlisted context using `scripts/render-test-image.mjs`; the whole repository and credentials are never copied into it.

Local tests use genuine PostgreSQL RLS, private S3, Temporal and the actual isolated renderer. Background fixtures and paid OpenAI mocks are explicitly identified. Test database data lives in a disposable host directory, survives restart tests and is removed on exit; unrelated Docker volumes are untouched.

## Remaining acceptance

Deployable private runtime infrastructure, real provider creative quality, social connection/publish/reconciliation, video/carousel exports and full launch gates remain separate work. A rendered fixture or local browser pass is not LIVE_VERIFIED provider evidence.
