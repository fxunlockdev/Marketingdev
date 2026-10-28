# Strategy campaigns

A strategy groups ordinary saved campaign plans around one selected goal. The implementation uses the existing real planning jobs, skill runtime, provider configuration, private media pipeline, image generation and approval workflow. It does not introduce fake posts or auto-approve content.

Home and Campaigns offer a Create new dialog with Post, Campaign and Add strategy. Strategy cards use approved brand photos when available; otherwise the fallback is original typographic illustration, not a fake generated asset.

## Supported workflow

- Choose a strategy and name, start date and weekly post count.
- Manual launch creates one seven-day campaign. Optional four/eight/twelve-week scheduling requires explicit consent and creates durable, dated planning occurrences.
- Growth can add one or two weekly posts every four occurrences, capped at fourteen per week. Strategy dates are spread with a two-post-per-day ceiling.
- Active strategies show real occurrence status, generated campaign links and stop controls.
- Create campaign images dispatches actual image jobs through SlotCreatives, with a per-image budget. Repeating the action returns existing jobs without charging a second allocation.
- Failed or canceled image jobs show Images need attention with campaign recovery guidance, rather than claiming the images are ready. Existing image-generation recovery remains in the campaign/calendar; the strategy does not blindly resubmit uncertain paid jobs. Publishing always uses the separate approval workflow.
- Definitive rejected launches unlock the form; transport and server failures retain the original request key so retry checks the same launch.

## Credits and permission

The server computes default generation capacity from the configured image reservation (including up to three future references) and the bounded planning-call envelope. Scheduled planning multiplies its quote by the chosen week count. Every image dispatch revalidates the actual selected references and current configuration before creating jobs. One displayed credit represents 10,000 provider microdollars of capacity under the existing Desvio conversion; it is not an actual usage or retail-price claim. Strategy planning reserves its configured sub-cap inside the strategy allocation; each generated image reserves its individual maximum. Allocations are conservative and remain allocated after failure, rather than implying a provider refund. Their sum cannot exceed the strategy cap. Provider grant and shared monthly limits still apply. Planning uses the same bounded-loop accounting even for a single occurrence.

No strategy silently spends on a new category of content. Scheduled planning is opt-in and finite. Image creation remains an explicit action. Automatic introduction of new strategies every two/three/four weeks and automatic image dispatch after planning are not implemented; no nonfunctional controls for those actions are shown. Video strategy automation is not implemented.

Migration079 stores strategy, occurrence and generation associations under forced tenant RLS. No browser secrets or new external provider are required. A new strategy cannot bypass approved brand/onboarding requirements. Tests use mock paid providers; no new live provider verification is claimed.

## Checks

- `node scripts/foundation-test.mjs --strategies`: planning creation, role/tenant denial, budget allocations, image job dispatch and idempotency, scheduled growth and stopping.
- `node --test tests/contracts/planning.test.mjs`: includes hard two-per-day strategy scheduling.
- `node scripts/foundation-test.mjs --strategies-web`: Home launch through saved campaign and image dispatch, reload, accessibility and mobile layout.
