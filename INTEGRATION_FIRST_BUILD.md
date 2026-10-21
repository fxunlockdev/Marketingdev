# Integration-first build contract — not a frontend prototype

**Priority: P0. Read this before writing UI code.** This contract supplements `PRODUCT.md`, `ARCHITECTURE.md`, and `AGENTS.md`. If implementation decisions conflict, choose the interpretation that demonstrates a **real backend integration** and explicitly disclose blockers instead of substituting mock success.

## A. User's required handover state

The target is a **configured-and-usable self-hosted application**, not a collection of mock pages. After Codex finishes its implementation and passes the live-integration stage, the operator should only need to:

1. Provide legitimate service credentials, billing/top-up and provider-approved app IDs/secrets through a secure setup flow; configure domains, callback URLs and other environment-specific values.
2. Provision/deploy the documented infrastructure (or use the included automated deployment mechanism), connect authorized social accounts, and complete any platform application reviews/OAuth consent.
3. Run an automated readiness check and use the application.

**Do not imply API keys alone solve social OAuth, Postiz tenant isolation, Higgsfield account funding, platform approval, payment setup, DNS/TLS, cloud deployment, or commercial licensing.** Those are real external prerequisites. If users supply them, **no new product feature coding or manual database patches should be needed** to execute the supported launch flows.

Do not claim the app is production-ready until the live smoke suite passes using permitted test credentials, and security/licensing blockers are resolved. Local offline mode is useful for development only.

## B. Definition of integrated / not integrated

| State | Meaning | UI must indicate | Eligible for feature-complete claim? |
|---|---|---|---|
| `NOT_IMPLEMENTED` | UI-only or interface not backed by code | Hidden/disabled | **No** |
| `MOCKED` | Fake service returns deterministic fixtures | Clearly labeled demo/test only | **No** |
| `ADAPTER_READY` | Typed client, validation, persistence, retries, tests against fake/recorded contract | Disabled pending key | **No** |
| `LIVE_VERIFIED` | Verified real provider call + response + persistence + error path in staging | Enabled for test tenancy | **Yes**, for tested capability |
| `LAUNCH_READY` | Live verified + RBAC, budgets, security, rate-limit/recovery, observability and approved external prerequisites | Enabled for allowed tenant(s) | **Yes**, for explicitly scoped release |

**Never mark an integration green based solely on `200` from a mock server.** Preserve fixture/mode metadata in every trace and asset; production must reject `MOCKED` provider results. Never publish using generated sample post IDs.

## C. Backend-first build order (mandatory)

A milestone is built **inside-out**. Codex must proceed for every feature in this order:

1. **Discover actual upstream contract.** Inspect pinned source code + official documentation. Record exact API/SDK method/path, scopes, payload and limits in `docs/PROVIDER_CAPABILITIES.md`.
2. **Implement typed port/adapter.** Add real and test implementations behind the same interface; idempotency, error typing, telemetry, cost accounting and tenant context are mandatory.
3. **Implement persistence and durable workflow.** Add database migrations, job states, encrypted credential references and asset storage. Ensure retries cannot double-charge/double-publish.
4. **Write tests.** Port-level unit/contract tests; integration tests against actual service or sanctioned sandbox when credentials available; failure tests for `401`, `403`, `429`, timeouts, malformed payloads and provider downtime.
5. **Build a minimal real API.** Include schema validation, auth, brand/org authorization, trace IDs, idempotency headers, rate limits, generated API docs.
6. **Only then implement interactive UI.** UI consumes real API state and shows loading/pending/error/retry; no hardcoded statistics, success badges, campaign IDs or preview assets in production mode.
7. **Demonstrate the flow.** Capture a reproducible short script: user action → HTTP request → durable job → real provider or external service → persisted output → user-visible result.

**Stop rule:** If a real adapter cannot be implemented because of an unknown upstream endpoint, impossible tenant isolation, missing permissions or license conflict, document the blocker and do not build a fake 'completed' UI for that capability. Continue other independent features.

## D. Mandatory external adapter matrix and evidence

