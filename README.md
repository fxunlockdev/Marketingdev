# Desvio

Multi-tenant marketing: confirm a brand, create, revise, approve, publish and learn from observed results.

**Implementation in progress. M0 audit and M1 workspace/account backend. No product feature is live-verified or launch-ready.** Supplied specifications describe requirements, not implemented capabilities.

Read `docs/BUILD_STATE.md`, `docs/adr/0001-reuse-decisions.md`, `docs/PROVIDER_CAPABILITIES.md` and `docs/PRODUCT_EXPERIENCE.md`.

## Reproduce verification

Requires Node 22+, Python 3.12, uv and Docker (for disposable local PostgreSQL tests; SMTP tests start their own loopback listener):

```sh
make bootstrap
make verify-offline
make verify-contracts
make verify-security
make release-gate
```

Verification covers M0 import/middleware/SDK/guard probes and real local HTTP sign-in, workspace/brand persistence, PostgreSQL isolation, safe retries, edit conflicts, restart recovery, verified email, password recovery, client invitations and SMTP failure handling. It does not prove the full product or external providers. `npm run build && npm run test:foundation` runs just the foundation suite, creating and removing its own isolated database; it never targets Railway. The release gate must fail until trusted live evidence and complete implementation exist. `verify-live` is guarded and NOT run against providers without explicit staging consent, finite cost cap and exact account allowlists. Full-stack `dev` and `verify-load` remain incomplete.

Read `docs/adr/0002-auth-and-tenancy.md` and `docs/adr/0003-account-email-and-team-access.md` for roles, routes, migrations and remaining blockers. Email verification is now required; recovery and invitation backends are implemented. Tests contact a local SMTP fixture only. Production remains blocked by the complete release gate. External sender validation, deployment and customer UI are not complete.

Original skills ZIP preserved and checksum-verified; 66 bundled CLI scripts are never executed. No keys belong in this repository. The owner-supplied Railway environment is named production, but these resources are internal engineering infrastructure, not an activated customer product.

Build sequence: M0 audit → M1 auth/tenant/storage/jobs → M2 brand intake/verification → M3 skills/image/edit/approve/publish → M4 video/analytics → M5 learning/billing/security/operations. Paid ad execution is separately gated.
