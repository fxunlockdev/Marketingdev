# ADR 0001 — Desvio foundations

2026-10-21. Accepted direction; runtime validation incomplete.

The owner named Desvio, required multiple client tenants, authorized cloning/deploying Postiz in the supplied Railway project, then requested the entire end-to-end product as an active goal. Continue sequential milestones beyond the earlier M0 checkpoint. Paid provider/social tests still require explicit staging credentials, caps and account allowlists.

- Organizations are authorization boundaries; brands belong to one organization. Agency staff may have explicit memberships in several client organizations. Browser selection is not authorization.
- Our UI/API owns brand truth, creative versions, approvals and tenancy. Postiz is private organic publishing infrastructure. Provisional mapping: a non-platform-admin Postiz org credential per Desvio organization plus Desvio brand/account permissions. Two-tenant service tests must prove it.
- Audit source at `651876e24317c2d8e717262cf98267ec6f699180`; official Railway image is separately digest-pinned and predates that commit. No revision label exists. Resolve source/image equivalence before API acceptance; do not apply latest source claims to the older image.
- Direct OpenAI SDK for create/edit. Disable SDK submission retries (`maxRetries:0`); persist ambiguous outcomes for reconciliation/manual review. Application idempotency does not prove provider deduplication.
- Higgsfield V2 uses explicit client instances and `subscribe(...,{withPolling:false})`. Persist request IDs, then poll via documented authenticated REST in durable activities. Do not invent SDK methods or webhook signing.
- Actual Deep Agents skill middleware reads only curated owner files in a per-run virtual mount. No helper execution, shell, credentials or implicit publish/billing tool grants. M0 proves discovery/reference reading, not model execution.
- Retain owner ZIP and MIT notices; content/tree hashes pin skills. All 52 actually have metadata.version despite specification uncertainty.
- M1 target is TypeScript API/web, Python intelligence/ingestion, Postgres/RLS, private object storage, Temporal. Future dependencies get locks/contracts before adoption. Portkey, GrowthBook and Langfuse service deployment are optional, not first-slice prerequisites.

The owner states dependencies are licensed. Postiz's checked-out LICENSE/package.json identify AGPL-3.0; no separate commercial grant was supplied. Applicable source/notice obligations and commercial license sufficiency remain owner/legal release decisions. A separate service is not an automatic exemption. Paid API access is separate from SDK licensing.

Machine-generated audit evidence never promotes product integrations. Current product states remain NOT_IMPLEMENTED; manual green flags cannot unlock the M0 release gate.
