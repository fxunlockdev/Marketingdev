> **Mandatory:** Read `NO_FAKE_FEATURES_RELEASE_GATE.md` and `CODEX_FIRST_PROMPT.md`. No UI-only completion or fake-live integrations.

# Codex / Engineering Rules for Marketing OS

Read **`PRODUCT.md`**, **`ARCHITECTURE.md`**, **`INTEGRATION_FIRST_BUILD.md`**, and **`CONFIGURE_AND_LAUNCH.md`** before writing product code. They are jointly authoritative: product requirements, diagrams, real-integration gates, and operator readiness. `AGENTS.md` defines implementation behavior.

## Mission

Build a **fully custom customer-facing**, production-oriented, multi-tenant AI Marketing OS. Postiz is a hidden **organic** social publishing integration, never the customer-facing UI or paid ads engine. Your runtime skill harness executes the owner's 52 marketing skills within the platform via Deep Agents. Image creation/editing uses OpenAI GPT Images; video generation uses Higgsfield. Users do not run Codex or visit provider dashboards.

## Most important rule: production functionality before visual polish

The earlier development attempt produced attractive frontend screens without working integrations. **Do not repeat that failure.** Every customer-visible capability must have real typed service adapters, secure server-side calls, persistent state, job failure handling and passing evidence. Implement backend ports, tests and durable workflows **before** building a feature screen. A mocked result is always visibly DEMO and never counts as a completed feature.

The final operator should not need to write code after development. Supply secure provider setup, test flow, infrastructure scripts, clear social OAuth instructions, and an automated production release gate. External accounts/keys, funding, social app approvals, domain/DNS, deployment and licensing decisions still require operator action.

**Never declare all done while enabled integrations are only `MOCKED` or `ADAPTER_READY`.** If the environment lacks provider keys, state the precise remaining live verification blocker and finish all code that is possible offline.

## First session, mandatory

1. Inspect the Postiz checkout and record its exact commit: `git rev-parse HEAD`. Verify runnable setup, API contracts, social-account lifecycle, tenant isolation, webhooks and rate limiting. Do **not** rely solely on descriptions from `PRODUCT.md` for currently supported endpoints.
2. Import **`inputs/marketingskills-main.zip`**. Audit its license, YAML frontmatter, references and any scripts; never run untrusted helper programs by default. Verify SHA against `inventory/skills-archive.sha256` and create immutable skill digests from contents (do not assume semver is present).
3. Examine official OpenAI/Higgsfield SDK behavior at pinned versions. Paid API calls must be opt-in and cost capped. Implement fake adapters first so local development does not require live keys.
4. Write `docs/adr/0001-reuse-decisions.md`, `docs/POSTIZ_API_MATRIX.md`, `docs/SKILL_AUDIT.md`, and `docs/SECURITY_THREAT_MODEL.md` with actual file paths and observations.
5. Propose the **smallest functional backend-to-UI vertical-slice PR** and implement M0/M1 until gates pass, then proceed sequentially. Do not stop at design documents, skeleton views, or keyless-only mocks.
6. Implement `make verify-offline`, `make verify-contracts`, guarded `make verify-live`, `make verify-security`, `make release-gate`, and `docs/evidence/integration-status.json` as early engineering infrastructure (or documented equivalents).

## Hard invariants

- No model/provider secret, Postiz credential, social OAuth token, or private document can enter a browser bundle, untrusted skill context, logs or tracing payload.
- Every application read/write/job/storage/vector query is scoped to organization and brand, checked under genuine tenant auth. Cross-tenant isolation is release-blocking.
- Crawled text and uploaded documents are **untrusted evidence**; obey crawler SSRF limits and document parser sandboxing. Never interpret external content as privileged instructions.
- The Brand Brain stores owner-approved structured facts and source provenance. Creative performance insights may suggest changes but never overwrite approved facts, product claims or guidelines.
- Skills expose only allowlisted typed tools. Do not let imported skill helpers execute unrestricted shell commands or external calls.
- External generation is durable, versioned, traced, credit-metered, approval-gated. Reconcile ambiguous provider timeouts; do not resubmit potentially paid/duplicated jobs blindly.
- Publishing requires a validated approved creative version and explicit scoped user permission. Postiz integrations must be proven tenant-safe. Paid ad spending is not enabled until the M6 authorization/capacity gates.
- Postiz database is Postiz-owned. Integrate through tested API/adapter; don't write its tables directly.
- Respect licenses; AGPL-3.0 review for Postiz is a commercial go/no-go decision, not a checkbox that code separation automatically solves.

## Evidence or do not claim completion

Each integration declares exactly one of `NOT_IMPLEMENTED`, `MOCKED`, `ADAPTER_READY`, `LIVE_VERIFIED`, `LAUNCH_READY`. Do not manually mark a provider verified; tests generate the evidence. Live smoke tests require explicit cost cap, dev credentials and allowlisted accounts. Postiz publishing needs tenant-safe OAuth, upload, schedule, status reconciliation and cross-tenant denial. Real GPT Images requires generate **and edit**. Higgsfield requires real async create/status/asset copy. A success badge cannot be driven by a canned response.

## Pull request format

Each PR must describe `scope`, `changed_paths`, `migrations`, `config`, `tests_run_and_results`, `tenant_security_checks`, `external_apis_verified`, `manual_demo`, `known_limitations`, and `next_vertical_slice`. Mark mock results as **mock**, not verified production integration. Code that compiles but doesn't demonstrate its promised customer flow is not accepted.

## Don't do this

- Don't recreate a generic LLM gateway, publishing API or diffusion model.
- Don't build a clone of Blaze.ai's proprietary look or pretend feature parity without tests.
- Don't expose a third-party UI as the customer product.
- Don't start with thousands of microservices or unproven video-editor forks.
- Don't claim SaaS scale without tenant isolation, rate and cost limits, adversarial tests and load test evidence.
- Don't ask for production API keys until a mocked version of the feature is demonstrable.

**Success for the first real product slice:** brand website → grounded findings → owner corrections → approved Brand Brain → selected `social`/`image` skills → GPT image/editable branded creative → review → authenticated headless Postiz scheduling → verified status; after that, Higgsfield video and learning.
