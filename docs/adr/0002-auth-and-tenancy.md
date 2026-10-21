# ADR 0002 — authenticated client workspaces and brand persistence

Status: adopted for initial M1 implementation, not accepted as the complete M1 release gate. ADR 0003 extends this foundation with verified email/recovery and team access; it supersedes the initial account limitations below.

## Reuse and verified contracts

Use NestJS 12.2.0 for the business API and Better Auth 1.7.12 (MIT) for email/password/session primitives. Organization and brand authorization are product-owned. No custom password hashing or cookie signing. `pg` 8.23.1 provides explicit, parameterized transactions. Exact direct and transitive dependencies are in package-lock.json.

Official sources consulted on 2026-10-21:

- https://better-auth.com/docs/adapters/postgresql — pg Pool with auth schema search_path.
- https://better-auth.com/docs/concepts/database — programmatic migration compilation and schema checks.
- https://better-auth.com/docs/concepts/session-management — database sessions, revocation, disabled cookie cache.
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html — table ownership, FORCE RLS and BYPASSRLS behavior.
- https://docs.nestjs.com/controllers — API routing and dependency injection.

Installed source verification: `better-auth/dist/integrations/node.mjs` delegates to better-call; its Node request adapter explicitly supports reconstruction of an already-consumed JSON body. Desvio therefore applies a 32 KiB JSON parser before auth routes. Real HTTP signup/sign-in tests prove this pinned behavior, plus oversized/malformed request denials. Do not carry this assumption through an SDK upgrade without rerunning tests.

`000_auth.sql` is compiled from the actual pinned `getMigrations(authOptions(...))` against a disposable database, reviewed and committed. Runtime roles cannot migrate. The foundation test verifies no missing auth columns/tables remain. `scripts/migrate.mjs` applies both migrations under one transaction and advisory lock, records content hashes, and rejects changed previously-applied migrations.

## Tenant trust boundary

- Better Auth validates the cookie against its private auth database on each protected API request. User IDs in headers/bodies never establish identity. Revoked sessions take effect without cached session cookies.
- `desvio_auth` has DML only on auth tables. `desvio_app` is a separate login with NOBYPASSRLS, no schema/table ownership, no auth-table access and no membership mutation grants.
- App transactions set user, organization and optional brand context with transaction-local settings. Context comes from validated sessions and path IDs. Every organization operation rechecks active membership; viewer writes are denied. Context is reset on commit/rollback before pool reuse.
- RLS is enabled and forced on every app table. Policies independently check the actor's current active membership and organization; brand-scoped reads/writes also check the brand. Explicit predicates remain in API queries.
- Organization creation uses one fixed SECURITY DEFINER function owned by `desvio_bootstrap`, a NOLOGIN/BYPASSRLS role. That role has only SELECT/INSERT on organizations, memberships and audit events, cannot create schema objects, and is not granted to either runtime login. The function has a fixed search_path, no dynamic SQL, a per-actor lock/limit and a foreign key to an existing auth user. PUBLIC execution is revoked. This narrowly scoped function is the only membership-creation path currently exposed.
- The database settings are defense against query-scoping mistakes, not a substitute for server auth. A fully compromised trusted server or leaked runtime database credential remains a security incident; never expose SQL access to browsers/skills.

## Persisted edits and retries

Brand create requires an Idempotency-Key. The request content hash, returned brand, audit entry and outbox event commit atomically. Concurrent same-key requests return one original result; a changed body returns 409. A failed outbox insert rolls everything back, and the same key can then recover. Brand edits use a revision compare-and-swap; stale edits return 409 without overwriting the accepted change. Omitted PATCH fields are preserved, and website=null clears the value deliberately.

Outbox rows are durable pending events only. No dispatcher or Temporal workflow is implemented yet. A website field is metadata only; it does not trigger crawling or establish SSRF safety.

## API surface

| Route | Actual behavior |
|---|---|
| /api/auth/sign-up/email, sign-in/email, sign-out | Better Auth verified cookie/session flow; tested locally, see ADR 0003 |
| GET /health | API database query; explicitly not provider or complete product readiness |
| GET/POST /api/v1/workspaces | List own memberships / create client workspace and owner membership |
| GET/POST /api/v1/workspaces/:org/brands | List/create tenant brands; creation requires idempotency key |
| GET/PATCH /api/v1/workspaces/:org/brands/:brand | Read/edit authorized brand; edits require saved revision |

Exact same-origin checks apply to all mutations including auth; no wildcard origin or caller-supplied proxy IP is trusted. The socket peer address overwrites the internal auth-rate-limit header. Auth rate limits persist in PostgreSQL. Reverse-proxy trust configuration must be explicitly tested before external deployment; currently the API binds to loopback only. API responses carry a server-generated request ID and no-store headers, and database errors do not reveal SQL or private data.

## Evidence and limitations

The Docker suite uses a pinned PostgreSQL 17.11 image on loopback and genuine HTTP sessions. It tests two independent clients, multiple brands, direct SQL without tenant predicates, cross-client attacks, restricted-role writes, revocation, idempotency races, transaction rollback, API/database restart, schema compatibility, request bounds, credentials and auth throttling. Fixture credentials/users are generated solely for the disposable test; no provider calls or customer accounts are involved. Successful tests prove only those covered local paths.

ADR 0003 adds verified email, recovery and client team-management backend routes. Production startup remains blocked by the full release gate. Still outstanding: external email delivery verification, account/team UI, MFA/admin policies, client API rate limits, durable generation jobs and dispatch authorization, private object storage, secrets rotation, billing/credits, operational telemetry, deployment, full security scans/load tests and actual provider journeys. Local API restart and database restart evidence is not disaster-recovery/backup evidence. No capability is LIVE_VERIFIED or LAUNCH_READY.