| Adapter | Code that must exist and run | Required staging success proof | Required failure path |
|---|---|---|---|
| **Crawl4AI** | Domain scope/SSRF-safe crawl; source URL/response metadata, dedupe, crawl report, incremental results | Crawl a permitted public test website, see extracted text/images and exact evidence URLs | Unreachable/forbidden/JS site, robots/rate restrictions, private-IP/redirect rejection |
| **Docling** | Document upload, scan, extraction job, page/slide coordinates/evidence, visual references | Upload actual PDF **and** PPTX fixtures, compare extracted facts and source refs | Corrupt/encrypted/large file; isolated error and resume |
| **Deep Agents Skill Harness** | Content-hash skill import, validated frontmatter, tenant-scoped virtual context, allowlisted typed tools, schema-validated outputs | Run real `social`, `ad-creative`, and `image` skill instructions, log digests and outputs | Forbidden tools, bad skill, missing brand context; no shell/credential leaks |
| **OpenAI GPT Images** | Server-side official SDK, create/edit/reference input, result validation, object-storage copy, per-usage accounting | Real image generation **and edit**; asset reused in editable creative | `401`, `429`, invalid image, high cost, provider timeout |
| **Higgsfield** | Official server-side SDK/API, authenticated asynchronous submit, external job ID, webhook/poll, object-storage copy, timeout/cancellation policy | Real generated clip; callback/poll reconciled; completed video exported through FFmpeg | Rejected model/params, lost webhook, expired URL, provider timeout, ambiguous submit |
| **Fabric.js + FFmpeg** | Persist layer/timeline project JSON, edit, render, preview, deterministic export, import/export | Edit text/logo/image, reload project, re-export; video stitch + captions + watermark | Missing fonts/assets, unsupported codec, renderer OOM |
| **Postiz** | Running self-hosted service, authenticated tenant-safe adapter, connected channel lookup/onboarding, upload, create/schedule, remote ID and status reconciliation | **Real** test social account authorization, publish/schedule approved post, verify remote result; second tenant denied | OAuth callback failure, revoked token, rate limits, duplicate schedule, missing webhook, account B isolation |
| **Langfuse + application learning** | Traces for skill/model/job without secrets; source-specific performance snapshots; insight evidence linkage | Inspect one trace; correlate generated creative, real published post and observed metrics | Missing/unsupported analytics => unknown, never fabricated zero/success |
| **Temporal + storage** | Durable jobs, outbox/idempotency, worker crash replay, private signed object storage, tenant quotas | Kill job worker mid-workflow; recover without duplicate remote side effect | Provider unavailable, DB restart, broken webhooks, insufficient credits |

External APIs are outside our control: do not hardcode unsupported method names or assume video/image endpoints are interchangeable. Generated SDK examples must be checked against pinned official releases.

## E. Provisioning UX: operator keys must be enough *after* prerequisites

Provide one setup interface under `/setup` (restricted to deployment admin), plus `infra/.env.example`, Docker/dev and production infrastructure templates and a **red/yellow/green provider readiness matrix**:

- `OPENAI`: key stored encrypted; supported image API/model validated by a low-cost **opt-in** smoke job.
- `HIGGSFIELD`: exact authentication fields required by the pinned official SDK; funded account, chosen video model, callback/test access; an **opt-in**, capped video smoke job.
- `POSTIZ`: service health, API credential/connector permissions, public callback base URLs, working social developer app + customer OAuth account link. Must test per-tenant ownership. Postiz's SaaS license/legal status reviewed separately.
- `DATABASE/STORAGE/TEMPORAL`: migrations, health checks, workers, private storage, task completion, backups configured.
- `LANGFUSE`: optional integration status; core tasks continue if disabled (graceful observability fallback).
- `BILLING`: payment gateway/webhook and quotas configured before charging real customers.

Every readiness row must show `Unconfigured`, `Configured-unverified`, `Verified`, `Degraded`, or `Blocked`, last-check timestamp, safe reason and operator action. **Never print secrets or raw OAuth responses.** Recheck on credential change; cache health appropriately without burning paid generations on every page load.

### Environment separation and invocation

- `APP_MODE=offline_dev | staging | production` controls whether fake adapters may be registered; production must refuse to boot if any **enabled** feature routes to a mock service.
- `ENABLED_FEATURES` only exposes capabilities whose adapter is `LIVE_VERIFIED` for the target environment and organization.
- `LIVE_SMOKE_ENABLED=false` default. A deliberate operator action with a stated cost cap runs real generation/scheduling tests.
- `PROVIDER_BUDGET_USD`, per-tenant max in-flight jobs and per-feature daily limits protect money and throughput.
- `POSTIZ_TENANT_STRATEGY` explicitly records a *proven* account/workspace boundary, not `shared_global_key` by default.

## F. Required executable scripts to create in the codebase

**These are deliverables Codex must implement—this handoff is a specification, not a finished runnable codebase.** Names may be adapted but command equivalents must exist and be documented:

