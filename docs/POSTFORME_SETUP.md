# Postforme connections and publishing

This integration follows the official https://api.postforme.dev/docs OpenAPI contract captured in `work/postforme-openapi.json`. It is adapter-ready, not live-verified. Existing Postiz accounts and publications are retained separately.

## Operator configuration

Set on the Railway **API service**, never a NEXT_PUBLIC variable:

- `POSTFORME_ENABLED=true`
- `POSTFORME_API_KEY` to the project API key
- `POSTFORME_PUBLISHING_ENABLED=true` only when ready for explicitly approved scheduled publishing

Configure the Postforme project's OAuth redirect URL to `https://<your-app>/connections/postforme/return`. The hosted Quickstart flow uses the project's configured redirect; dynamic redirect overrides are not sent. Enable posts and feeds permissions for the desired platforms. API credentials do not belong in a browser or chat.

Apply migration `083_postforme.sql` before deploying the API/UI. No Postiz credential or database migration is required. Existing media renderer/storage settings are still required for approved output.

## Security and execution

A random stable external_id binds each brand and platform to its remote accounts. A separate expiring attempt binds the logged-in session. Callback account IDs and success flags are not trusted; the server fetches the accounts itself and verifies external_id. Provider account payloads contain access/refresh tokens; only an explicit public-field projection is saved or returned.

Publishing accepts an existing approved slot and exact final asset version. The server rechecks approval and byte fingerprints, uploads immutable media, persists submission intent before requesting a scheduled post, and uses the local publication UUID as external_id. A retry of the same idempotency key returns the stored operation. Interrupted or ambiguous submits are held for reconciliation rather than resubmitted. Refresh verifies external_id, account, caption, schedule and publication results. A processed post is not marked published without a successful result.

Postforme executes accepted scheduled posts. Current status reconciliation and analytics refresh are explicit user actions; there is no background status polling worker or webhook receiver yet. Upload preparation happens within the authenticated API request. An interrupted preparation is retained and never silently replayed. Unknown operations require status reconciliation; no unsupported promise of exactly-once delivery is made.

Connections support Instagram, Facebook, LinkedIn, TikTok, YouTube, Threads, X/Twitter, Pinterest and Bluesky. Existing campaign scheduling currently supports the application's Instagram, Facebook and LinkedIn channel contracts; other connected accounts can supply feeds/analytics but are not exposed as publish destinations until corresponding campaign channel contracts exist. Blog content remains outside social-media publication.

Analytics refresh stores the latest 50 posts per connected account and actual numeric provider metrics. Missing metrics remain missing. Feed history pagination and automated continuous ingestion are not included.

## Live verification pending credentials

1. Connect a disposable account; finish authorization and verify profile.
2. Verify another tenant cannot read, finish, disconnect or publish to that account.
3. Approve an image, carousel and video, schedule each at an explicit future time, inspect exact media and channel.
4. Recheck the saved operation and observe successful provider results and platform URLs.
5. Refresh analytics and compare provider-reported fields; some platforms require analytics permissions or delayed availability.
6. Exercise disconnected-account, expired attempt and provider-error paths. Billing and provider platform access are operator-managed.
