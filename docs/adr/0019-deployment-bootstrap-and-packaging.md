# 0019 — Atomic database bootstrap and deployable service artifacts

Date: 2026-10-22. Implemented locally; cloud/Linux image acceptance remains open.

## Problem and decision

The application had working local journeys but its main API entry bound only to loopback, and creation of required database roles existed only in the disposable test harness. Add a standalone deployment administrator command, cloud-compatible listening and packaged Next/API service entry points. Preserve Nest/PostgreSQL/Temporal/hidden Postiz, original owner skills and private sandbox boundaries. Do not unlock production startup or replace cloud acceptance with local evidence.

`scripts/bootstrap-database.mjs` requires an explicitly named dedicated database, a literal initialization confirmation, staging/development/test mode and six distinct random credentials. All initial roles, schema, migrations, credential fingerprints and grants are one transaction under the existing migration lock. Extracted `applyMigrations` lets the existing `migrate` wrapper keep identical lock/checksum/replay behavior. Fixed cluster-wide role names prevent accidental environment sharing. Unmanaged roles and nonempty databases are rejected before mutation.

Runtime roles are NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOINHERIT/NOREPLICATION. The existing bootstrap/access definer roles retain their intended BYPASSRLS status and cannot log in. All runtime role memberships and data ownership are rejected. PUBLIC database CONNECT/TEMP privileges are revoked; service logins receive CONNECT only. Migration administration is an isolated one-shot service and never a customer endpoint or API pre-deploy credential.

Replay checks stored random-credential fingerprints, schema checksums and role/login state, and cannot silently rotate credentials. The command subsequently authenticates every real service login. External password drift fails that check without replacing the secret or printing it. Bootstrap transaction failures roll back all initial roles/schema; a post-commit login failure is separately labeled and does not claim rollback.

## Runtime packaging

`listen.ts` validates ports and IP listeners. Staging defaults to the IPv6 dual-stack wildcard; tests/development remain loopback. `/health` retains its API/database-only scope. A distinct web-process-only health route is added.

`build-web.mjs` produces and stages actual Next standalone output with static assets. Pinned Next's generated CommonJS server entry conflicts with this monorepo's root ESM package; its contents are preserved under `.cjs`. The launcher verifies the fixed build-time private API origin against runtime settings, exact public/storage origins, mode and port before startup. A private backend change requires rebuilding; no successful startup can silently proxy to an old environment. The existing customer routes and callback behavior are unchanged.

Both Dockerfiles pin the official Node 26.5.0 bookworm-slim index observed from the registry. Build context is allowlisted, provider keys are not build inputs, and runtime uses an unprivileged account. Host standalone tests do not prove Linux/native dependencies or container security. Railway currently deprecates per-service Config as Code for new services; final project-wide IaC/provisioning remains pending instead of supplying obsolete configuration.

## Verification and next work

`tests/deployment/bootstrap.test.mjs` and its disposable PostgreSQL harness verify target/mode/credential validation, preserving unrelated data/roles, actual fault-injected SQL rollback, least-privilege logins, membership/temp/schema/auth denial, concurrent replay, checksum/privilege/password drift, API startup/shutdown, generated standalone browser rendering/proxying and configuration mismatch rejection. SIGTERM handling uses the pinned Next server's documented-in-source exit code 143 after cleanup; the API exits zero.

The existing 24 real account/tenant/email integration tests also pass through the refactored migration wrapper and are included in `make verify-deployment`, alongside the nine deployment checks. `make verify-deployment` records source-bound results. Source hashing now covers `infra/` and `.dockerignore` as well as application/scripts/tests. Remaining: actual Linux builds, Railway dev resources/domain, isolated execution transport for the existing parser/skill/render containers, storage/Temporal/scanner/email deployment verification, restricted operator setup and authorized live provider jobs. No paid call, social publication, LIVE_VERIFIED or LAUNCH_READY claim.
