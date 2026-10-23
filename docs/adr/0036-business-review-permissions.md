# ADR 0036: business review permissions

Reviewer and Analyst are selected-business roles. They are never account administrators. Invitations, acceptance and role changes preserve independent grants per business.

General write authorization remains limited to Owner/Admin/Editor. Final creative, canonical-image, video and calendar decisions enter a transaction-local review context. Only review table policies accept that context, and a database trigger restricts Reviewers to review state/revision/actor/timestamp columns and valid pending-to-final transitions. It cannot authorize creative edits, media replacement, scheduling changes, Brand Brain changes, paid jobs, video prompt consent or publishing. Pooled connections reset the context on every transaction.

Reviewer can approve, reject or request changes on an exact current version. Analyst is read-only, including current business history; analytics production remains a separate unfinished capability. Both may read only businesses assigned to them. Business Admin remains the publishing role. Scoped team delegation is not implemented in this change.

API/UI use the same capability distinction. The UI hides generation/edit actions for Reviewer/Analyst while enabling Reviewer feedback and final decisions. Final approval still requires the existing persisted version/hash and playback/image checks. No extra pre-generation approval is introduced for static images.

Tests include actual authenticated sessions and PostgreSQL RLS; direct review-context content/job/business mutation denial; cross-business access; canonical PNG approval rollback/idempotency; canonical MP4 review; and browser read-only/reviewer controls. External model and Postiz transports remain MOCK in local acceptance. Passing these tests does not certify a live deployment.
