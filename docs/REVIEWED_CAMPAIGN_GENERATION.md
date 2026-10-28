# Reviewed campaign generation

Campaign review now ends with one Continue action after the visual topic cards. Users select the number of image posts and a total credit ceiling there. The default comes from a scoped server quote using the configured image reservation, selected references, and all three bounded planning steps. It is reserved capacity, not a retail price or a claim about actual provider usage. The API rechecks the minimum before creating jobs. The action submits the reviewed slot IDs and revisions once, then moves directly to saved generation progress and finished previews. It does not require a second Generate action after continuing.

Migration080 adds the reviewed revision snapshot and optional credit ceiling to existing tenant-scoped campaign image batches. The total ceiling is divided across selected images and enforced by the existing generation budget checks. Unused capacity is not represented as an actual provider charge. Legacy batch callers remain compatible when they omit the new optional ceiling.

The existing idempotent transaction validates every saved revision before any job is committed. Changed selection or budget cannot reuse a request key. Mounting, refresh, navigation and polling only read status. A lost response preserves the request key; reloading reconciles against the saved batch without submitting another paid request.

Release 080 completed the static-image handoff. Release 081 extends the same flow below; video posts retain explicit script/reference approval. No live provider calls or production deployment were performed for this change.

Checks: `--reviewed-generation` runs the real database/private-media batch test with mock provider transport; `--reviewed-generation-web` checks topic edits, one-action continuation, durable credit/revision snapshot, response-loss recovery without duplicate submission, finished previews, reload and accessibility.

## Release 081 mixed-format extension

The same reviewed batch now accepts image posts, image stories, carousels and video slots. The saved creative specification drives labels and target composition; dimensions never imply placement for legacy media. Quote capacity sums the selected image requests, carousel planning and each carousel slide. Parent carousel planning and child image requests each receive immutable ceilings whose sum cannot exceed the selected slot allocation. Video rows reserve no generation work in this step: they persist as awaiting script/reference approval, and link to the existing video preparation journey. They must not be represented as completed or dispatched videos.

`campaign_batch_items` records each reviewed revision/spec and its job association, or its explicit awaiting-approval state. Status reads reconcile existing video requests after the user continues their approval workflow. Reloads and lost-response checks use the same request key. The API rejects changed revisions before dispatch; all batch inserts and generation requests share one tenant-scoped transaction. Actual video/ordered-slide previews can be opened from the campaign cards using the existing integrity-checked media readers.

Local verification on 2026-10-26: API build passed; reviewed real-database fixtures 2/2; reviewed browser 1/1; carousel generation/regression 2/2. The browser traversed lost-response reconciliation, generated static previews, portrait carousel slides, exact 1080×1920 story composition, slide navigation and video-only approval persistence without video dispatch. Transport was mocked; actual authenticated services, database isolation, private storage and isolated renderer ran. No live visual-quality or publishing claim follows from these fixtures.

The mixed browser caught and corrected the historical media dimension constraint, which rejected normalized story images after the provider returned. Migration 081 now accepts the exact 1080×1920 target while retaining legacy sizes, and rejects transposed/mismatched targets. Existing unknown requests are never automatically resubmitted.

Final card-width and native dialog refinement passed a subsequent browser run (1/1, 76.2 seconds): desktop cards stay within 360px, the 390px viewport does not overflow, Escape closes preview and restores focus, and durable video approval state survives reload. Separate top/scrolled viewport screenshots confirm the sidebar stays positioned correctly. Failed carousel history/recovery remains separate follow-up work. Screenshots are test fixture imagery, not sample customer artwork.
