# Desvio

Multi-tenant marketing: confirm a brand, create, revise, approve, publish and learn from observed results.

**Implementation in progress. PR-00 / M0 audit infrastructure only. No product feature is live-verified or launch-ready.** Supplied specifications describe requirements, not implemented capabilities.

Read `docs/BUILD_STATE.md`, `docs/adr/0001-reuse-decisions.md`, `docs/PROVIDER_CAPABILITIES.md` and `docs/PRODUCT_EXPERIENCE.md`.

## Reproduce M0

Requires Node 22+, Python 3.12 and uv:

```sh
make bootstrap
make verify-offline
make verify-contracts
make verify-security
make release-gate
```

Verification targets currently exercise M0 import/middleware/SDK/guard probes only, not product E2E. The release gate must fail until trusted live evidence and complete implementation exist. `verify-live` is guarded and NOT run against providers without explicit staging consent, finite cost cap and exact account allowlists. `dev` and `verify-load` explicitly report not implemented at M0.

Original skills ZIP preserved and checksum-verified; 66 bundled CLI scripts are never executed. No keys belong in this repository. The owner-supplied Railway environment is named production, but these resources are internal engineering infrastructure, not an activated customer product.

Build sequence: M0 audit → M1 auth/tenant/storage/jobs → M2 brand intake/verification → M3 skills/image/edit/approve/publish → M4 video/analytics → M5 learning/billing/security/operations. Paid ad execution is separately gated.
