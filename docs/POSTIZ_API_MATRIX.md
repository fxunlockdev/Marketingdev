# Postiz API and tenant audit

Source: [651876e24317c2d8e717262cf98267ec6f699180](https://github.com/gitroomhq/postiz-app/tree/651876e24317c2d8e717262cf98267ec6f699180). **Source observations, not live conformance proof.** Backend routes below gain `/api/` through container nginx port 5000 (`var/docker/nginx.conf`). The deployed image is older and its equivalence is unresolved.

| Capability | Source-backed contract | Source / limitations |
|---|---|---|
| Auth | Raw `Authorization: <org-api-key>` or `pos_...` token | `apps/backend/src/services/auth/public.auth.middleware.ts`. Do not invent Bearer prefix. Org lookup filters deletedAt:null. |
| Org override | `x-postiz-org` switches org for privileged API keys | Middleware + `OrganizationService.canUseSuperAdminApi`. Strip browser headers; prohibit platform-admin credentials for customer calls. OAuth token cannot override. |
| Connections | `GET /public/v1/integrations`, optional group | `public-api/routes/v1/public.integrations.controller.ts:320`; id/name/identifier/picture/disabled/profile/customer. Group filtering is not tenant isolation. |
| Start OAuth | `GET /public/v1/social/:integration`, optional refresh | Controller:344; returns URL, Redis state maps org/verifier for 3600s. External-URL integrations rejected. |
| OAuth callback | `POST /integrations/social-connect/:integration` | `api/routes/no.auth.integrations.controller.ts`; body state, code, timezone, optional refresh from `connect.integration.dto.ts`. Org recovered from state. Desvio must bind state to session, reject replay/races, and implement its own callback page. |
| Multi-step account choice | `POST /integrations/public/provider/:id/connect` | State recovers org. Internal route needs runtime tests; not assumed stable public API. |
| Org provisioning | `POST /enterprise/create-user` with signed params | `enterprise.controller.ts`; privileged JWT signed with installation secret. Requires runtime/license assessment, never browser exposure. |
| Media | `POST /public/v1/upload` multipart file, adjust | Controller:80; org-scoped media service. Prefer approved bytes; upload-from-url requires SSRF review. |
| Schedule | `POST /public/v1/posts` | mapTypeToPost → validatePosts → createPost(org.id,...). Provider settings required. No idempotency-header guarantee established. |
| Reconcile | `GET /public/v1/posts?startDate=...&endDate=...` | `get.posts.dto.ts`; required date bounds. No generic public GET posts/:id status route proven. |
| Analytics | `GET /public/v1/analytics/:integration?date=...` and `/analytics/post/:postId?date=...` | Controller:662/672; provider permissions/support determine real metrics. Missing means unknown. |
| Auth ping | `GET /public/v1/is-connected` | Static connected:true after API auth. Does not prove any social connection/token health. |
| Rate limits | API_LIMIT, default 90/hour | app.module.ts and `throttler.provider.ts`; mainly POST posts/comments, not every API. Desvio needs its own queues/budgets. |
| Webhooks | Dashboard webhook CRUD exists | `api/routes/webhooks.controller.ts`; signed publication webhook contract unproven. Prefer authenticated outbound reconciliation. |

All controller paths relative to `apps/backend/src`. Organization predicates exist in repository reads/writes, but some internal methods accept optional org IDs. Never permit absent scope in our adapter. Required A/B tests: foreign post/media/channel IDs, organization override, callback replay, reconnect, token revocation, duplicate scheduling and account-specific authorization.

LinkedIn asks for member and organization scopes, including w_member_social, rw_organization_admin, w_organization_social and r_organization_social (`libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`). Redirect derives from FRONTEND_URL/integrations/social/linkedin. Actual app permissions must be proven. Instagram has `instagram` (two-step) and `instagram-standalone`; account types/permissions are not interchangeable.

Upstream Compose contains latest images/known dev secrets/admin ports and Elasticsearch. Railway instead has generated secrets, private Postiz, disabled registration and an uploads volume. Initial SQL Temporal startup failed because sample Text attributes consumed slots; dedicated desvio-postiz namespace with SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true is the correction being verified. No social account has been connected/published.

## 22 October boundary implementation

`apps/api/src/postiz-client.ts` implements bounded source-backed server transport; contract tests use an explicitly MOCK HTTP server. `/public/v1/me` returns `{organization:{id,name},user}` and now validates every business credential before another operation. `POST /posts` returns `[{postId,integration}]`, an acknowledgement only. `GET /posts` returns `{posts:[{id,content,publishDate,state,releaseId,releaseURL,integration:{id,providerIdentifier,...},...}]}`; source enum is QUEUE/PUBLISHED/ERROR/DRAFT. No release identity means no confirmed publication. Upload returns `{id,path,...}`; exact PNG bytes use multipart `file` and `adjust=false`.

Source updates checked: `public.integrations.controller.ts` /me 293, account list 320, OAuth start 344, schedule 146; `posts.service.ts` createPost 1137–1215; `posts.repository.ts` getPosts 155; `media.repository.ts` saveFile 9; `no.auth.integrations.controller.ts` callback includes organizationId/providerIdentifier/internalId and strips stored secrets. Enterprise create-user delegates to `organization.repository.ts:createMaxUser`, which creates a new org and returns `{id,apiKey}`; caller id is placed in its name, not an idempotency key. Ambiguous provisioning must not be automatically repeated.

Official references checked: [identity](https://docs.postiz.com/public-api/integrations/me), [OAuth URL](https://docs.postiz.com/public-api/integrations/connect), [upload](https://docs.postiz.com/public-api/uploads/upload-file), [schedule](https://docs.postiz.com/public-api/posts/create), [dated reconciliation](https://docs.postiz.com/public-api/posts/list). Reconnect is unresolved: docs describe refresh as an integration ID, while pinned callback compares the provider's internal account identity. Disconnect can delete pending upstream posts; it requires a separately reviewed destructive action flow. No live endpoint was called and no social account was authorized or published.

## Approved video publication (23 October)

Pinned source `651876e24317c2d8e717262cf98267ec6f699180` supports one LinkedIn MP4 via the existing multipart upload and generic post media field. The LinkedIn provider validates a single video and uses its video upload/finalization branch for `.mp4` paths. Desvio now accepts only canonical private MP4 bytes bound to the latest saved-video and current calendar approval, with explicit account/time consent. See ADR 0034 and generated publishing/video verification reports. This remains MOCK-transport evidence; no external posting, deployment equivalence or legal clearance is claimed.

## Remote cancel/reschedule audit (23 October, unchanged pin)

The pinned public controller exposes `DELETE /public/v1/posts/:id` (lines 233–240), resolving the post's group before deletion. `posts.repository.ts:362` marks the group deleted; `posts.service.ts:885` then attempts to terminate running Temporal executions but catches and ignores failures before returning `{id}`. Therefore that response alone cannot establish that no in-flight publication will complete. The public status mutation at controller line 636 calls `changePostStatus` (service line 1373), which also catches workflow-start failures. The date mutation exists on the internal session controller (`posts.controller.ts:296`), not as a verified public date endpoint. Do not invent a public reschedule path or represent local cancellation/absence from a dated listing as proof that an external publish was stopped. A durable upstream cancellation outcome and race acceptance remain implementation prerequisites for safe remote cancellation/rescheduling. No delete/status request was sent.

### LinkedIn ordered carousel contract (23 October 2026)

Rechecked pinned `651876e24317c2d8e717262cf98267ec6f699180`, `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`: `buildPostContent` preserves media ID order in `content.multiImage.images`; `postPending` converts images to a PDF only when `post_as_images_carousel` is true. Desvio's ordered PNG carousel transport uses one `public/v1/posts` request, one integration and one content value with 2–10 ordered images, leaving this flag false. Duplicate IDs/paths, mixed videos, foreign origins and invalid counts are rejected before network activity. Tenant identity/channel checks and unknown-outcome handling remain enforced. This is a verified upstream-source/MOCK HTTP contract, not live social publication. Durable per-slide upload state and customer publication wiring remain required before exposing the feature.

## Scheduled removal transport (24 October)

`PostizClient.requestScheduledPostRemoval` uses the audited DELETE endpoint only after matching a single queued LinkedIn post by tenant identity, remote post/channel ID, caption and exact schedule, with no release identity/URL and at least one minute remaining. It rejects missing/duplicate/changed/published targets and reports `removal_requested` with `publishingStopped:false`, never canceled. A mismatched acknowledgment, upstream error or dropped response stays unknown with no automatic retry. Fifteen Postiz MOCK HTTP contracts pass, including these cases. No live DELETE was executed. This is transport preparation only: durable request/reconciliation state, customer controls and race acceptance remain unfinished.


### Source recheck, 2026-10-24: channel recovery

At pinned commit `651876e24317c2d8e717262cf98267ec6f699180`, `public.integrations.controller.ts` exposes `DELETE /api/public/v1/integrations/:id`. It removes associated post groups and then soft-deletes the organization-scoped channel. Removal/Temporal termination errors can be swallowed. Desvio therefore holds local publishing before dispatch, blocks unresolved local publications, sends at most once, and reconciles by listing integrations. An absent channel is not proof of stopped in-flight publishing or revoked social permissions.

The public `GET /api/public/v1/social/linkedin?refresh=...` stores a provider internal account identity. The callback compares the authenticated identity with that value before same-provider reconnect. It is not the integration row ID. Desvio persists the callback's verified `internalId` server-side and checks both identities on reconnect. Existing imported channels without that evidence cannot offer targeted reconnect. Customer responses expose only a capability flag, never this internal identity or tokens.

### Saved provisioning candidate recovery (migration 048)

Desvio now exposes an administrator-only recheck operation for a terminal unknown setup attempt **only when its encrypted organization credential was saved**. The separate provisioner performs the already audited identity read, checks the exact business identity, and binds that same candidate. It does not call enterprise create-user again. A separate durable job preserves the original attempt and audit history; tenant RLS, revoked-access checks, replay keys and three-check hourly limits apply. The customer API receives only a recovery capability boolean, never the credential or remote organization identifier. Missing credentials and mismatched identities remain held for operator resolution. Local integration/browser tests use explicitly MOCK Postiz; this does not establish live OAuth or publishing acceptance.

### Instagram standalone source audit (24 October 2026)

Same pinned commit. `libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts:28` identifies `instagram-standalone`, sets `isBetweenSteps=false`, and uses `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`. `generateAuthUrl` at line 108 returns `https://www.instagram.com/oauth/authorize` with exact Desvio `/integrations/social/instagram-standalone` redirect. The four requested scopes are instagram_business_basic, instagram_business_content_publish, instagram_business_manage_comments and instagram_business_manage_insights. This is distinct from Facebook-backed `instagram`; do not interchange their credentials or selectors.

The public controller `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts:344` accepts an allowed provider name; `apps/backend/src/api/routes/no.auth.integrations.controller.ts:43` handles its code exchange and checks reconnect's internal account identity before saving. Desvio's backend authorization extension checks exact consent origin/path, callback origin/provider, response type, state, client ID uniqueness, returned organization/provider and subsequent integration listing. Migration 050 binds reconnect RLS to the stored provider. Local MOCK transport, persisted flow and all eight customer connection browser journeys pass. The extension is not deployed. No Meta approval, live consent, refresh behavior, media compatibility or Instagram publication is certified by this audit.

### Remote cancellation acceptance limit (24 October recheck)

Pinned `postiz-audit` source public controller DELETE `/posts/:id` resolves the scoped post then deletes its group. `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:885` first deletes the repository record, then attempts Temporal workflow termination and catches both enumeration and termination errors. `{id}` and subsequent absence from GET posts therefore cannot establish that an in-flight publication has stopped. Desvio currently supports cancellation before submission only. A remote cancellation implementation must retain an unresolved state unless independently verified; rescheduling cannot submit a replacement while the old publication may still execute. No endpoint was called and no social post was modified during this audit.

### Facebook Page selection gap (2026-10-25, source inspection only)

The pinned checkout's `no.auth.integrations.controller.ts:279` fetches page choices for a two-step provider and returns them with the intermediate integration. `POST /integrations/public/provider/:id/connect` resolves the organization from the stored OAuth state. `integration.service.ts:416` verifies the organization-scoped integration is in-between steps, fetches the selected Page with its stored token, updates its identity/token and clears `inBetweenSteps`.

Desvio currently rejects that result in `PostizClient.completeAuthorization`, which deliberately accepts only completed Instagram/LinkedIn connections. Facebook support therefore needs a durable `awaiting_page_selection` state with sanitized choices, session/organization binding, expiry, idempotent Page submission and post-selection identity verification before publishing is enabled. Reconnect must preserve the selected Page identity. This is a concrete implementation gap, not something resolved solely by owner Meta-app configuration. No Facebook authorization or publication is claimed by this audit.


### Facebook typed adapter (local, 2026-10-25)

The adapter now has a separate Facebook code exchange and explicit Page-selection operation. The exchange checks the remote organization, provider and intermediate state, and returns only Page IDs/names. The upstream Page list can contain `access_token` and token-bearing photo URLs; these are deliberately discarded. Selection accepts only one of the supplied persisted choices, checks the actual credential organization and matching Facebook integration before POST, and reports acceptance rather than publication. Ambiguous mutation outcomes remain unknown and are never automatically replayed. Existing single-step callbacks refuse Facebook without consuming its code.

All 25 Postiz transport contract tests passed against local HTTP fixtures, including three new Facebook groups. This is ADAPTER_READY only. The customer service still rejects Facebook: durable session-bound choice storage, expiry, UI, callback routing, reconnect and publishing remain to be implemented. The public integration listing does not expose internal Page identity or `inBetweenSteps`; it cannot alone prove selected-Page identity after an ambiguous selection result. No live Meta request was made.


### Facebook durable selection (local, 2026-10-25)

Migration 065 adds safe Page choices and immutable selection records. The callback destroys the saved code after exchange and waits for the initiating session to choose an available Page. The API enforces administrator access, business/session scope, authorization expiry and account revision. A repeated identical selection returns the same job; a different selection conflicts. The durable workflow resumes without exchanging the code again, and an interrupted selection becomes unknown rather than sending another mutation. Selection acknowledgement plus the scoped integration listing is required before saving the local channel; this does not certify publication.

The complete local social foundation suite passes 37 tests, including actual Temporal waiting/resumption, expiry, role/session revocation, wrong-login denial, concurrent repeated choice and lost response. Transport is mocked, not live Meta. The customer picker and Facebook-specific callback are currently under browser verification. Targeted Facebook reconnect and publishing remain unsupported. The refresh import still needs explicit handling of upstream intermediate Facebook entries, since public listing does not expose that state.


The local customer flow now passes all nine connection browser journeys (including existing LinkedIn/Instagram cases). The Facebook return is handled server-side, Page choices survive reload, no Page is preselected, and the explicit selection resumes the saved workflow exactly once. The picker passes axe with zero violations. `work/browser/facebook-page-picker.png` was visually inspected. This is local/mock-transport evidence only; not deployed or live verified.


### Facebook refresh observations (local, 2026-10-25)

Migration 066 adds a secret-free, worker-scoped observation of Page-selection acknowledgements. A public integration list alone cannot promote Facebook to available. Pending or uncertain exchanges remain unconfirmed, and a new exchange temporarily holds prior Facebook channels until its scope is known. The synchronization worker can read these safe observations but cannot modify another job's acknowledgement. Existing publication eligibility already requires `observed_state='available'`.

The social foundation suite passes 37 tests with refresh during selection, refresh after acknowledgement, unconfirmed imports and runtime-role denial. Browser verification of refresh inside the Page-picker journey is running. An unresolved older mutation still requires reconciliation; a later successful selection must not silently erase that uncertainty. Facebook publishing and targeted reconnect remain separate unfinished work. Nothing in this change is live Meta verification or deployed release evidence.


Final recheck: all 38 social foundation tests and all nine connection browser journeys pass. The additional foundation regression proves that an unresolved mutation cannot be hidden by a later acknowledgement, and synchronization cannot rewrite another job's observations. The browser test refreshes before Page selection and verifies the unconfirmed state. It also prepares a connection while a different browser page is foreground. Active polling now continues in background tabs, resumes on visibility changes, and discards stale read responses. Logs: `work/facebook-unresolved-foundation.log`, `work/facebook-observations-browser-recheck.log`. All checks use mocked external transport. No deployment or live Meta claim.


### Page-choice recovery (local implementation, verification in progress)

Migration 067 distinguishes an abandoned Page choice from an uncertain Page mutation. A canceled or expired choice that never entered submission can be superseded by a later acknowledged selection. An older verified connection cannot be resurrected by refresh alone. The recorded exchange-return time prevents an old choice's later cleanup from invalidating a newer successful selection; uncertain in-flight requests still hold availability.

A session-bound cancellation endpoint only accepts an awaiting choice with no saved selection. It records cancellation on the existing job; the worker clears the choice and completes cancellation. Selection and cancellation serialize under the same business lock. After a choice has been accepted for processing, cancellation is rejected rather than pretending the external operation was stopped. The recovery test initially had one stale mutation-count assertion after adding the deliberate recovery submission; that expectation was corrected and the expanded foundation suite is running.


Recovery verification completed locally: 39/39 social foundation checks and 10/10 connection browser journeys passed. The browser exercises Cancel from the Page picker, verifies no Page mutation was sent, starts another connection and explicitly selects a Page successfully. Evidence: `work/facebook-cancel-foundation.log` and `work/facebook-cancel-browser.log`. No live provider calls or deployment occurred.

### Facebook Page publishing transport (local, 2026-10-25)

Audited checkout `651876e24317c2d8e717262cf98267ec6f699180`, `facebook.dto.ts` and `FacebookProvider.postNonStory`. Added typed `submitFacebook`: one PNG, one canonical MP4, or 2–10 PNGs in a Page feed post, with `settings.__type=facebook` and `post_type=post`. The adapter verifies the remote tenant and destination provider, enforces the application’s 3,000-character caption limit, checks media origins/types and rejects duplicate carousel media. Responses mean acceptance only. Ambiguous responses do not trigger retries.

All 28 Postiz transport tests pass, including three new Facebook groups. No live Meta calls or posts were made. This is **ADAPTER_READY** only: content/planning/creative channel schemas, final approval compatibility, durable publication routing, operator publication grants and customer destination UI still restrict this flow. Those must be completed and tested before exposing Facebook publication. Stories and targeted Facebook reconnect remain separate gaps.
