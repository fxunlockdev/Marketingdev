# Product journey review — 4 November 2026

## Scope and method

Used Google's [Elephant Goldfish Model](https://github.com/google/elephant-goldfish-model) at commit `113a3afc44e8f4f54722d7150d5701f65cc8ef7f`. Three fresh-context, read-only reviewers compared the repository's product requirements with chat/canvas, media recovery, and account/publication implementations. Confirmed findings were reproduced and fixed separately. Reviewers then checked the resulting changes; the media follow-up found additional cancellation bugs, which were corrected and reviewed again.

This is a bounded product-journey audit using EGM's review method, not a claim that the entire product passed a formal EGM convergence gate or is production-ready. External source instructions were treated as review guidance, not authority to deploy or publish.

## Fixed journeys

| Journey | Failure | Result |
| --- | --- | --- |
| Home → Add strategy | Shortcut opened a generic conversation without strategy setup. | Opens the existing guided strategy journey. |
| Video editor → Start over / History / chat instruction | Internal chat transitions ignored a video editor's unsaved state. | All registered editors participate in navigation confirmation and block new instructions until saved. |
| Image follow-up | Saving an older project could make the assistant edit that image while the canvas displayed a newer project. | Chat context and canvas use the same deterministic project order and latest saved version. |
| Selected-business Admin → approve knowledge | API and database checked account-level role instead of effective business administration. | An assigned Admin can approve that business; Editors, Reviewers, Viewers and sibling businesses remain denied. |
| Selected-business teammate → facts/uploads | Account-only retry records caused otherwise authorized writes to fail. | Business operations have explicit scoped replay records; account operations remain restricted. Existing business replay records are backfilled. |
| Calendar → edit / reopen / archive / restore | Publication holds recognized the older adapter but missed Postforme. | Both adapters block changes; a database trigger protects against bypasses. |
| Remove business | A pending or uncertain Postforme publication could be overlooked. | Removal is blocked; publication insertion and removal share the business lifecycle lock. |
| Configure email | Adding SMTP credentials implicitly enabled public registration. | Public registration requires an explicit flag as well as email. Current manually provisioned access remains closed by default. |
| Cancel video before submission | Interrupted preparation could leave an unused spending reservation held. | The durable provider state is rechecked and an unsubmitted reservation is released. |
| Cancel video after submission | Worker lacked permission for its cancellation write; transient status failures or unknown outcomes could become incorrectly terminal. | Uses provider cancellation without widening worker permissions, retries status reads, preserves unknown outcomes, and retains potentially incurred cost reservations. No paid resubmission. |

## Database and configuration

Migration `090_product_journey_guards.sql` updates brand-approval RLS, adds scoped idempotency metadata, guards calendar publication holds, and makes business removal aware of Postforme. It does not delete customer data. Apply it before deploying the API changes.

`PUBLIC_SIGNUP_ENABLED` defaults to false. Enabling email alone no longer opens registration. This is not a new invitation-registration implementation: new users still need the existing operator provisioning route until recipient-bound invitations are verified.

## Verification

443 checks passed across nine suites, plus API/web type checks and browser production builds. The dev API, web app, migration and worker are deployed. Hosted checks confirmed the existing Runway Reel plays after reload, unsaved video feedback survives a canceled navigation, and chat sending is blocked until edits are resolved. The machine-readable companion evidence records the exact completed test runs and deployment status. Database suites use real PostgreSQL and restricted application/worker roles. Media browser suites use real application, storage, renderer and persistence with simulated paid provider responses; they do not establish new live-provider quality evidence.

New regression coverage includes:

- Selected-seat fact saving, exact retry, upload reservation retry, sibling denial, and inability to relabel account operations as business operations.
- Both adapter publication holds, unchanged history on denied actions, restore restrictions, business removal, and prevention of publication insertion for removed businesses.
- A newer saved version on an older image project cannot steal a follow-up instruction from the displayed project.
- Prepared cancellation, cancellation status failure/recovery, accepted deadline expiry, interrupted paid submission, lost cancellation delivery, and no additional generation POST or repeated cancellation.
- Unsaved video edits surviving a canceled Start over action and preventing another chat instruction.
- Home strategy entry and persisted guided-draft recovery.

No social posts were published. No new paid image/video generation was needed to reproduce these recovery and permissions defects. Prior live Runway evidence remains separately recorded; it is not relabeled as verification of this patch.

## Outstanding product work

- Caption/overlay-only video revisions currently take the regeneration path. Reusing the saved base video requires a separate immutable revision/render journey; this review has not delivered that feature.
- Provider generation latency is not reduced by these fixes. Earlier Runway quality-router generation took approximately 9–18 minutes. Faster routing needs a separately measured quality/latency comparison; reducing local polling alone would not substantiate a generation-speed claim.
- Recipient-bound new-user invitations, real social publishing/analytics, load testing and the remaining production release gates are not established by this review.
- Visual parity across every supplied design screen and every feature in PRODUCT.md is not claimed by this bounded patch.
