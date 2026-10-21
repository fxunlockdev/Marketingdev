# Desvio build state

Updated 2026-10-21 (Asia/Kuala_Lumpur). Active end-to-end goal; PR-00/M0 in progress.

## Owner decisions

- Product name Desvio; multiple client tenants from the foundation.
- Authorized Postiz clone and setup in supplied Railway project.
- Authorized continuing end-to-end beyond initial M0 checkpoint.
- Brand-specific OpenAI/Higgsfield generation, revision, approval and social publication required.
- Working defaults: English, LinkedIn first then Instagram, human approval before publication.
- No paid/live social tests without explicit staging credentials, budget and exact allowlists.

## Code and evidence

Repo checkout: this directory (work/Marketingdev in the chat workspace). Branch codex/pr-00-integration-audit. Original specs, archive and repository manifest retained.

- scripts/skill_audit.py: safe archive validation, immutable file/skill digests, preserve MIT notice.
- scripts/skill_probe.py: actual Deep Agents middleware discovery with per-run read-only mount.
- tests/contracts/sdk.test.mjs: actual pinned OpenAI/Higgsfield SDKs against MOCK transports.
- scripts/live_guard.py: fail-closed staging consent/cap/allowlist checks; live runner not yet implemented.
- scripts/verify.py and release_gate.py: actual audit-suite evidence; product status stays NOT_IMPLEMENTED.
- docs/adr/0001-reuse-decisions.md, POSTIZ_API_MATRIX.md, PROVIDER_CAPABILITIES.md, SKILL_AUDIT.md, THIRD_PARTY_LOCK.md, SECURITY_THREAT_MODEL.md, PRODUCT_EXPERIENCE.md.

Observed tests: verify-offline 3 passed, verify-contracts 8 passed, verify-security 6 passed. Scope is M0 audit only; no product E2E/RLS/SSRF claim. release-gate exits nonzero as intended. verify-live was NOT run. npm audit reports no known vulnerabilities for its 30 audit packages only.

## Railway

Project 5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12; supplied environment 0ca68498-6559-4b95-9788-34a5ff703dc0 is named production. Current use is internal engineering only.

Services created: Postgres, Redis, desvio-temporal, desvio-postiz; uploads volume attached. Initial deployments reported SUCCESS. Postiz runtime then failed to start: Temporal auto-setup sample Text search attributes exhaust SQL slots. Changed Temporal to namespace desvio-postiz and SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true; changed Postiz TEMPORAL_NAMESPACE=desvio-postiz. Corrected PORT to 3000 (backend); nginx remains 5000. Corrective Postiz redeploy currently rejected: Deploys have been paused temporarily. Configuration read-back confirms PORT=3000, TEMPORAL_NAMESPACE=desvio-postiz and DISABLE_REGISTRATION=true, but running deployment has not picked up the correction. Runtime health NOT verified. The temporary task SSH public key was removed after the probe failed host verification; host checking was never disabled. No remote command ran through that probe.

Remote Railway MCP became Unauthorized; authenticated local CLI still works. Installed CLI is 5.5.0; npx @railway/cli@5.71.0 supports current API introspection without replacing global install.

Postiz source SHA 651876e24317c2d8e717262cf98267ec6f699180 is Oct 20; pinned official image is Oct 11 with no revision labels. Match source/image before claiming source contracts are deployed. No customer/social account activation.

## Remaining M0 work and blockers

1. Resolve corrective Railway rollout and prove process/API health, not deployment status alone.
2. Establish matching audited Postiz source/container and perform real service A/B API isolation tests.
3. Complete SDK negative/malformed/poll contract coverage and full constrained agent execution experiment; current probe only discovers/reads skills.
4. Complete all adopted container/Python vulnerability/license pins. Commercial Postiz license sufficiency remains owner/legal decision; no supplied commercial grant.

These do not prevent independent M1 implementation. No feature is ADAPTER_READY/LIVE_VERIFIED/LAUNCH_READY.

## Next smallest implementation slice — PR-01

Authenticated user → client organization membership → brand creation → durable audit/job record. Implement auth/session validation, least-privilege Postgres migrations and forced RLS, membership/role checks, private storage and Temporal job boundary. Test two users in distinct organizations and multiple brands; deny foreign IDs across reads/writes/jobs/assets. Build only minimal backed workspace UI after tests. Then PR-02 intake/findings/Correct-Wrong-Edit/immutable approved Brand Brain.

Continue work without asking product questions or provider keys prematurely. Keep the active goal honest and do all independent offline implementation before external live-test handoff.
