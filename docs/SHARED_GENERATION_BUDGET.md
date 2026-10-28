# Shared monthly generation budget

Migration 068 adds an account-level provider-cost reservation ceiling alongside the existing brand/provider grants. A configured $500, $800 or $1,000 plan allows at most $100, $160 or $200 respectively in reserved provider costs per UTC calendar month. This implements the requested 80% margin target against provider costs; it does not account for infrastructure, payment fees or staffing.

Research and brand analysis, planning, creative planning/images/edits, and video all insert into existing durable reservation ledgers. Their AFTER INSERT triggers update one account/month counter in the same transaction. The counter row serializes concurrent requests across brands and providers. A denied reservation rolls back before the external call. Idempotent conflict/replay inserts do not charge again. Unknown, failed and released reservations remain counted conservatively; no automatic refund can make an ambiguous paid request free.

Existing reservations are backfilled by their UTC creation month. New reservations use database wall-clock time, not a caller-supplied date. Existing reservations cannot be edited by runtime roles. A disabled assigned plan blocks new spend. Both tables use forced RLS. Migration 069 allows active account members to read only their own plan and monthly usage; workers have no direct read permission. Customers and workers cannot assign plans or modify counters directly.

An account without an assigned row retains its existing explicit provider grants. No customer has been silently assigned a paid plan. Cycle/quantity entitlements (including five reels and daily static posts on the $800 plan), and deployment remain required. This is not billing implementation or complete credit-system acceptance.

The ceiling depends on conservative per-call reservations remaining at least as large as actual provider charges. Provider price changes and reservation accuracy still require verification. No paid API calls are needed for local budget tests.

## Assigning a plan

The existing one-shot `scripts/configure-providers.mjs` operator tool accepts a version-1 manifest with `scope: "generation_plan"`, exact `organization_id`, unique `change_id`, an `operator_reference`, numeric `monthly_price_usd` (500, 800 or 1000), and boolean `enabled`. Do not include business_id or grants: the plan covers the whole account.

Run the tool with the manifest file to obtain a preview. Apply that exact preview hash using the existing `--apply` argument. The tool checks the target database, migration checksums and administrator role before use. Usage arriving since preview makes approval stale; preview again. Reusing a change ID with different content is rejected. Every applied change is recorded in the existing operator audit. Setting enabled false blocks new generation; it does not clear existing usage or cancel an already-submitted provider request. No customer account has been assigned or changed during implementation.

Local operator suite: 14 tests passed, including generation plan assignment, stale-preview rejection, idempotent replay, preservation of usage and disabling. These checks do not prove production deployment or payment collection.

## Customer balance

`GET /api/v1/workspaces/:org/generation-usage` requires a genuine session and active account membership. A missing assignment returns configured false. The API returns credit totals, used/remaining credits, enabled state and next UTC reset; it does not return provider rates or dollar reservation details. One credit corresponds to 10,000 provider-cost microdollars; used credits round upward and remaining credits never go negative. Thus the three plans have 10,000, 16,000 and 20,000 credits. This is a usage unit, not yet a per-post price quote.

The selected business header displays the account balance, with a disclosure for usage/reset details and refresh. It refreshes every minute while visible and on return/focus, discards stale responses, and offers retry on errors. Unassigned accounts have no fabricated balance. Disabled plans display Generation paused.

## Suggested campaign quantities

The campaign content-mix step can load the assigned plan's suggested month with one action. The $800 preset uses one image per day in the selected rolling calendar month, plus five video drafts; leap years and short-month anniversaries are handled explicitly. The $500 preset suggests 15 images and two videos; $1,000 suggests 45 images and eight videos. These outer-tier mixes are editable implementation defaults, not newly guaranteed package entitlements.

The action adjusts planning counts and duration only. Users can change these before proceeding; going Back preserves edits. A failed balance retry does not reset campaign fields. Presets do not reserve generation costs, promise provider availability, implement hard monthly post/reel quotas or render finished content. Those parts of the complete package journey remain outstanding. Daily draft placement is handled by the planner as described below. Existing shared cost limits still guard actual provider requests.

### Daily campaign date placement

When a campaign contains exactly one static image per day of its selected duration,
the planner repairs clustered or out-of-range dates into one static draft on every
local calendar day. Video drafts are spaced independently at 15:00; repaired image
drafts use 12:00 in the selected timezone. Already-valid daily calendars retain their
times. Topics, channels, approved fact references and video concepts remain unchanged,
and all output validation still applies. These are editable draft dates, not publishing
authorization or proof of rendered images/reels. Sparse and conversational plans retain
their existing scheduling behavior. This does not enforce monthly package quotas.

Migration `070_generated_plan_slot_capacity.sql` expands the generated slot index
from 0–29 to 0–89, matching the existing 90-post API limit. Without this migration,
a daily-image month plus reels fails atomically while saving its 31st draft. The
per-plan unique index and tenant policies remain intact.
