# Paste this into Codex as your first instruction

> Build the actual production Marketing OS, not a frontend mock. Read `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `INTEGRATION_FIRST_BUILD.md`, `NO_FAKE_FEATURES_RELEASE_GATE.md`, `CONFIGURE_AND_LAUNCH.md` and inspect the original 52-skill ZIP. I supply the separately cloned, pinned Postiz repository.
>
> **Before coding:** audit Postiz's current connector/OAuth/multi-tenant/API capabilities, licensing, Deep Agents' actual skill support, and the OpenAI/Higgsfield official SDK contracts. Record dependency pins, verified API contracts, tenant risks and external blockers. DO NOT invent endpoints or claim mocked integrations are working.
>
> **Next:** build the smallest functional backend-first vertical slice: authenticated tenant → website crawling + PDF/PPTX brand extraction → user Correct/Wrong/Edit verification → approved Brand Brain → actual skill selection → real OpenAI image create/edit through server keys → persisted editable creative → human approval → consented test social account publish through headless Postiz → genuine status reconciliation. Add provider error handling, durable jobs, idempotency and all tests. Then expand to Higgsfield async video and performance learning, and finally harden for multi-tenant production.
>
> **Critical:** UI comes after its backing backend capability and tests. No placeholder posts, fake live metrics or 'Connected' badges. No customer-facing Postiz/Deep Agents/Codex interfaces. The operator should eventually only provision infrastructure, configure legitimate model/APP/ OAuth credentials, complete app permissions, and use the platform—without writing integrations manually.
>
> Implement and run `make verify-offline`, `make verify-contracts`, `make verify-live` (ONLY once real staging credentials are provided with budget and allowlists), `make verify-security` and `make release-gate`. Write machine-generated evidence to `docs/evidence/integration-status.json`. No feature complete without `LIVE_VERIFIED` and `LAUNCH_READY` where applicable. Do not fake these statuses. Keep `docs/BUILD_STATE.md` updated every work session with code paths, tests, precise blockers and next task. Start with M0 and PR-00, then pause to report evidence and scope before extensive UI work.

## What to attach / provide

- This full package directory, including uploaded skills archive.
- A separate pinned Postiz checkout; Codex must validate its exact commit and AGPL obligations.
- **Only when ready for LIVE testing:** narrowly scoped staging API keys, funded provider accounts, safe test socials and callbacks, cost caps and explicit permission.

## What not to accept as 'complete'

A nice dashboard, API stubs, fixture images/videos, social connections that weren't OAuth-authorized, or adapters never called with genuine test credentials. To reach production, provider tests and approval prerequisites must truly pass.
