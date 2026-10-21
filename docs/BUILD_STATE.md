# Desvio build state

Updated 2026-10-21 (Asia/Kuala_Lumpur). Active end-to-end goal; M0 blockers remain and initial M1 workspace backend is implemented locally. Prior goal turns implemented client/workspace/brand accounts and invitations. This session adds the backed customer account/client/brand/team/file interface; the full generation/revision/publication goal remains active.

## Owner decisions

- Product name Desvio; multiple client tenants from the foundation.
- Authorized Postiz clone and setup in supplied Railway project.
- Authorized continuing end-to-end beyond initial M0 checkpoint.
- Brand-specific OpenAI/Higgsfield generation, revision, approval and social publication required.
- Working defaults: English, LinkedIn first then Instagram, human approval before publication.
- No paid/live social tests without explicit staging credentials, budget and exact allowlists.

## Code and evidence

Repo checkout: this directory (work/Marketingdev in the chat workspace). Branch codex/pr-04-customer-workspaces, stacked on codex/pr-03-private-assets-jobs. Draft PR-00: https://github.com/fxunlockdev/Marketingdev/pull/1. Original specs, archive and repository manifest retained.

- scripts/skill_audit.py: safe archive validation, immutable file/skill digests, preserve MIT notice.
- scripts/skill_probe.py: actual Deep Agents middleware discovery with per-run read-only mount.
- tests/contracts/sdk.test.mjs: actual pinned OpenAI/Higgsfield SDKs against MOCK transports.
- scripts/live_guard.py: fail-closed staging consent/cap/allowlist checks; live runner not yet implemented.
- scripts/verify.py and release_gate.py: actual audit-suite evidence; product status stays NOT_IMPLEMENTED.
- docs/adr/0001-reuse-decisions.md, POSTIZ_API_MATRIX.md, PROVIDER_CAPABILITIES.md, SKILL_AUDIT.md, THIRD_PARTY_LOCK.md, SECURITY_THREAT_MODEL.md, PRODUCT_EXPERIENCE.md.

Previous account session verification: verify-offline compiled the API and passed 3 skill tests; verify-contracts passed 8 mocked SDK tests; verify-security passed 24 actual local HTTP/PostgreSQL/SMTP tests plus 6 audit/guard tests (41 tests total). release-gate exits nonzero as intended. verify-live was NOT run; no real emails, paid providers or social accounts were contacted. npm audit reports zero known vulnerabilities in the locked npm tree; this is not full security clearance. Machine evidence identifies implementation commit e190596 and the source fingerprint.

## Current customer-experience session

- apps/web implements Next.js/React screens for sign-up/verification/sign-in/recovery, client/brand switching, brand details, team/invitations/role management and private file upload/status/download/cancel.
- apps/api/src/assets.ts now includes the scoped job ID/cancel status in saved asset lists so UI controls work after reload. Existing server authorization/RLS remains authoritative.
- UI preserves failed/stale edits, supports reauthentication in another tab, uses idempotency for supported creates, keeps invitation fragments through account access and warns before navigating away from unsaved brand edits/in-flight uploads. No browser-local secret/token/file persistence.
- scripts/foundation-test.mjs --web plus tests/browser/customer.test.mjs builds the actual app and tests it through Chromium against real disposable local services. Eight browser flows have passed, including new-invitee account creation, multi-client switching, session expiry/recovery and scoped axe/mobile/keyboard checks. Final source-bound evidence passed at implementation commit 6dc225a: verify-offline, verify-contracts, verify-security and verify-browser all pass (56 total tests: 3 skill, 8 mocked SDK, 24 account/tenant, 7 asset/worker, 6 guard/audit, 8 genuine browser journeys). All four fingerprints match current code. release-gate remains BLOCKED as intended. verify-live was NOT run. npm audit reports zero known vulnerabilities, not full security clearance.
- Nonce-based CSP, no-referrer/no-store, semantic controls, visible focus and responsive layout are implemented. Native controls use the selected fixing-accessibility skill. Screenshots were inspected and mobile naming/layout issues fixed.
- docs/adr/0005-customer-workspace-ui.md records public routes, build/runtime settings, scoped proof and deployment gaps. Production ingress/IP forwarding/rate limits, cloud CORS and external email remain unverified. No provider-generation/publication controls or fake metrics exist.
- Previous turn made concrete progress: PR #4 added and proved local private uploads/worker recovery. Current work continues the full end-to-end goal without calling M1 production-ready.

## Previous private-assets session

