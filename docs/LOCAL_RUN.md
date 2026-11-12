# Run Desvio locally

`node scripts/local-stack.mjs start` runs the whole product on this Mac and prints the
URL to open (default `http://127.0.0.1:3000`). Everything listens on `127.0.0.1` only and
runs with `APP_MODE=development`. Nothing here talks to Railway.

## Prerequisites

- Docker Desktop running (the worker starts its sandboxes on the local Docker daemon).
- Node and `npm ci` done (`make bootstrap`), `uv` and `python3` (document image fixtures).
- Private inputs in `inputs/`: `desvio-production.zip`, `brand-engine-gpt-2k.zip`,
  `marketingskills-main.zip`. The start command sets `desvio-production.zip` to mode 644
  so the image build can read it.
- Cached Debian packages in `work/document-deps-<arch>` (and `work/video-deps-<arch>` for
  `--with-video`). A fresh checkout cannot download all of the pinned packages any more.
- Network on the first run: Docker base images, the pinned Temporal CLI (checksum-verified)
  and ClamAV signatures. Later starts reuse images.
- About 10 GB free Docker disk for the sandbox images.

## Commands

| Command | What it does |
|---|---|
| `node scripts/local-stack.mjs start` (`npm run local`, `make local`) | Start in mock mode |
| `… start --seed` | Also create a verified operator; the generated password is printed once and not stored |
| `… start --live --spend-cap-usd 5` | Real providers, keys from your shell (below) |
| `… start --web-port 3300` | Use another web port when 3000 is taken |
| `… start --with-video` | Also build the video runtime image |
| `… start --rebuild` | Rebuild the server, the web app and the sandbox images |
| `… status` (`make local-status`) | Health of every component |
| `… stop` (`make local-stop`) | Stop every process and container; data is kept |
| `… seed` | Create another verified operator in a running stack |
| `… mail` | Latest local emails with their links (verification, password reset, invitations) |
| `… logs [stack\|api\|worker\|web\|temporal\|images\|web-build]` | Tail a log |
| `… journey [--headed]` | Drive the customer journey in Chromium and save screenshots to `work/local-shots` |
| `… reset --yes` | Stop and delete all local data and generated secrets |

`start` prints `Ready: http://127.0.0.1:<port>` only after every component passed its
health check: PostgreSQL, object storage, malware scanner (`PING`), Temporal, worker
(polling its task queue), API (`/health`, which queries the database), web (`/health`),
mail sink and, in mock mode, the mock providers. The first start takes a few minutes
(image builds, web build, ClamAV signatures); later starts take about two minutes, most of
it the scanner's signature check.

## What runs

| Component | How |
|---|---|
| PostgreSQL 17 | Container `desvio-local-postgres`, data in `work/local-stack/postgres` (survives restarts). Bootstrapped by `scripts/bootstrap-database.mjs` (all six runtime roles, every migration, login checks). |
| Object storage | Garage container `desvio-local-storage`, data in `work/local-stack/garage`, CORS for the web origin |
| Malware scanner | ClamAV container `desvio-local-scanner` |
| Temporal | Pinned CLI dev server, namespace `desvio-local`, history in `work/local-stack/temporal` |
| Sandbox images | skill runtime, renderer, document parser, website renderer (and video with `--with-video`), built by the same helpers the test suites use |
| API | `dist/main.js` on 127.0.0.1:3101 |
| Worker + dispatcher | `dist/worker-main.js` (the dispatcher runs inside it) |
| Web | `next build` with `API_ORIGIN` baked in, then `next start` |
| Mail | Local SMTP sink; never relays. Links appear in `… mail` and `logs/stack.log` |

Generated local-only credentials (database roles, auth secret, storage keys) live in
`work/local-stack/secrets.json` (mode 600, git-ignored). They are never printed.

### Provider grants

