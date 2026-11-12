# Desvio

Desvio helps a business establish its visual direction, plan a month of social content, review generated assets and manage publishing. The dashboard, calendar and approvals are the main customer experience. The chat and canvas provide a separate way to create and edit individual assets.

## Current status

This README describes the current source checkout as of 11 November 2026. It is not a claim that every feature is deployed or production-ready. See [BUILD_STATE](docs/BUILD_STATE.md) for chronological checks and [evidence](docs/evidence/) for individual results. Older specification documents may describe superseded providers and journeys.

**Important current limitations:**

- Vecteezy authentication and photo search have passed live checks. Stock selection, acquisition, image-reference transport and persistence have passed local tests with mocked external generation. A live stock-backed creative, grant activation and deployment are still pending.
- The latest recorded deployed access check signed in successfully but returned an empty business list and unavailable business pages. Its cause remains unresolved. Earlier successful page checks do not override this result.
- Full live acceptance of research, mood board revision/approval, monthly generation and calendar review remains outstanding.
- Social publishing requires configured platform credentials, a connected account and explicit permission. A rendered Connect button is not verification of publishing.
- Production readiness, scale, complete visual fidelity and all external-provider journeys are not certified by this document.

## How the customer journey works

1. **First-time onboarding.** Collect business details, customers, preferred look and supporting files. Save progress so customers can return. The current product policy is one account, one business and one social profile.
2. **Business research and knowledge.** Research services process website and uploaded evidence. Brand facts and visual preferences provide context for planning and creation. External research is evidence, not authority to invent product claims.
3. **Mood board.** Present a proposed visual direction with colors, fonts, a static creative and carousel previews. Customers can provide feedback and approve a direction. Onboarding previews are separate from the monthly content allowance. The requested experience allows one feedback revision.
4. **Monthly plan.** Reuse the approved business context and mood board instead of repeating onboarding. Prepare concepts and a social calendar for customer approval before generating the planned assets. The current plan is 20 static posts, 5 carousels and 5 videos per month.
5. **Asset generation and review.** Background jobs generate and store assets. Customers review, request revisions and approve exact saved versions. Editing an approved asset creates a new draft requiring review.
6. **Calendar and publishing.** Approved content can proceed through scheduling and publishing using an enabled, authorized social connection. Failed or uncertain operations require recovery rather than an invented success state.
7. **Custom creation.** Chat captures the request and missing details; the canvas displays results and editing controls. Video creation includes a starting-image choice and an editable prompt before submission. Conversations and creative versions are persisted for return visits.

These describe the implemented workflow structure and intended customer policy. Use the status section above for acceptance limitations. Campaign-named services and database records still support planning internally; those names do not imply customers must manage a separate campaign workflow.

## How an AI request is processed

```text
Web interface
  -> authenticated, business-scoped API
  -> validated request, permissions and allowance checks
  -> durable background job
  -> approved brand context + selected skill instructions
  -> provider request
  -> private asset storage + saved creative version
  -> canvas / approvals / calendar
```

The skill harness runs selected, pinned marketing instructions through an isolated runtime. It supplies context and constraints to supported model calls; it does not train the provider model or permanently upload the entire codebase into it. Model IDs and provider permissions are server configuration, not assumptions based on a product label.

- **OpenAI:** planning, supported research/chat operations and image generation/editing through typed adapters.
- **Runway:** asynchronous video generation, status handling and private output copying. Legacy Higgsfield files remain in the repository and are not evidence of the active video provider.
- **Vecteezy:** server-side stock-photo search and acquisition for creative reference material. See below for the current rollout boundary.
- **Social providers:** Post for Me and Postiz adapters exist. Runtime configuration and connection state determine which integration is used; their presence does not make every platform available.

## Stock imagery and the visual experience

Stock selection uses approved brand facts, visual preferences and the creative brief. The current implementation searches commercial, non-AI photos, selects a relevant candidate or declines unsuitable results, then safely downloads, scans, normalizes and privately stores the image. A normalized reference is passed to the image-editing pipeline alongside customer references.

Source and license records stay internal. The current path rejects assets requiring visible attribution, rather than hiding an attribution obligation. Stock inspiration must not be presented as the customer's actual product, property or customer.

Downloads are bounded by business-specific authorization, expiry and daily limits. The system records acquisition before a billable download and reuses completed copies. An uncertain download is retained for reconciliation instead of being purchased again automatically. Credentials alone do not enable downloads for every business.

Visual principles for further work:

- Use approved business imagery and relevant stock to make mood boards and creative previews useful, not decorative filler.
- Show saved assets promptly; distinguish loading, missing artwork and failed generation.
- Keep image text intentional, legible and editable. Avoid adding long captions as tiny overlays.
- Preserve business-specific colors, typography and taste across generated assets.
- Show genuine job state and label time estimates as estimates. Never fabricate provider progress.
- Keep source metadata out of customer-facing creative controls while preserving it for internal audit.

## Codebase map

