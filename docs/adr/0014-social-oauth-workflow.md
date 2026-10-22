# Session-bound social authorization through hidden Postiz

Date: 2026-10-22. Scope: LinkedIn member authorization backend, not full social lifecycle or live acceptance.

## Source contract and state boundary

Pinned Postiz 651876e24317c2d8e717262cf98267ec6f699180 stores organization and verifier under a generated state in Redis. `no.auth.integrations.controller.ts` consumes that state before exchanging the code; a lost response cannot be retried safely. `linkedin.provider.ts` lines 181–226 uses state only for authorization routing; token exchange uses code, configured redirect and client credentials. No invented callback endpoint or provider PKCE claim is introduced.

The authorization URL's state is replaced with a Desvio token containing the business ID, attempt ID and 32 cryptographically random bytes. Its SHA-256 is persisted. Postiz's original state is encrypted and never sent to the customer. After exact state and authenticated session validation, only the worker restores the original state for the audited Postiz callback. This bridge is specific to the audited LinkedIn member flow; do not generalize it to providers whose state participates in another contract. Real deployed Postiz/LinkedIn acceptance remains required.

## Backend and data

Migration 016 adds authorization and callback ledgers plus `social.authorize` and `social.connect` jobs. Authorization start has a per-business limit of ten new attempts/hour, idempotent request keys and a ten-minute expiry. Every attempt is owned by the initiating user **and login session**. Another login by the same user cannot view its URL or complete its callback. Admin membership/business grants are required on the API and rechecked by the worker. The existing account credential revision must still match.

Routes:
- POST `/api/v1/businesses/:id/connections/oauth/linkedin`, request key header.
- GET `/api/v1/businesses/:id/connections/oauth/:attempt`, only safe state and a still-usable authorization URL.
- POST `/api/v1/businesses/:id/connections/oauth/:attempt/callback`, exact `{state,code,denied:false,timezone}` or `{state,denied:true,timezone}`.

The callback frontend at `/integrations/social/linkedin` is not included in this backend checkpoint. It must remove authorization parameters from browser history, avoid third-party resources/referrer leakage and POST to these authenticated same-origin APIs; no public unauthenticated callback mutation is allowed. Expired/logged-out attempts require starting again. Provider errors must be mapped to safe denial text, never blindly echoed.

`OAUTH_ENCRYPTION_KEY` is a separate 32-byte hex key shared by API and worker. It cannot equal worker-only `POSTIZ_ENCRYPTION_KEY`. AES-GCM binds encrypted state/code to organization, business, attempt and purpose. API SQL cannot read either ciphertext column; it can only insert encrypted callback codes. Temporary code/state ciphertext is cleared on terminal outcomes, and the code is removed immediately after exchange-result persistence. Abandoned expired authorizations are unusable but retention cleanup still needs the operations lifecycle.

A dedicated NOLOGIN/NOBYPASSRLS function owner can inspect only session ID, user ID and expiry. Workers receive only a job-scoped boolean session-liveness function, never direct session/token/password access. RLS restricts worker authorization/callback records to the current job and business. Cross-business remote-account collisions cannot move a channel.

## Durable outcomes

Before either remote mutation, the job commits a `starting` or `exchanging` marker. Re-entry at that marker becomes `unknown` and never resubmits. Network/malformed mutation responses remain unknown. A confirmed exchange result is persisted as `verifying` before a separate read-only account-list check. Retried verification honors bounded Retry-After without exchanging the code again. Success requires the returned account to be listed for the same remote organization, be LinkedIn and not disabled. Token health remains unknown; this is no publishing or broader permission-health proof.

If the database cannot save a successful remote exchange, recovery holds the outcome unknown. If local channel promotion fails after identity persistence, a retry only repeats the account-list read. Declined consent, stale settings, cancellation, expired/revoked sessions and revoked roles prevent new work/promotion. Local cancellation does not claim to revoke an external authorization that may already have completed; remote reconciliation/revocation remains a subsequent workflow.

## Evidence and remaining scope

Focused tests use actual local Nest/Better Auth sessions, PostgreSQL forced RLS and Temporal. Postiz is explicitly a MOCK HTTP server. Tests cover strong state, login isolation, concurrent callback replay, encryption, expiry, role/session/revision changes, denied consent, mutation response loss, promotion failure, failed exchange persistence, provider rejection, missing accounts, rate limits and foreign account IDs. No genuine LinkedIn login, consent, token exchange or social publication was performed.

Still required: restricted automatic organization provisioning, customer connection/callback UI and browser verification, account/page selection, reconnect/revoke, expired-record cleanup, exact-approved-creative publishing/reconciliation, deployed source equivalence and authorized live acceptance. All other V5 modules remain in scope.