Every account and business gets its grants through the audited operator path
(`scripts/configure-providers.mjs`, preview then apply): workspace defaults (migrations
057/104, so new businesses inherit them), the account generation plan, and per-business
grants for any business that lacks them. The stack renews them every second, so a new
account has its defaults before its owner can add a business. Models come from
`apps/api/src/model-policy.ts`. Grants expire after 30 days and are renewed automatically.

## Modes

### `--mock` (default)

A local mock answers the OpenAI endpoints the worker calls. The OpenAI SDK already honours
`OPENAI_BASE_URL`, so the worker gets `OPENAI_BASE_URL=http://127.0.0.1:54010/v1` and a
placeholder key. **No product code was changed to reach the mock.** Keys exported in your
shell are not passed to any process in mock mode.

| Call | Mock answer |
|---|---|
| Website research (hosted web search) | Three cited paragraphs on the business's own domain |
| Market and competitor research | Notes with consulted sources, one competitor, audience suggestions |
| Brand analysis | Findings quoting the owner's answers and the website, a full business direction (no blocking questions) |
| Skills-sandbox planner: creative brief, carousel plan, strategy, monthly plan with storylines, chat | Generated from the request's strict JSON schema, varied per slide and per post; the plan follows the requested content mix |
| Image check (vision QA) | Pass, reporting exactly the expected lettering |
| Images generate / edit | Real PNGs at the requested size: brand colours from the prompt, the headline and a "Local mock image" label |

Everything a mock answers is labelled as such on the image itself. Mock mode proves the
wiring, the jobs, the storage, the sandboxes and the screens; it proves nothing about
model output quality.

**Not mocked:**

- **Vecteezy stock.** Previews and downloads go through `SafeWeb`, which only fetches public
  HTTPS hosts. Pointing it at a local mock would mean weakening the SSRF guard, so stock is
  off in mock mode (it is optional; generation continues without it).
- **Post for Me (publishing, analytics).** Uploads are checked to go to a public HTTPS host
  and connecting an account needs Post for Me's OAuth pages, so publishing and the analytics
  sync are off in mock mode. Use live mode with a Post for Me key to try them.
- **Runway video** and Gemini.
- The website itself: research renders the real public site you enter (for example
  `https://example.com`), through the normal website renderer sandbox.

### `--live`

```sh
export OPENAI_API_KEY=…          # required
export VECTEEZY_API_KEY=… VECTEEZY_ACCOUNT_ID=…   # optional: stock
export POSTFORME_API_KEY=…       # optional: connections, publishing, analytics
node scripts/local-stack.mjs start --live --spend-cap-usd 5
```

- Keys are read only from your shell environment and passed to the processes that need
  them (OpenAI and Vecteezy to the worker; Post for Me to the API and worker). They are
  never written to disk or logs, and nothing reads Railway.
- `--spend-cap-usd` is required. It is the lifetime budget of each business's grants, split
  planning 30%, creative 50%, research 15%, insights 5%. Stock is capped at 5 downloads a
  day. The account plan (500 USD, of which 100 USD provider budget per month) also applies.
- Switching modes needs `stop` first. Grants are re-applied with the new budgets on start.

## Reset

`node scripts/local-stack.mjs reset --yes` stops everything and deletes
`work/local-stack` (database, files, Temporal history, secrets). Images stay in Docker.

## Known issues found with this stack

- The guided onboarding's "Confirm business details" fails with "Review every visual
  direction or mark it Wrong before approving" whenever research produced visual
  directions, and the guided page has no control for them. Workaround: open "Review
  sources" (`/b/<id>/onboarding`), mark each visual direction Correct or Wrong, then
  confirm again. `journey` does this and reports it.
- If a business is created before its grants exist, its background research is rejected
  (`AI_STAGING_APPROVAL_REQUIRED`). The guided page then says "We couldn't read your website"
  (misleading: the website was never fetched) and offers only "Continue with my answers";
  sending the brief again does not retry the website research once grants exist.
  The stack applies defaults within a second of account creation to avoid this locally.
