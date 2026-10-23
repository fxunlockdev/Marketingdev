# Configure once, then use: launch / operator runbook

The desired end state is **no more feature programming after configuration**. All supported adapter code, real job workflows, authorizations, failure recovery, API contracts and UI must have been implemented and tested by Codex **before** declaring handover. This is the final operator checklist, not a substitute for development.

## What the operator will genuinely need to provide

| Item | Why required | Can Codex implement the product logic before it is supplied? |
|---|---|---|
| OpenAI API key and eligible paid account | Text and GPT image create/edit charges | **Yes**—typed adapter and contract tests; real image smoke test waits for key |
| Higgsfield API access, required key parts and funded balance | Video generation is a paid, hosted service | **Yes**—async lifecycle, retries, storage, tests; live clip test waits for access |
| Social-platform developer apps, credentials, callback URLs and approvals where required | OAuth and publishing access are platform-controlled | **Yes**—connector/permission flow and callback routing; authorizing a real account needs consent |
| Postiz self-hosted config and legal decision | Postiz must actually run, integrate and be tenant-safe; AGPL obligations need review | **Yes**—can deploy local instance, adapter and tenancy security tests; launch waits on legal signoff |
| Hosting account, domains, TLS, DNS and public webhook URLs | Remote providers must reach approved callback URLs | **Yes**—IaC and deployment scripts, actual external accounts/registration remain operator tasks |
| Object storage, database, Temporal and backup configuration | Durable customer data and long-running jobs | **Yes**—automate provisioning with infrastructure templates; provider accounts are required |
| Billing account/webhook settings (if charging users) | Invoices, payment authorization and anti-abuse | **Yes**—integrate SDK/ledger; activation needs payment account approval |
| Customer authorization to connect channels | Customer controls their own social accounts | **Yes**—OAuth UI and backend; consent is inherently required from customer |

**Truthful boundary:** 'just API keys' is feasible only for already-provisioned infrastructure and already-approved social apps/accounts. The codebase must still make the operator-facing setup straightforward and not require hand-written code once credentials and approvals exist.

## Mandatory initial setup flow in product

1. Deploy using the included infrastructure scripts and open `/setup` as the provisioning admin.
2. Validate database migrations, object-store private bucket, Temporal task queues and Postiz connectivity.
3. Enter provider credentials through a server-side encrypted form or secret manager (never browser local storage and never write to the repo).
4. Confirm selected image/video model supports required endpoint and format; opt into low-cost test generation.
5. Configure social-platform app IDs/secrets/OAuth callback destinations; authorize permitted test account.
6. Run a **real** publish staging smoke test with an allowlisted channel; view precise remote ID, account, timestamps, and status reconciliation.
7. Run the same flow with a second tenant to test isolation and denial cases.
8. Run automated `release-gate`; resolve blockers; then enable customer signup, limited rollout and monitoring.

## Operator outcome and support experience

- Setup screen never says **Connected** until a harmless authenticated capability check succeeds; high-cost generation checks must be opt-in.
- Each service displays health and a safe diagnostic: missing key, quota unavailable, revoked OAuth, missing permission, callback mismatch, temporary provider outage.
- Every generated asset shows processing status, output storage status and credits used.
- Every social post has actual remote status; unknown statuses trigger reconciliation, not synthetic success.
- Failed/paused workflows can be retried through UI where safe, with idempotency preserved.
- Customers never see Postiz, raw model API keys, Deep Agents developer tools or Codex.
- Production startup refuses to register demo/mock adapters for enabled customer features.

## Acceptance phrase for Codex

> Build the full working app, not a mockup. Ship adapters, workers, durable data, a configured Postiz deployment, tests, evidence, setup UX, observability and failure recovery. A functionality claim is complete only after a real provider/service call in staging proves it. The final operator should configure external accounts, credentials, deployment, DNS/OAuth permissions and legally required approvals—not implement missing code.

## Implemented Connections return configuration (development checkpoint)

The web service now requires `APP_ORIGIN` (exact public HTTPS origin) and `API_ORIGIN` (private API origin) for `/integrations/social/linkedin`. Preserve the public Host at ingress; redirect destinations come only from configured APP_ORIGIN. Redact OAuth callback query strings in access logs/traces before deployed acceptance. Do not configure model, Postiz enterprise signing or social-provider secrets on the web service. See [ADR 0016](docs/adr/0016-customer-connections.md) for the implemented scope, existing private worker configuration and focused verification. This is not evidence that Railway ingress or real consent has passed.

## Implemented publication backend (development checkpoint)

Publication defaults off. Both API and worker require `POSTIZ_PUBLISHING_ENABLED=true`; a separate expiring `publication_grants` row must authorize the exact business/channel and daily limit before any submission. The customer must explicitly confirm a current approved slot and final image. No real staging grant or social publish was provisioned by development tests. The final operator setup interface is still incomplete; this manual development safeguard is not a finished handoff. See [ADR 0017](docs/adr/0017-approved-publication.md) for exact routes, durable unknown-outcome behavior, reconciliation and remaining live/deployment requirements.

## Resend email configuration

For the selected Resend provider, set `MAIL_PROVIDER=resend`, `RESEND_API_KEY` and `RESEND_FROM` (one address on your verified sender domain) on the API service only. No SMTP fields are required in this mode. The transport is fixed to Resend implicit TLS, as documented at https://resend.com/docs/send-with-smtp. Keep credentials out of the web/skill containers. Existing generic SMTP remains available for local tests or deployments selecting `MAIL_PROVIDER=smtp`. Acceptance by the transport is not proof of inbox delivery: verify sign-up, password reset and invitation delivery in dev before launch.

### Temporary private dev access without email

With owner authorization, staging can explicitly set `MAIL_PROVIDER=disabled`. Only already verified/operator-provisioned password accounts can sign in; public signup and email delivery are unavailable. The mail worker does not consume pending messages. This is not a production mode, default password or global email-verification bypass. Provision only the owner's requested address, keep any temporary password in a private local file, and change it through normal Profile controls. Switch to Resend and verify real delivery before enabling customer signup/invitations.
