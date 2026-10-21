# Dependency lock register — 2026-10-21

| Component | Pin | License / evidence / limitations |
|---|---|---|
| Postiz source audit | 651876e24317c2d8e717262cf98267ec6f699180 | AGPL-3.0 LICENSE/package.json; commercial grant not supplied |
| Postiz amd64 image | ghcr.io/gitroomhq/postiz-app@sha256:a844e4d3e5af0e9e1af0fa8adb2eb85e8b16a6d6b6eaac491bfd5c5e12dc0a65 | Created Oct 11; no OCI revision labels. NOT proven equivalent to Oct 20 source. Resolve before API acceptance |
| Original skills | SHA-256 68fe5dc3d3c2c4c0f8936ffe305b1bc9f106011a7fbe4a7048920cebe61bf7eb | MIT Corey Haines; all file hashes in generated inventory |
| OpenAI | 7.39.0 | Apache-2.0; npm exact lock; SDK wire probes only |
| Higgsfield | @higgsfield/client 0.2.6, /v2 import | MIT; npm exact lock; submit wire probe only |
| Deep Agents | 0.7.29 | MIT; uv exact lock; actual middleware probe |
| LangGraph | resolved exact version/hashes in uv.lock | Transitive to Deep Agents; edition/license audit before runtime |
| PyYAML / jsonschema | 6.0.3 / 4.26.0 | MIT; safe loader / evidence validation |
| Temporal amd64 | temporalio/auto-setup@sha256:e4c296d2b16d7607938e71182b9cc0936c90002ff63d97227f195625cf798ea3 | 1.28.1; upstream MIT. Internal setup, not hardened cluster |
| Postgres | Railway postgres-ssl:18 template | Deployed; full digest/license/backup/least-privilege audit pending |
| Redis | Railway template | Deployed; exact image/digest/security audit pending |
| NestJS core/common/platform-express | 12.2.0 | MIT; real local HTTP API exercised |
| Better Auth | 1.7.12 | MIT; actual schema generation, sessions, revocation, hash and throttle tests |
| node-postgres | 8.23.1 | MIT; real role/RLS and restart tests |
| Express | 5.3.0 | MIT; bounded JSON parser including auth, exact origin policy |
| PostgreSQL test image | postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 | Runtime reports 17.11; local disposable database only, PostgreSQL license |
| TypeScript | 7.0.2 | Apache-2.0; compiler; Node types 26.6.5, pg types 8.23.1, Express types 5.0.6 |
| reflect-metadata / rxjs | 0.2.2 / 7.8.2 | Nest dependencies; exact lock |

Discovered but NOT adopted: Crawl4AI 0.9.5 (PyPI Apache-2.0), Docling 2.141.0 (PyPI MIT). Inspect attribution/model weights/transitives before install. Fabric, FFmpeg codec/build licensing, pgvector, Temporal SDKs, OpenTelemetry and production object storage remain to pin at adoption. Langfuse, Portkey, GrowthBook optional; MinIO not deployed.

M1 npm audit reports zero known vulnerabilities in the current locked npm tree (see generated docs/evidence/npm-audit.json). This is not Python/container/security clearance. Updates require exact lock changes, contract/security reruns and invalidation of prior live evidence. Never follow main/latest automatically in production.
