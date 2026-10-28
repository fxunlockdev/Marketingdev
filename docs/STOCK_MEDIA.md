# Stock photo search and replacement

Status: **ADAPTER_READY**. Pexels requests have contract coverage with fixtures; a funded or live provider call has not been made for this change. No claim of live stock verification is implied by local tests.

## Operator configuration

Set `PEXELS_API_KEY` on the API service only. The API remains available without this optional setting; stock search then returns an actionable unavailable message. Never expose the key in web environment variables. Obtain API access through [Pexels API documentation](https://www.pexels.com/api/documentation/), and review its current license and API requirements before release.

Search and photo metadata use the fixed Pexels API host. Image bytes use the fixed Pexels image host; redirects, alternate origins, embedded credentials, ports and invalid image signatures are rejected. Search results show photographer attribution and a Pexels link. A one-hour metadata cache and per-process request ceiling reduce provider calls. Operators running multiple API replicas must account for the combined provider quota.

## Customer flow

The Brand Kit/reference library offers **Find stock photos**. Search results are visual, with pagination and photographer credit. Selecting a photo imports it to private tenant storage and uses the existing malware/image validation pipeline. The customer confirms usage rights before it becomes an approved brand reference. The pending import survives a page reload in the same browser tab.

The saved-image editor and Calendar post editor offer **Replace with a stock photo**. This is separate from selecting an AI reference: replacement creates a new editable draft using the imported photograph, preserves text layers and caption, and crops the photograph to the existing design dimensions. Previous versions remain intact. Calendar replacement also explicitly attaches the new version to the post using its revision check; approved posts require resetting approval. Nothing is approved or published by this action. If attaching a new version conflicts with another edit, the existing latest-version attachment control lets the user recover without regenerating or losing the created version.

## Persistence and safety

Migration `077_stock_imports.sql` records provider photo ID, attribution, imported asset and requesting tenant/user with forced row-level security. Migration `078_stock_creative_media.sql` permits a creative media record to originate from an approved stock upload instead of an AI job. The two origins are exclusive. Imported media is normalized and stored privately with content-addressed keys. The replacement operation verifies the stored source hash, rejects archived projects and revoked references, checks the latest version and creates an unapproved version. Quotas and version limits apply.

Import requests use an idempotency key. Repeating an accepted import returns its current state rather than creating duplicate validation work. The UI polls durable import state and displays validation failures. Network interruption before upload completion can be retried with the same key.

## Verification

Provider contract tests: `node --test tests/contracts/stock-provider.test.mjs`.

Database/storage/scanner integration: `node scripts/foundation-test.mjs --stock-media`.

Browser Calendar replacement: `node scripts/foundation-test.mjs --stock-web`.

The integration tests use fixture Pexels responses; browser generation uses the existing mock OpenAI provider. These prove application plumbing, not live Pexels or image-provider readiness. Live release verification still requires configuring the API key, searching, importing a real licensed photo, replacing a design, and reloading the saved post and its image.

## Optional discovery capability

`GET /api/v1/businesses/:id/stock/capabilities` is an authenticated, brand-scoped read returning `search_available`. When the optional stock provider is absent, the customer sees no stock-search control or provider-setup instruction. Existing imported library media and a saved pending import remain usable; capability discovery never calls a paid provider. AI-generated photo replacement is a separate workflow and is never described as stock photography. Pexels activation is optional, not a prerequisite for the generated-image replacement release.
