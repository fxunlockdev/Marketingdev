# Scoped skill-driven Canvas and immutable creative review

Status: implemented locally, verification in progress. No LIVE_VERIFIED or LAUNCH_READY assertion.

## Product behavior

An authenticated business member starts a conversation using that business's approved Brand Brain. A request persists before generation, binds an immutable brand snapshot, and dispatches a real Temporal workflow. Image creation and natural-language image revisions use the official OpenAI SDK. The image stays private; caption and Fabric text layers remain editable. Saving creates an immutable child version, including after approval. A reviewer approves the precise current version using a revision check. Approval does not publish anything.

The customer sees Desvio's conversation, creative editor, saved versions, request states and review history. No raw agent/provider interface is exposed. Missing configuration, budget denial, cancellation, stale edits and uncertain provider outcomes remain visible failures/holds. No seeded customer media or manufactured progress percentages.

## Dependencies and isolation

- `apps/skills/runtime.py` actually executes Deep Agents 0.7.29 with original archive digest validation and full pinned image/product-marketing/social skills; static ads also load ad-creative. Digests are validated again in the broker result. Only Markdown under selected skills and the current approved business context is mounted virtually. No skill helper execution.
- The container has no network, credentials, host mounts, writeable root or elevated capabilities. Its only model access is bounded JSON-lines through `SkillRuntime`. Only `read_file` is exposed and only the per-run immutable mount can be read. The server calls OpenAI after validating the protocol and reserving cost. Three model steps and fixed input/output bounds prevent unbounded loops.
- `creative-provider.ts` uses OpenAI 7.39.0 Responses (`store:false`) and images.generate/images.edit. Operator-granted eligible models, sizes and quality are checked. Exactly one PNG is decoded/validated, re-encoded and stored. Parent image edits re-read and checksum the private original.
- Fabric 7.4.0 receives a restricted typed design, not arbitrary imported JSON/SVG. Its browser export produces a real PNG containing the current saved background/text. It is not yet a canonical server artifact suitable for trusted publishing.

## Data and reliability

Migration 010 adds scoped conversation/project/request/media/version/review tables and private operator grants/call reservations. Forced RLS, composite tenant FKs, separate worker/dispatcher roles and original membership checks remain authoritative. The browser never receives provider secrets or canonical storage keys. Short-lived signed GETs are fetched into ephemeral blobs; no private payload is saved in browser storage.

A single unresolved creative request per business prevents overlapping spend. Each provider step is marked submitted with a conservative reservation before it leaves the server. Retry uses stored results; uncertain requests are held and never blindly resubmitted. All reservations, including rejected/uncertain attempts, remain counted; this is conservative spend control, not completed subscription billing or settlement. UI manual changes cannot overwrite a newer saved version or silently replace approval. AI image revisions preserve existing text positions/fonts/custom layers and update matching brief text.

## Verification scope

`tests/contracts/creative.test.mjs` checks real SDK serialization and malformed responses against MOCK OpenAI transport. `tests/foundation/creative.test.mjs` uses actual isolated skills, PostgreSQL roles/RLS, private S3, Temporal and MOCK OpenAI to exercise generation/edit, cross-scope denial, budgets, replay/uncertainty, cancellation, access loss and stale edits. `tests/browser/canvas.test.mjs` drives the actual UI/API/workflow/editor and saved approval, with MOCK paid transport. Browser error injection is identified in tests. Generated source-bound evidence remains the acceptance record; intermediate logs are not release proof.

## Configuration and remaining work

Workers require `SKILL_RUNTIME_IMAGE=sha256:...` and server-only `OPENAI_API_KEY` in addition to existing storage/database/Temporal settings. Operator-only `creative_grants` carry selected model IDs, quality, expiration, auditable rates, total cap and per-image worst-case reservation. No browser can grant itself funds. This is an internal tested primitive; a credential/consent/operator provisioning interface remains to build.

Railway isolated execution remains unresolved: the local Docker harness is not evidence that nested Docker or a public Docker socket is acceptable in production. Remaining: approved visual references and real model quality evaluation, 30-day strategy/plan and channel Review Inbox, carousel/Higgsfield/FFmpeg, canonical server export, OAuth/Postiz publishing/reconciliation, performance learning, complete billing/roles, infrastructure/load/security checks and authorized live generation/edit. No live calls or social publication performed for this change.
