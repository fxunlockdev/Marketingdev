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