```bash
make dev                 # Starts Postgres, Temporal, mock providers, workers, application
make verify-offline      # Test all local product flows end-to-end with marked fakes
make verify-contracts    # Validate SDK/adapter contracts against pinned versions
make verify-live         # Guarded real provider + Postiz staging-account smoke suite
make verify-security     # RLS, SSRF, tenant, secrets, OAuth boundary tests
make verify-load         # Reproducible user/job load profile; results artifact
make release-gate        # Non-zero exit on any launch-blocking failure
```

`make verify-live` must be protected: require `APP_MODE=staging`, explicit acknowledgment/cost limit, sandbox/test organizations and allowlisted social accounts. It must not publish to unknown channels or accidentally spend advertising budget.

`release-gate` evaluates machine-readable `docs/evidence/integration-status.json`, test results and safety checks. No README statement can override a failing gate.

## G. No-frontend-theater policy (testable)

Reject PRs that:

- Create polished dashboard views before matching endpoints/database/models/tests exist.
- Render social/marketing analytics from constants or generated placeholder values while appearing live.
- Use canned stock/sample creative assets as though generated by the configured model.
- Use fake post IDs, synthetic schedule statuses, optimistic *published* states, or static 'connected' badges.
- Add buttons that do not persist changes, invoke a worker, or perform the claimed operation.
- Route provider secret-bearing calls from browser code.
- Depend on CLI coding-agent invocation at runtime, or expose Postiz's web UI to end customers.
- Bypass legal/product limitations by saying an upstream service must be customized 'later' while marking the feature done.

Allow visual mockups only within `storybook`/design preview with a visible **SAMPLE DATA** designation and no connection to production routes.

## H. Real launch tests — user journeys, not API screenshots

1. Fresh customer signs up → enters website → background crawl shows provenance → corrects finding → uploads guideline PDF and PPTX → resolves conflict → activates approved profile.
2. Customer asks for five LinkedIn posts and images → actual `SKILL.md` load recorded → OpenAI creates image → change text/logo/crop in editor → edits persist after refresh → human approves.
3. Customer authorizes one eligible social account → schedule post → server submits via Postiz → application distinguishes `scheduled`, `publishing`, `published`, `failed`, `unknown` using real remote events.
4. Customer generates a Higgsfield video ad → durable remote job → download and compose → scene replacement → approved asset exported from private storage.
5. Analytics appear **only if real metrics exist**, linked to their creative version; learning recommendation cites those observations.
6. Two independent organizations exercise all the above simultaneously; neither sees/can reference/publish the other's data, files, embeddings, credentials or social accounts.
7. Provider outages, expired tokens and delayed callbacks produce recoverable status and support logs, not silent success.

**Operator signoff:** attach an evidence package: test invocation/exit code, redacted logs and trace IDs, provider billing evidence (without secret fields), published test post identity, screenshot or video of UI, and exact commit/SDK versions. User approval is required for enabling paid advertising or any spending automation.

## I. Codex iteration and token discipline

- **One vertical slice at a time.** Never ask a coding agent to implement the entire front end in one uninterrupted attempt.
- Before each PR, name the exact real business action, provider/DB boundary, measurable acceptance criteria and dependencies. Only write what is necessary to pass the criteria.
- For failed tests, diagnose the actual root cause and fix it; don't switch to fixture-driven success.
- Every session starts by reading `docs/BUILD_STATE.md`, runs the smallest relevant test set, and appends verified facts plus exact next task. This avoids repeated planning and hallucinated progress.
- Keep each milestone demonstrable before adding visual polish; reuse tested backend ports from earlier milestones.
- Codex should work autonomously within the available repo and test environment; ask for credentials, approvals or legal decisions **only when genuinely externally blocked**. Don't ask the operator to hand-code missing integrations.
- Where internet/vendor credentials are unavailable, complete the adapter + tests + documentation and mark `ADAPTER_READY`, not `LIVE_VERIFIED`. Resume live validation as soon as the operator provides test credentials.

## J. Integration evidence file (example; expected to be generated by code)

```json
{
  "schema_version": 1,
  "git_commit": "<commit>",
  "checked_at": "<ISO8601>",
  "environment": "staging",
  "providers": {
    "openai_images": {"status": "ADAPTER_READY", "live_test": false},
    "higgsfield_video": {"status": "ADAPTER_READY", "live_test": false},
    "postiz_publish": {"status": "ADAPTER_READY", "live_test": false},
    "crawl4ai": {"status": "NOT_IMPLEMENTED", "live_test": false},
    "docling": {"status": "NOT_IMPLEMENTED", "live_test": false}
  },
  "security": {"tenant_isolation_passed": false, "secret_scan_passed": false},
  "release_gate": "BLOCKED"
}
```

These example values are **not** claims of implementation. Replace them with test-generated verified evidence, never by manually changing green flags.
