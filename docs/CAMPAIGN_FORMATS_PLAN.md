# Campaign formats: implementation plan for release 081

Status: accepted direction; schema agreement and release 080 source snapshot freeze required before product edits. This document is a plan, not completion evidence.

## Customer experience

The campaign content-mix screen offers five visual creation choices. Users choose quantities per platform, review editable topics and reference images, then continue into durable generation progress. Completed artwork occupies the preview cards. Video scripts and reference framing retain their explicit approval step before paid video generation.

| Choice | Media format | Placement | Output |
| --- | --- | --- | --- |
| Image post | static | feed | Selected square, portrait or landscape canvas |
| Carousel | carousel | feed | 2–10 coordinated slides with one selected aspect |
| Image story | static | story | 1080×1920 |
| Reel | video | reel | 1080×1920; supported 3–15 second duration |
| Video story | video | story | 1080×1920; supported 3–15 second duration |

A story is a placement, not necessarily a video. A reel requires actual vertical video; existing landscape media must not acquire a Reel label. Feed images/carousels support the currently implemented Instagram, Facebook and LinkedIn campaign channels. Story/reel choices must follow an explicit channel compatibility matrix, initially Instagram/Facebook only. This does not assert that publishing every combination is live or verified.

## Proposed shared schema: agree before implementation

Keep existing `content_slots.format` media values (`static`, `ad`, `video`, `carousel`). Add a normalized `creative_spec` with exactly:

```ts
type CreativeSpec = {
  placement: 'feed' | 'story' | 'reel';
  aspect: 'square' | 'portrait' | 'landscape' | 'vertical';
  slide_count: number | null;
};
```

Rules: feed allows square/portrait/landscape; story/reel require vertical; reel requires video; carousel requires feed and slide_count 2–10; all other formats require null slide_count. Root-approved legacy rule: creative_spec remains NULL for existing rows, preserving their exact original dimensions and semantics (including 16:9 videos). New explicit mix requests require a validated nonnull specification. Do not infer reel/story placement from dimensions. The renderer team must agree exact feed aspect ratios before validation constants are frozen. Proposed mapping: square 1:1, portrait 2:3, landscape 3:2, vertical 9:16, preserving current supported image generation sizes.

Campaign input gains a bounded explicit `content_mix` array of `{channel,format,creative_spec,count}` rows. Reject duplicate combinations, unsupported combinations, invalid counts and oversized totals. Derive post_count/video_count and per-format credit quantities server-side. Preserve legacy request inputs for old clients and saved jobs. Each generated slot carries the exact normalized creative_spec; the planner must meet requested counts by full combination, not merely total image/video counts. Slide count counts as one calendar post but several generated images.

Natural-language planning may resolve a mix, but its validated resolved settings must use the same schema and limits. Strategy-created campaigns use the same normalization rather than a separate format vocabulary.

Migration 081 should contain:

- Nullable slot creative_spec with compatibility constraints and column grants; preserve legacy rows as NULL.
- Immutable creative_spec snapshots on relevant generation requests, batch reviewed items and slot event snapshots. Changes increment slot revision and invalidate prior approval.
- Revision-bound carousel request-to-slot binding (organization, brand, slot, source revision, output version/attachment outcome) with FK, uniqueness, tenant RLS and narrowly scoped worker access.
- Video target specification and reference-framing snapshot bound to the approved prompt and render request. Final approved media cannot be silently reframed.

The schema owner and renderer owner must settle whether per-media request snapshots use a shared JSON field or dedicated normalized columns before migration code is written. No competing migrations or parallel representations.

## Work ownership and concrete files

### Planning, runtime and builder — canvas_archive

- `apps/api/src/planning.ts`: validate/normalize explicit mix; request hashes and saved input include it.
- `apps/api/src/planning-contracts.ts`: typed generated specs, exact combination counts, compatible reference selection and scheduling constraints.
- `apps/api/src/planning-jobs.ts`: persist normalized specs; include resolved mix in provenance; preserve conditional durable promotion.
- `apps/api/src/generation-plan.ts`: shared count/date logic where applicable.
- `apps/skills/runtime.py`: input validation, planner output instructions and allowlists; rebuild the immutable skill runtime.
- `apps/web/components/campaign-builder.tsx`: visual five-card quantities, per-platform selection, carousel slide count and feed aspect; bounded review and saved-request recovery.
- Shared pure campaign-format module for frontend/backend constants; avoid duplicating compatibility rules.
- Coordinate `strategies.ts`/strategy inputs with their owner so recurrent plans retain the same mix.

