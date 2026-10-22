# ADR 0024 — Human-approved visual identity in onboarding

Status: implemented locally; staging/live acceptance outstanding.

## Decision

Keep the existing three-step onboarding and Brand Brain architecture. Store visual-review decisions in `app.brand_visual_reviews`, separate from immutable analysis evidence. The authenticated business-scoped Brain API accepts Correct, Wrong or Edit with the exact analysis job, suggestion index, evidence digest and saved revision. A repeated exact save is a no-op; conflicting/stale writes fail. Forced RLS and column grants restrict decisions and prevent runtime evidence mutation. Workers cannot review or approve.

Approval locks the brand draft and requires every current visual suggestion to have a human decision. Accepted directions enter the immutable approved snapshot as `visual_direction_*` preferences with original observations, capture references/hashes, reviewer and analysis lineage. The existing generation/planning paths consume these approved entries through their scoped Brand Brain context. Planner instructions distinguish design preferences from product claims and media reuse rights. A later analysis with missing categories does not erase previously approved preferences. Explicitly reviewed replacement categories supersede them.

Successful analysis advances the review revision even with no new textual facts, since visual evidence may have changed. A newer completed website crawl makes older visual suggestions stale. Existing approved snapshots remain immutable; new approval creates a new version.

## Customer experience

The existing brand-review step displays visual observations, source links and Correct/Wrong/Edit controls. Corrections survive failed saves. Saved choices and previously approved retained preferences are visible; final profile confirmation promotes them into Memory. Existing Content Plan is linked from successful onboarding, replacing stale unavailable copy. No wizard step was added.

## Evidence and limits

`tests/foundation/brand-visual-review.test.mjs` exercises actual PostgreSQL/RLS, scoped decisions, concurrent/replayed changes, stale analysis/crawl denial, immutable provenance/snapshots, worker/read-only/foreign denial, invalid inputs and preservation across empty/partial analysis. Fixtures are explicitly synthetic analysis records, not live visual-quality proof. The actual creative skill broker regression asserts that the reviewed direction reaches its approved context; its model and image provider responses remain MOCK. The browser journey covers correction failure/retry, reload, confirmation and Memory through the actual API.

Broader scanned-document/slide visual extraction, cleared brand asset selection, editing retained preferences without a replacement analysis, deployed sandbox/runtime acceptance and real-model quality remain incomplete. No paid call or social post is authorized by these tests. The original architecture, human approval and live release gates remain unchanged.
