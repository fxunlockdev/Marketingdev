# Automatic business publishing-account provisioning

Date: 2026-10-22. Implementation checkpoint; no live upstream provisioning or deployment acceptance.

## Pinned contract

Postiz commit 651876e24317c2d8e717262cf98267ec6f699180 exposes POST `/enterprise/create-user` with a JSON `params` JWT signed by its `JWT_SECRET`. `enterprise.controller.ts` accepts id/name/saasName/email; `organization.repository.ts#createMaxUser` creates a new organization, internal user and subscription and returns `{id,apiKey}`. The supplied id is embedded in the organization name, not an idempotency key. Source catches creation failures as `{create:false}` and authentication/validation failures as `{success:false}`. No supported lookup/replay contract was found.

The adapter pins jose 6.2.13 (already present transitively) as a direct dependency, signs HS256 with a 60-second expiry and sends only the audited fields plus standard JWT timestamps/jti. jti is an audit identifier, not a remote idempotency guarantee. Internal identities use `business-<business UUID>@desvio.invalid`, not the customer's email. The expected remote name is `Desvio business###<business UUID>`. No network source, logging or customer response receives the signing key. No Postiz database reads/writes are introduced.

## Restricted execution

`provisioner-main.ts` is a separate entry point within the existing backend worker codebase. It runs only the provisioning workflow on its own Temporal queue and database login; it does not load model, auth, storage, SMTP or skill configuration. The ordinary worker dispatches provisioning to this queue but never reads the enterprise signing secret. Deploy the provisioner in a private service with separate secrets, queue access and no customer ingress. This preserves the chosen API/worker/Postiz architecture while isolating a credential capable of administering Postiz.

Migration 017 creates the NOLOGIN `desvio_provisioner` role. Infrastructure provisioning must give that role its own login credential; do not run the service with a migration or app role. Forced RLS permits access only to the current `social.provision` job, its requesting membership/business grant, candidate and business binding. It cannot read auth tokens, assets, creatives or other business bindings; it cannot update/delete existing bindings. API and ordinary worker cannot read provisioning candidate credentials or write bindings.

## Customer API and state

POST `/api/v1/businesses/:id/connections/prepare` accepts an idempotency key and no credential/remote-ID input. Only an owner/admin with the corresponding business grant can invoke it. Concurrent attempts coalesce. Existing verified enabled bindings return configured; disabled/unverified bindings require operator attention and are never silently re-enabled. Three new attempts/business/hour are permitted; account creation remains subject to the existing default three-business entitlement.

GET the existing connections route returns safe provisioning phase/job/error metadata. POST `/connections/provisioning/:job/cancel` records a cancellation request. Preparing the private remote organization is not social OAuth consent, connection health, publishing permission or subscription billing.

The durable ledger commits `creating` before a remote call. A restarted activity, lost response, malformed response or `{create:false}` becomes `unknown` and holds the business against new creation attempts. Known pre-creation rejection can be retried with a new request within the limit. Returned credentials are immediately encrypted with the existing per-business Postiz vault and persisted as a candidate. Only a separate authenticated `/public/v1/me` check proving the returned remote ID and exact business marker can create the active binding. The identity check is safe to retry, respects Retry-After and never repeats creation. Binding and job success commit atomically.

If local binding persistence fails, the encrypted candidate survives and verification can resume. If credential capture fails after the remote create, the outcome stays unknown; no automatic duplicate. Permission loss before creation cancels; after creation it holds the encrypted candidate without enabling the account. A concurrent unknown finalization may still retain a late response for operator recovery but does not silently reactivate it. Global remote-ID and credential-fingerprint uniqueness prevent reuse between businesses.

## Configuration

- API: existing `POSTIZ_ENABLED=true` plus opt-in `POSTIZ_PROVISIONING_ENABLED=true`.
- Ordinary dispatcher: `POSTIZ_PROVISION_TASK_QUEUE`, distinct from `TEMPORAL_TASK_QUEUE`.
- Provisioner: `APP_MODE`, `POSTIZ_PROVISIONER_DATABASE_URL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `POSTIZ_PROVISION_TASK_QUEUE`, `POSTIZ_BASE_URL`, `POSTIZ_MEDIA_ORIGINS`, `POSTIZ_CALLBACK_ORIGIN`, `POSTIZ_ENCRYPTION_KEY`, `POSTIZ_ENTERPRISE_SIGNING_SECRET`.
- `POSTIZ_ENTERPRISE_SIGNING_SECRET` must match the private pinned Postiz runtime's JWT secret and must be distinct from encryption keys. Never put it in the ordinary worker, API, browser, model/skill context or public environment variables.
- Start with `npm run start:provisioner`. Production mode remains release-gated. No actual secrets were provisioned in this checkpoint.

## Verification and remaining work

Five contract tests inspect exact signed payload/expiry and independent HMAC signature, response bounds, redirects, timeouts, sanitized failures, configuration boundaries and isolated queue dispatch. Nine integration tests use actual local Nest/Better Auth, PostgreSQL roles/RLS and Temporal with explicitly MOCK upstream Postiz. They exercise setup → encrypted verified binding → ordinary authorization job, duplicate prevention, revoked permission, read-only recovery, persistence failures, tenant collisions and limits. These do not prove a live Postiz runtime or license readiness.

Remaining: an operator recovery interface for unknown/lost creation responses, credential rotation/revocation and retention, customer connection/callback UI/browser tests, deployment/source equivalence and authorized live acceptance. A lost response cannot be resolved by inventing a lookup endpoint or repeating creation; recovery needs verified operator evidence or an explicitly audited Postiz extension. Existing AGPL/source-offer review remains outstanding. All other V5 modules and full deployment/release gates remain in scope.
