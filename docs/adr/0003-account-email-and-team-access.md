# ADR 0003 — verified accounts, recovery and client team access

Status: implemented and tested locally as continued M1 work. Not live-verified, not a complete account UI or production release.

## Library contracts

Better Auth 1.7.12 remains responsible for verification tokens, password hashing, reset tokens and sessions. `authOptions` now enables required email verification in every environment, disables automatic sign-in on signup/verification, sets verification/reset expiry to 30 minutes and revokes existing sessions on password reset. Its Kysely 0.29.7 adapter explicitly uses transactions. A real database-failure test proves reset-token consumption, password change and session revocation roll back together; concurrent use of one reset token produces one success.

Official sources consulted: https://better-auth.com/docs/authentication/email-password, https://nodemailer.com/smtp and https://nodemailer.com/extras/smtp-server. Installed source `better-auth/dist/utils/password.mjs` and `api/routes/password.mjs` confirms the transaction and token-consumption path. Source inspection also found that the underlying better-call router prints unexpected errors even with Better Auth logging disabled. `onAPIError.throw` and Desvio's sanitized handler contain raw errors; a fault-injection test checks both the public response and absence of raw console errors. All auth 5xx responses are sanitized.

Nodemailer 10.1.7 (MIT-0) supplies the SMTP transport. Dev-only smtp-server 3.20.2 (MIT-0) and mailparser 3.10.0 (MIT) implement the loopback protocol test fixture. Tests send actual SMTP transactions only to that local server; no real person is contacted. SMTP acceptance does not prove inbox delivery. External TLS, authentication, DNS/sender setup, deliverability and bounce processing are not established by these tests.

## Durable mail boundary

`delivery.outbox` persists encrypted payloads with AES-256-GCM, a random nonce per message and authenticated metadata binding the ciphertext to its ID/kind/client. The dedicated 32-byte MAIL_ENCRYPTION_KEY must be kept server-side and preserved for the lifetime of pending mail. Never replace that key while messages depend on it without a migration/rotation plan. Rotation tooling remains an operations task.

Auth callbacks enqueue verification/recovery messages through the auth role. Invitations and their email records commit together in the application transaction; invitation creation requires an idempotency key. Recipient addresses and token-bearing links are encrypted in the mail queue. Invitation lookup stores only the token hash; browser responses never contain the invitation token. A link's fragment carries the token to the future acceptance UI, which must post it to the authenticated API.

`desvio_mail` is a separate NOBYPASSRLS login with SELECT/UPDATE only on the queue and no auth/brand-table access. Worker claims use row locks, leases and fencing IDs. A successful SMTP response records **accepted**, not delivered, and clears the sensitive payload. Explicit temporary SMTP rejection can retry with bounded exponential delay; permanent rejection fails. A lost acknowledgement or expired processing lease becomes **unknown**, preventing automatic duplicate submission. Expiry clears sensitive payloads. Invalid ciphertext fails before any network call. Operator visibility and explicit recovery for unknown outcomes still need UI/runbook work.

The API entry point runs the mail loop with graceful shutdown; the test harness drives it explicitly. This queue is for short account-email operations. It is not the Temporal generation/publishing workflow, which remains to build. Verification mail and the auth SDK transaction use separate DB operations: a late auth rollback can leave an unusable queued verification link; it never grants access, and the normal resend flow can recover. Invitations do not have that split-transaction limitation.

## Invitation and membership rules

- Only a verified session may use workspace/team APIs. Only owners/admins can invite; admins can grant editor/viewer access, while owners can also grant admin access. Owner transfer uses the separate membership-change path.
- Invitations are bound to a normalized recipient email, organization and role; they expire after seven days. Acceptance checks the current verified account email and the sender's current authority. Foreign, expired, revoked or sender-deauthorized links cannot grant membership.
- Repeated acceptance by the same member is idempotent. It cannot reactivate a subsequently removed member or restore a prior role. Existing active members change roles through the explicit team-management path.
- Replacing a pending invitation invalidates its earlier grant and cancels unsent email. A message already submitted to SMTP may still arrive, but its revoked link cannot grant access.
- Membership and invitation changes share an organization lock. Concurrent owner changes cannot remove the last active owner. Admins cannot promote themselves or alter owners/admins. A removed member must receive a new valid invitation to rejoin.
- A serialized daily cap of 100 invitations per client prevents concurrent requests bypassing that limit. This is not the general API, provider-budget or billing quota system.
- Security-definer functions use a fixed search path and a dedicated NOLOGIN owner with limited membership/invitation/audit access and selected auth-user columns. Neither app nor mail roles can become that role. RLS remains forced on app and queue tables, with composite client/mail foreign keys.

## Routes and configuration

| Route | Behavior |
|---|---|
| POST /api/auth/sign-up/email | Create unverified account and enqueue verification email |
| GET /api/auth/verify-email | Better Auth validates emailed token; no automatic sign-in |
| POST /api/auth/send-verification-email | Request a fresh verification email |
| POST /api/auth/request-password-reset | Same public response for known/unknown email; safe redirect validation |
| POST /api/auth/reset-password | Consume token, update password and revoke sessions atomically |
| GET/PATCH /api/v1/workspaces/:org/members[/:user] | List permitted client team / explicit role or removal change |
| GET/POST /api/v1/workspaces/:org/invitations | List invitations with honest mail status / enqueue scoped invitation |
| POST /api/v1/workspaces/:org/invitations/:id/revoke | Revoke pending invitation |
| POST /api/v1/invitations/accept | Accept for the authenticated, verified recipient |

Additional server configuration: MAIL_DATABASE_URL, MAIL_ENCRYPTION_KEY, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and SMTP_FROM. Outside loopback development/test, SMTP requires authentication and TLS with certificate validation; staging also requires an HTTPS app origin. Production remains blocked by the complete release gate. The current main process binds to loopback; ingress/proxy trust and deployment remain unfinished. There are no email connection badges or claims of external delivery.

## Remaining scope

Custom sign-in/recovery/invitation screens; external sender verification; invitation/unknown-mail recovery UI; email abuse/retention operations; MFA; broader API quotas/observability; private media storage; Temporal/generation-worker authorization; deployed multi-client journey; real provider tests. The end-to-end creative generation/revision/approval/social-publishing goal is unchanged.
