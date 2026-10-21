# Release gates

Current milestone M0. Audit suite success is not product success. Machine evidence records NOT_IMPLEMENTED for all product integrations.

- verify-offline: archive/middleware/reference probes only; later expand to product journeys.
- verify-contracts: pinned real SDKs, MOCK transports only; later schema, Postiz and provider-negative coverage.
- verify-security: importer/mount/live guard only; RLS/SSRF/auth/OAuth/secret scans remain false.
- verify-live: protected by staging mode, explicit consent, finite cap and exact org/brand/account allowlists. Runner absent at M0; always nonzero. NOT invoked this session.
- release-gate: schema/freshness/source fingerprint checks, then explicit missing product/live-runner block. Manually editing flags cannot pass.
- dev/load: explicitly not implemented, never fake a passing command.

Next milestones must replace these limited probes with trusted generated proof of actual capability, preserve all negative cases, bind evidence to tested code/dependencies/environment and prevent stale or untrusted live reports. Production exposure requires LIVE_VERIFIED then LAUNCH_READY with real tenancy, costs, recovery, legal and operational prerequisites.
