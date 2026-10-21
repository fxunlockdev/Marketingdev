# Desvio build state

Updated 2026-10-21 (Asia/Kuala_Lumpur). Active end-to-end goal; M0 blockers remain and initial M1 workspace backend is implemented locally. Prior goal turn was progress: audit PR #1 was created and temporary infrastructure access was cleaned up.

## Owner decisions

- Product name Desvio; multiple client tenants from the foundation.
- Authorized Postiz clone and setup in supplied Railway project.
- Authorized continuing end-to-end beyond initial M0 checkpoint.
- Brand-specific OpenAI/Higgsfield generation, revision, approval and social publication required.
- Working defaults: English, LinkedIn first then Instagram, human approval before publication.
- No paid/live social tests without explicit staging credentials, budget and exact allowlists.

## Code and evidence

Repo checkout: this directory (work/Marketingdev in the chat workspace). Branch codex/pr-01-tenant-foundation, stacked on codex/pr-00-integration-audit. Draft PR-00: https://github.com/fxunlockdev/Marketingdev/pull/1. Original specs, archive and repository manifest retained.

- scripts/skill_audit.py: safe archive validation, immutable file/skill digests, preserve MIT notice.
- scripts/skill_probe.py: actual Deep Agents middleware discovery with per-run read-only mount.
- tests/contracts/sdk.test.mjs: actual pinned OpenAI/Higgsfield SDKs against MOCK transports.
- scripts/live_guard.py: fail-closed staging consent/cap/allowlist checks; live runner not yet implemented.
- scripts/verify.py and release_gate.py: actual audit-suite evidence; product status stays NOT_IMPLEMENTED.
- docs/adr/0001-reuse-decisions.md, POSTIZ_API_MATRIX.md, PROVIDER_CAPABILITIES.md, SKILL_AUDIT.md, THIRD_PARTY_LOCK.md, SECURITY_THREAT_MODEL.md, PRODUCT_EXPERIENCE.md.

Final session verification: verify-offline compiled the API and passed 3 skill tests; verify-contracts passed 8 mocked SDK tests; verify-security passed 14 real local HTTP/PostgreSQL foundation tests plus 6 audit/guard tests (31 tests total). release-gate exits nonzero as intended. verify-live was NOT run. npm audit reports zero known vulnerabilities in the locked npm tree; this is not Python/container or full security clearance. Machine evidence identifies implementation commit 99828c0 and the source fingerprint.

## M1 progress this session

- apps/api/src/: NestJS + Better Auth, genuine cookie sessions, client workspace ownership, brand list/create/read/edit, strict origin/body checks, database-backed auth throttle and safe errors.
- database/migrations/: generated pinned-auth schema and product schema; separate least-privilege roles, forced RLS, limited bootstrap function, immutable audit records, idempotent creates and pending outbox events.
- scripts/migrate.mjs: transactional, checksum-verified/replay-safe migrations.
- tests/foundation/tenancy.test.mjs and scripts/foundation-test.mjs: disposable pinned PostgreSQL + actual HTTP integration tests. 14 passed in the final verify-security run, including partial PATCH preservation/clearing, cross-brand scope and restart recovery. Test containers were removed after completion.
- docs/adr/0002-auth-and-tenancy.md records source contracts, actual routes and threat boundaries.
- Session revocation and client/brand isolation are demonstrated for these local paths only. No private storage/worker/provider authorization claim.
- External auth activation intentionally fails closed pending email verification/recovery. No customer UI, invitations or dispatched jobs yet; outbox events are persisted, not processed.

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

These do not prevent independent M1 implementation. The local workspace_auth capability is machine-reported ADAPTER_READY after the scoped security suite; the wider tenant_runtime and provider journeys remain incomplete. No feature is LIVE_VERIFIED or LAUNCH_READY.

## Next implementation work — finish M1, then PR-02

Verification passed within the scopes above; PR-01 is being saved as a stacked draft. Next implement verified email/password recovery and secure invitations, private storage with tenant-scoped signed access, Temporal/outbox dispatch and scoped durable jobs, plus API quotas/observability. Extend negative tests across jobs/assets and restart boundaries. Then build the minimal backed sign-in/workspace/brand UI and continue PR-02 intake/findings/Correct-Wrong-Edit/immutable approved Brand Brain. Full creative revision, approval and real social publishing goal remains intact.

Continue work without asking product questions or provider keys prematurely. Keep the active goal honest and do all independent offline implementation before external live-test handoff.