| Location | Responsibility |
| --- | --- |
| `apps/web/app/` | Next.js routes, layouts and global visual styles |
| `apps/web/components/` | Dashboard, onboarding, calendar, chat, canvas, review, connections and shared controls |
| `apps/api/src/` | TypeScript API, tenant-scoped services, provider adapters and job handlers |
| `apps/api/src/main.ts` | API entry point |
| `apps/api/src/worker-main.ts` | Background-worker composition |
| `apps/api/src/guided-*.ts` | Guided business, mood board and planning workflows |
| `apps/api/src/monthly-plan-approval.ts` | Monthly plan approval logic |
| `apps/api/src/chat-*.ts` | Conversation contracts, persistence and execution |
| `apps/api/src/creative-*.ts` | Creative planning, generation, versions, exports and budgets |
| `apps/api/src/carousel-*.ts` | Carousel planning and generation |
| `apps/api/src/video-*.ts` | Video setup, jobs, rendering, storage and publication checks |
| `apps/api/src/stock-*.ts`, `vecteezy-client.ts` | Stock search, selection, acquisition and private references |
| `apps/skills/` | Isolated marketing skill runtime |
| `apps/ingestion/`, `apps/website-renderer/` | Document and website processing |
| `apps/media/`, `apps/video/` | Media processing and rendering support |
| `database/migrations/` | Ordered schema changes, permissions and row-level security |
| `infra/` | Deployment, worker control and infrastructure support |
| `scripts/` | Configuration, verification and operational tooling |
| `tests/contracts/` | Adapter and boundary tests, commonly with mocked transports |
| `tests/foundation/` | Database-backed workflow and integration tests |
| `docs/` | Architecture decisions, operational notes and test evidence |
| `inputs/`, `inventory/`, `vendor/` | Supplied material, skill inventory and dependencies |

## Runtime and data safety

The web app uses Next.js and React; the API and workers use TypeScript. PostgreSQL stores accounts, scoped business data, job state and creative history. Temporal supports durable workflows. Private S3-compatible object storage holds media. Python services support ingestion and the skills runtime. Media processing includes validation, scanning and rendering.

- Tenant authorization and database row-level security constrain data access.
- Provider credentials remain server-side and must never enter browser code, prompts or logs.
- Uploaded and crawled material is untrusted input.
- Generation is versioned and metered. Ambiguous external requests must not be blindly retried.
- Approval applies to a specific saved version, not every future edit.
- Publishing is separate from generation and requires the appropriate authorization.

## Local setup and verification

Prerequisites: Node.js 22+, Python 3.12, uv and Docker. See [configuration and launch](CONFIGURE_AND_LAUNCH.md) for operational prerequisites. Do not copy production secrets into this repository.

```sh
make bootstrap
npm run build
npm run build:web
```

Useful checks:

```sh
npm run test:contracts
npm run test:foundation
npm run test:browser
make verify-security
make release-gate
```

Focused stock checks:

```sh
node scripts/foundation-test.mjs --stock-acquisitions
node scripts/foundation-test.mjs --stock-creative
node scripts/foundation-test.mjs --operator
```

Foundation tests provision disposable local infrastructure; they do not target Railway. Provider mocks in those tests do not prove live provider behavior. `make local` (or `node scripts/local-stack.mjs start`) runs the whole product on this machine with mock or live providers; see [docs/LOCAL_RUN.md](docs/LOCAL_RUN.md). `npm run dev:web` starts only the web development server, not the backend infrastructure.

Live tests require the repository's staging safeguards and provider authorization. Do not run social publication tests on customer accounts without explicit authorization. The release gate should fail when required evidence is missing.

## Configuration and deployment

Stock credentials are `VECTEEZY_API_KEY` and numeric `VECTEEZY_ACCOUNT_ID`. Video credentials include `RUNWAYML_API_SECRET`. Keep values in the appropriate server/worker secret settings, never in README files or customer-visible configuration.

Provider credentials, business grants, database migrations, worker deployment and web/API deployment are separate concerns. A saved Railway variable does not prove the running worker has received it. Changes need exact deployment observation and a live acceptance check.

`scripts/configure-providers.mjs` supports previewed, audited operator configuration. Stock grants require explicit AI-use authorization and bounded expiry/download allowances. Workspace defaults can provision scoped authorization for newly created businesses. They do not retroactively activate all existing businesses.

## Latest checks relevant to stock

- Live Vecteezy account authentication and photo search: HTTP 200; search returned 11 records.
- Focused creative/stock adapter contracts: 25 passed with mocked provider transport.
- Stock acquisition database tests: 2 passed, including isolation, quota races and recovery.
- Full stock CreativeJobs fixture: 1 passed using real disposable database/storage and isolated skills, with mocked vendor/model responses; replay did not download or generate twice.
- Operator configuration suite: 15 passed, including stock authorization and inheritance.

Live stock download-to-creative output inspection and rollout remain pending. This README update does not deploy the feature or certify the whole application.