- Migration 003 adds assets/jobs/dispatch with forced RLS, a dedicated scoped worker login and a separate dispatcher login. Existing migrations are unchanged.
- apps/api/src/assets.ts and app.ts implement authenticated reserve/list/complete/download/abandon/job-status/cancel routes. Signed uploads are quarantined; strict size/type/hash checks, pending/daily/storage quotas and idempotent submission are backed by transactions.
- object-store.ts and file-validation.ts use the actual pinned S3 SDK, ClamAV protocol and image decoder. PDF/PPTX checks are structural; document extraction/sandboxing is NOT implemented.
- jobs.ts, asset-workflow.ts and worker-main.ts implement real Temporal dispatch, bounded validation retries, cancellation, permission rechecks and saved failure status. Actual worker-process death recovered successfully in local tests.
- tests/foundation/assets.test.mjs and scripts/storage-test-services.mjs use real local Garage, ClamAV with full official signatures and Temporal server. All seven new tests passed alongside all 24 existing account tests. Final verify-offline, verify-contracts and verify-security passed: 48 tests total (3 skills, 8 mock SDK contracts, 24 account/tenant, 7 actual asset/storage/worker, 6 audit/guard). Evidence is generated against implementation commit 862c944 with matching source fingerprints. release-gate fails as intended; verify-live was NOT run. npm audit reports zero known vulnerabilities; this does not clear native/container dependencies or production security.
- Garage was observed to ignore conditional PUT headers. Canonical keys now include the verified hash; the writer checks key/hash/bytes identity and existing bytes. Corrected the EICAR fixture to its standard standalone test string. Neither issue was masked with a passing flag.
- docs/adr/0004-private-assets-and-durable-validation.md records storage contracts, bearer-link expiry, cleanup/retention limits, local-only proof and configuration. Production provisioning, private IAM/CORS/TLS, orphan cleanup, customer UI and intake remain unfinished.
- API and worker config readers are separated so neither requires the other process’s DB credentials. All owned test services were cleaned up after final verification.
- No paid providers, external sender or social-account tests performed. No LIVE_VERIFIED / LAUNCH_READY claim.

## Earlier M1 progress

- apps/api/src/: NestJS + Better Auth, genuine cookie sessions, client workspace ownership, brand list/create/read/edit, strict origin/body checks, database-backed auth throttle and safe errors.
- database/migrations/: generated pinned-auth schema and product schema; separate least-privilege roles, forced RLS, limited bootstrap function, immutable audit records, idempotent creates and pending outbox events.
- scripts/migrate.mjs: transactional, checksum-verified/replay-safe migrations.
- tests/foundation/tenancy.test.mjs and scripts/foundation-test.mjs: disposable pinned PostgreSQL + actual HTTP integration tests. The expanded suite now passes 24 tests, retaining partial PATCH preservation/clearing, cross-brand scope and restart recovery coverage. Test containers were removed after completion.
- docs/adr/0002-auth-and-tenancy.md records source contracts, actual routes and threat boundaries.
- Session revocation and client/brand isolation are demonstrated for these local paths only. This earlier suite did not establish private storage/worker/provider authorization; current local asset-worker evidence is scoped separately above.
- apps/api/src/mail.ts: AES-GCM email queue, dedicated SMTP worker with leases, bounded retry after explicit rejection and unknown state after ambiguous send/worker loss. Actual local SMTP tests; no external email sent.
- apps/api/src/team.ts and migration 002_mail_and_invitations.sql: scoped, recipient-bound invitations; hashed tokens; idempotency; sender-role recheck; replacement/revocation; race-safe owner and role rules; daily invite cap.
- auth.ts now requires email verification, uses transactional password reset with session revocation, and contains raw upstream errors. Account flows use the genuine pinned library and actual local SMTP.
- docs/adr/0003-account-email-and-team-access.md records contracts, server settings and limits.
- Final foundation suite passed 24 tests, including daily-cap races, SMTP uncertainty, reset rollback and sanitized error logging. No customer account/team UI yet. Production activation still fails closed; staging sender/ingress/deployment remain unverified.
- Mail queue dispatch is implemented. Brand-event outbox / paid Temporal generation jobs are still pending; the new asset-validation dispatch is separate.

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

## Next implementation work — backed M1 UI, then brand intake

Verification passed within the scopes above; PR-01 is a stacked draft at https://github.com/fxunlockdev/Marketingdev/pull/2 (base PR-00). Account verification/recovery/invitation backends are now implemented; PR-02 is a stacked draft on PR-01: https://github.com/fxunlockdev/Marketingdev/pull/3. Private storage and asset-validation Temporal dispatch are implemented locally in PR-03; machine evidence passes at its local scope; PR-03 is a stacked draft on PR #3: https://github.com/fxunlockdev/Marketingdev/pull/4. Broader API quotas/observability and production storage remain pending. Account/team/workspace/files UI now has real local browser coverage in PR-04; evidence is complete locally; PR-04 is a stacked draft on PR #4 at https://github.com/fxunlockdev/Marketingdev/pull/5. Proceed directly to website/document intake and approved Brand Brain. External sender/deployment validation remains open. Extend negative tests across jobs/assets and restart boundaries. Then continue website/PDF/PPTX intake, Correct/Wrong/Edit findings and immutable approved Brand Brain. PR numbering has expanded to keep the M1 account work reviewable; the later onboarding scope is unchanged. Full creative revision, approval and real social publishing goal remains intact.

Continue work without asking product questions or provider keys prematurely. Keep the active goal honest and do all independent offline implementation before external live-test handoff.