### Schema and carousel binding — assigned schema agent

- `database/migrations/081_*.sql`: agreed spec and bindings, constraints, grants, tenant/worker scope.
- `apps/api/src/content-plan.ts`: create/edit/list/event snapshots and approval invalidation for specs.
- `apps/api/src/carousel-generation.ts`: accept scoped slot/revision/spec; immutable request hash; same-transaction binding; safe replay.
- `apps/api/src/carousel-jobs.ts`: attach completed exact carousel only when original slot revision/spec still matches; otherwise preserve standalone output for explicit attachment.
- Reuse `carousels.ts` exact slide ordering/fingerprint/current-export validation.

### Placement rendering — root

- `apps/api/src/slot-creatives.ts`: saved target spec into static generation; coordinate batch edits with stock_media.
- Creative composition/design/export contracts and `apps/media/runtime.mjs`: real target-size composition/export, including 1080×1920 story output. GPT 1024×1536 source is not itself a 9:16 story.
- `apps/api/src/video-canvas.ts`, `video-jobs.ts`, `video-renderer.ts`, `apps/video/runtime.py`: target aspect/framing persistence, approval binding, verified output dimensions and poster consistency.
- Reference preparation must show deliberate framing before paid generation; no unapproved crop of already approved output.

### Unified reviewed generation and review — coordinate with stock_media

- Extend release 080 reviewed batches in `slot-creatives.ts` and `campaign-images.tsx`, or extract a shared dispatcher if needed; do not create a second competing batch flow.
- Quote by actual selected format: static/story image, carousel planning plus all slides/exports, video preparation and separately approved video execution. Preserve cap snapshots, idempotency and ambiguous-submission holds.
- `campaign-review.tsx`, `content-workspace.tsx`, `post-thumbnail.tsx` and related preview components: actual images, ordered carousel preview, playable vertical video, accurate badges and actionable per-post status.
- Continue prepares all selected work; videos may visibly wait for script/reference approval. Do not claim all posts are ready while some await action.
- Keep regenerated output unapproved; changing spec or slot revision prevents stale attachment and stale publication proofs.

## End-to-end acceptance

1. Create a mixed campaign across supported channels with each of the five types. Persist exact counts, placement, aspect and slide count; reload retains them.
2. Planner runtime receives the normalized mix and campaign refinements. Reject missing, extra or incompatible output combinations without promoting a partial plan.
3. Image story exports inspected 1080×1920 pixels with deliberate composition. Reel and video story produce inspected playable 1080×1920 media and matching posters.
4. Carousel generates one coordinated plan, 2–10 ordered slide images and final exports; attaches the exact immutable carousel version to its reviewed slot.
5. Video provider dispatch stays blocked until the current script and reference framing are explicitly approved. Approval changes during dispatch prevent stale execution.
6. Reload during preparation/generation reconstructs progress from durable requests. Lost HTTP responses reuse the request key; no duplicate generation or credit allocation.
7. Partial failures show the affected post and permit bounded retry only where submission outcome is known. Unknown provider outcomes do not retry automatically.
8. Concurrent slot/spec edits preserve completed media but do not attach it to a newer revision. Cross-brand plan, slot, media and request substitution is denied.
9. Review, approve, changes requested, regenerate, archive/history and restore work for each media type. Restore does not schedule or publish.
10. Real browser acceptance traverses visual mix → topics/references → progress → five real previews → edit/review. Include keyboard, accessibility, narrow viewport, empty/loading/error states.
11. Existing legacy image/video plans and saved jobs continue to load and execute under their original semantics.
12. Live paid-provider tests require the existing user-authorized budget accounting; provider doubles establish plumbing, not live visual quality. Social posting and billing remain separate explicit verification boundaries.

## Wider completion scope

This release is a five-format vertical slice, not completion of the whole Blaze-equivalent request. X, Google Business Profile, TikTok/YouTube-specific creation, blogs/newsletters and broader requested channels remain in the product backlog. Deferring social publishing does not silently remove content-creation support from scope.

## Release evidence

Record migration replay, API/web typechecks, contract/schema tests, real database tenant/revision/idempotency tests, actual isolated renderer output checks and browser evidence separately. Rebuild changed skill/media/video runtime images and deploy matching manifests. Do not report a completion percentage based on test pass rate or claim unsupported publishing parity.
