# 0016 — Business-scoped Connections and server OAuth return

Status: implemented locally; final focused verification pending. No live-provider or launch claim.

## Customer flow and unchanged architecture

The V5 business workspace now renders `apps/web/components/connections.tsx`. Its Connect LinkedIn action enqueues the existing private account provisioning workflow when needed, then requests a session-bound authorization. The customer continues to the audited LinkedIn consent URL. The existing Nest/Postgres/Temporal/Postiz boundary is retained; enterprise signing keys never enter the API or web process. This slice covers personal LinkedIn profiles only.

Read metadata exposes server-computed business management permissions, availability and the initiating session's latest attempt. No credential, authorization code or remote state is returned by the general list. Selected-business editors see observations but no management actions, even if their organization role is admin. Saved account observations distinguish available, disabled and missing; they do not imply valid posting permissions. Failed refresh preserves prior observations. Unknown provisioning stays held.

## Server-only return

`apps/web/app/integrations/social/linkedin/route.ts` handles the redirect. It validates the public Host against configured `APP_ORIGIN`, rather than Next's internal/normalized URL origin. Redirect destinations always use that configured origin; forwarded-host headers cannot choose a destination. Duplicate state/code, malformed UUID/state, simultaneous error/code and control characters are rejected. Raw provider descriptions are ignored. The server forwards only the cookie and validated callback fields to the configured API, with redirects disabled and a bounded timeout. Existing API state, initiating-session, membership, expiry and account-revision checks remain authoritative.

A successful enqueue redirects to the business with only the attempt ID. Failures redirect to an allowlisted reason and validated IDs. Callback pages do not serialize codes into HTML, scripts or browser storage. Application responses are no-store/no-referrer. OAuth necessarily first arrives with a code in its request URL: ingress/access logs and tracing must redact callback query parameters before deployed acceptance. These local tests do not prove Railway log policy.

The API derives an omitted timezone from the saved business IANA zone (UTC fallback), retaining explicit-offset compatibility. The initial request fingerprint records omitted timezone as null, so replay does not change when a business timezone changes. No schema migration is needed.

## Configuration

- Web: `APP_ORIGIN` must be the exact public HTTPS origin, with no trailing slash/path/query; HTTP allowed only for loopback local tests. `API_ORIGIN` is the private API HTTP(S) origin, without credentials/path/query/hash. The public Host must be preserved by the trusted ingress. Missing or mismatched configuration fails closed.
- Existing API/worker `OAUTH_ENCRYPTION_KEY`, callback-origin, Postiz flags and separate provisioner secret/role/queue remain as documented in ADRs 0014/0015. Do not place provider or provisioner secrets in web environment variables.
- `make verify-connections` emits focused source-bound evidence. `make verify-social` continues to test the backend. Neither replaces full security/browser or live acceptance.

## Proof and boundaries

The focused browser harness uses actual Next/Nest/Better Auth/Postgres/Temporal/private storage and separate workers, with an explicitly MOCK Postiz server and intercepted MOCK LinkedIn consent. It checks setup, authorization, clean return, business timezone, persistent observations, failure/missing account refresh, business switching, foreign-user denial, selected-business read access, cancellation, declined consent, wrong-login/expired/duplicate callbacks, unknown setup, disabled binding, desktop/mobile accessibility and browser secret leakage.

No provider login, test-social connection, posting authority, publication, real token health, deployed callback or launch acceptance is inferred. Account/page selection, reconnect/revoke, uncertain-setup operator recovery, credential rotation/retention and the remaining V5 modules still require implementation and acceptance.
