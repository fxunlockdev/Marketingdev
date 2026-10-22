# Desvio deployment foundation

This directory prepares the existing Next/Nest/PostgreSQL architecture for an isolated Railway **dev** environment running `APP_MODE=staging`. It is not a full deployment or launch claim. Existing production-named Postiz services must not be reused as a fresh Desvio database by assumption.

## Prepared artifacts

| Service | Build | Start | Private credentials |
|---|---|---|---|
| Web | `infra/web.Dockerfile` | image default `node start-web.mjs` | No database/model/SMTP/Postiz keys; public app/storage origins and private API origin only |
| API + durable mail loop | `infra/api.Dockerfile` | image default `node dist/main.js` | Separate app/auth/mail URLs, auth/mail keys, authenticated sender and private object storage; optional OAuth encryption key |
| Database setup (one-shot) | API image | `node scripts/bootstrap-database.mjs` | Migration administrator and six distinct generated database passwords; never attach these to API/web |
| Private Postiz provisioner | API image | `node dist/provisioner-main.js` | Separate provisioning DB login, Temporal queue and Postiz signing/encryption configuration from ADR 0015 |

The Node 26.5.0 bookworm-slim OCI index is pinned in both Dockerfiles. `runtime-image.json` records the actual public registry manifest lookup, not a successful Linux build or vulnerability clearance. Local standalone smoke uses the host's native dependencies. Linux image builds/runtime remain to be verified; the full local Docker disk and Railway deployment pause are outstanding constraints.

The Docker context is explicitly allowlisted in `.dockerignore`. Only `API_ORIGIN`, a nonsecret origin, is a web build argument. No build requires a provider key or customer database credential. Runtime images use the unprivileged `node` user.

## Database setup

Provision a **dedicated empty PostgreSQL cluster/database for this environment**. Desvio's fixed role names are cluster-wide. Do not point setup at the existing Postiz database or an unrelated application. Use the `bootstrap` fields in `environment-contract.json`, with six independently generated 32-byte hex passwords, and explicitly name the target database.

`make bootstrap-database` (or the one-shot image command) requires `DESVIO_BOOTSTRAP_CONFIRM=initialize-isolated-desvio-database` and a test/development/staging mode. It creates the service roles and all checksum-verified migrations in one locked transaction, enables only the six service logins and revokes public database access/temp privileges. Helpers retain narrowly used BYPASSRLS permissions and cannot log in. No runtime role owns product tables or inherits a privileged role.

Replay verifies the role attributes/memberships, migration checksums and protected credential fingerprints. It never adopts pre-existing unmanaged roles/data and never silently rotates passwords. The CLI then actually authenticates all six runtime credentials. A login-check failure can occur after schema commit; it reports that condition explicitly and does not claim rollback. Partial fresh migration failures roll back roles and schema together. Runtime credentials and SQL/errors are not printed.

Construct each service's connection URL from the corresponding role name and generated password using URL encoding; preserve the verified server's TLS settings. Only the one-shot setup process receives `MIGRATION_DATABASE_URL`; stop/remove its active credential exposure after setup. Role names and environment names are mapped in `environment-contract.json`. Credential rotation requires a separately audited lifecycle; changing bootstrap passwords is deliberately rejected.

## API and web startup

The API validates `PORT` and `LISTEN_HOST`; staging defaults to `::`, supporting Railway private-network addressing. Development/test defaults remain loopback. The API `/health` proves API/database connectivity only. The web `/health` proves the web process only. Neither response certifies workers, storage, SMTP delivery or model/social readiness.

The web build uses `node scripts/build-web.mjs` and the exact private `API_ORIGIN` for that environment. It produces Next standalone output, copies static/public assets and writes a nonsecret build-origin marker. Pinned Next emits a CommonJS server entry in this ESM monorepo; the packager preserves its contents and uses the `.cjs` suffix. `start-web.mjs` rejects a different runtime API origin, invalid origins/ports and production mode. Staging requires HTTPS public app/storage origins. Rebuild if the private API origin changes. No public origin is inferred from incoming forwarded headers.

## Railway configuration and limits

Use the existing authorized project `5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12` and resolve/create a distinct dev environment before applying resources. Configure each service's Dockerfile path via Railway's supported service settings (`RAILWAY_DOCKERFILE_PATH` is also documented), preserve the web's public Host, use `/health` startup checks, and redact OAuth query strings at ingress. Only web gets a customer domain. Backend/provisioner/storage/Temporal stay private where supported. Bootstrapping is a one-shot task, not an API pre-deploy hook carrying administrator credentials.

Railway's current documentation says new services cannot use the deprecated per-service `railway.json`/`railway.toml` system. No obsolete config files are supplied. Final project-wide IaC/service provisioning must cover the complete runtime and preserve existing resources; it is still pending.

The ordinary worker currently launches networkless Docker sandboxes for document parsing, rendered crawling, original-skill execution and canonical rendering. A Railway service is **not proven** to provide this boundary. No public Docker socket, privileged daemon or unisolated parser replacement is introduced. Private worker execution, ClamAV signatures, Temporal durability/TLS, bucket IAM/CORS, sender delivery, operator `/setup`, callbacks and live provider evidence remain deployment acceptance requirements. Production startup remains blocked by the release gate.

## Evidence and authoritative contracts

`make verify-deployment` runs actual disposable PostgreSQL, CLI replay/failure checks, API startup and a generated standalone web artifact against that API, including a real Chromium sign-in render. Provider generation/social transports are not called. `docs/evidence/deployment.json` binds results to the exact source, including these deployment files. This focused suite cannot replace full tenant/security/browser/live acceptance.

- [Railway Dockerfiles and build arguments](https://docs.railway.com/builds/dockerfiles)
- [Railway private networking](https://docs.railway.com/networking/private-networking)
- [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
