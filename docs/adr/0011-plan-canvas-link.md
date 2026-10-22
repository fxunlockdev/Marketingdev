# Planned post → Canvas → exact-version review

Status: implemented locally; focused backend/browser tests pass, final source-bound verification pending. No live model or publishing acceptance.

## Behavior

A business editor can request a creative from an existing content slot. The request uses the saved brief, pillar, hook, CTA, channel, approved Brand Brain and applicable review feedback. New work creates a saved Canvas conversation/project. Revision work uses the linked latest version and its private pixels. Existing original skills and official OpenAI adapter execute through the same durable workflow; there is no additional provider or architecture.

`GET /api/v1/businesses/:id/content-slots/:slotId` returns the saved slot, exact creative, history and associated job outcomes. `POST .../content-slots/:slotId/generate-creative` accepts an Idempotency-Key and `{revision,feedback?,size?,reset_approval?}`. Approval reset must be explicit for an approved post. No approval is inherited by a new version. Calendar dates are still plans, not remote schedules.

## Transactions and concurrency

Migration 013 binds the creative job to the business/slot and source revision. Slot revision, history, conversation, project, request, job and dispatch enqueue commit together. Replays return the same job; changed bodies with the same key fail. Existing Canvas methods can participate in the already-authorized plan transaction. Both paths retain the canonical Canvas-then-plan lock order.

Before a first provider call, a changed slot rejects without spending. Once work has started, a later slot edit does not discard a successfully generated Canvas draft. Promotion attaches only if the source revision and parent version still match and the slot has not been approved or canceled. Otherwise the draft remains in Canvas with `needs_attachment`; the user must review and explicitly attach it. Changes to the Canvas project's latest version retain the existing conflict protection.

Creative version, slot attachment, history and successful job completion commit atomically. A failed promotion resumes from saved provider output; no potentially paid call is blindly repeated. Permission loss and cancellation still prevent promotion. Unknown provider outcomes retain the existing reconciliation hold.

## Isolation and limits

Forced RLS permits the worker to see only the slot bound to its creative job and to attach only a version created by that job with its exact hash and next revision. The worker cannot approve, edit the brief, or change unrelated slots. Business viewers cannot request generation. Existing daily request, private storage, sandbox, expiring grants and conservative budget limits remain authoritative. Feedback and content are untrusted model data, never privileged instructions.

## Acceptance remaining

The customer calendar and channel inbox now use these APIs, including month/7-day/list views, arbitrary periods, real counts/pagination, generation activity, private Fabric previews, brief/local-time editing, feedback, revisions, explicit attach-latest and atomic confirmed bulk approval. Browser tests traverse genuine jobs/API/storage/skills with MOCK OpenAI; desktop/mobile screenshots and scoped axe checks are inspected. Date helpers reject DST gaps and offer both repeated-time offsets. Unsaved input survives save failures; stale actions are rejected by the server.

Canonical server export, cloud sandbox/deployment and real provider quality/cost acceptance remain separate work. Connected social identities, video/carousel preview, drag interaction, plan export, bulk send-to-review and undo-review are still incomplete; static draft channels never claim OAuth connection. Tests use real local services and explicitly MOCK provider transport. This does not establish LIVE_VERIFIED or LAUNCH_READY.
