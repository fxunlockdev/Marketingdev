# 0041 — Submit saved calendar drafts to review as one batch

The Content Plan list allows an owner, business administrator or editor to select up to 30 eligible saved drafts. The month/week view offers a shortcut to this list. Submission sends each exact slot revision and static/video version hash to `POST /api/v1/businesses/:id/reviews/bulk-submit`.

The existing business-scoped transaction, Canvas/plan locks, version checks and append-only slot history apply to the entire batch. Duplicates, invalid states, foreign slots or stale versions reject the request and roll back every transition. Reviewers and analysts cannot submit drafts. The batch only transitions draft-ready or changes-requested posts to pending review. It does not approve prompts, generate paid media, approve final media or publish. Existing final review and explicit publishing consent remain required.

A lost client response can be resolved by refreshing saved status. Retrying the old revision fails safely and cannot append duplicate transitions. Selection is bounded to 30, clears on filtering, and successful submission clears the selection. Errors retain the selection for inspection. The backend rejects a stale selected post rather than silently submitting a newer version.

Verification uses real local authentication/PostgreSQL transaction boundaries and the connected Canvas browser workflow. Paid model transports remain MOCK. This closes the batch-submission item; calendar export/drag behavior and deployed/live product acceptance remain separate unfinished scope.
