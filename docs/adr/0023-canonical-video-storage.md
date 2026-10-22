# ADR 0023 — Bounded canonical video persistence and replay

Status: local object-storage capability tested; the complete video workflow remains open.

## Problem and change

`ObjectStore.persist` used the default 20 MiB read limit both when checking an existing object and when recovering a conditional-write conflict. The video downloader and isolated decoder accept up to 64 MiB. A legitimate video larger than 20 MiB could therefore be written once but fail on every retry, even when the saved bytes were correct.

Canonical `video/mp4` writes now enforce a 64 MiB maximum and use the same bound for both recovery reads. All other canonical writes keep the 20 MiB maximum. Empty/non-buffer and oversized writes are rejected before S3 access. Explicit reads reject non-integer, non-positive, non-finite or above-64-MiB limits. The video download boundary imports the shared constant. Customer upload routes and their 20 MiB quota remain unchanged.

Content-addressed keys and exact SHA-256 checks are retained. Concurrent correct writers may persist identical bytes on a backend that ignores conditional writes; a hash conflict never authorizes an overwrite. Replay verifies the saved bytes. A failed acknowledgement is not treated as proof that no write occurred.

## Evidence scope

`make verify-video-storage` uses actual disposable private S3-compatible storage. It covers a clip-sized byte fixture above 20 MiB, the exact 64 MiB boundary, concurrent writes, a new client recovering saved bytes, acknowledgement loss after a real write, corruption, invalid size/read bounds and image/document-limit preservation. The 404/412 conditional-write race is explicitly fault-injected around real saved data and an actual final GET, because Garage may ignore If-None-Match.

The same suite reruns the existing seven authenticated upload/scanner/forced-RLS/Temporal tests, including process-death recovery, canceled/revoked access, selected object denial, quota races and temporary scanner failure. There are eight new storage checks, fifteen combined. Synthetic bytes are not valid provider video, decoder evidence, tenant video-version persistence or a customer feature. No live provider or model call is made.

## Remaining boundaries

The parent workflow must validate media inside the isolated decoder and own business-scoped reference leases, immutable database records, version lineage, revocation, private retrieval and exact-output approval. This change does not relax the current image-only creative database schema or expose a video upload/API route. Deployed bucket policies, retention, private runtime packaging and live generation are still required.

Current Railway discovery has no dev environment. A fresh authorized create-dev attempt again failed with the upstream deployment pause; machine response is `docs/evidence/railway-video-storage-attempt.json`. Local Docker data storage still reports zero free space; no unrelated application was stopped/pruned/restarted. These are deployment/image-build blockers, not claims that local object-storage tests failed.
