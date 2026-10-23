# 0047 — Business-scoped team administration

A selected-business Admin can invite Editor, Reviewer, Analyst or Viewer seats only to businesses they actively administer. They can change, remove and restore non-admin selected seats in those businesses. Account-wide endpoints remain restricted to account owners/admins. Only an account owner can assign/change Admin seats; accepting a non-owner invitation cannot downgrade an existing Admin seat.

Migration 040 centralizes invitation authorization for insert, acceptance and revocation. Acceptance rechecks the sender after acquiring the existing organization membership lock. Multi-business invitations require authority over every included business; revocation is atomic for the entire invitation. The organization daily invitation cap counts all invitations, including those hidden from a scoped administrator. A narrow definer-owned business-name lookup allows authorized multi-business invitation labels without relaxing normal business RLS.

Delegated request replay uses `app.business_invitation_requests`, isolated by organization, business and actor. The existing account-only idempotency policy stays unchanged. Creation audit records include the active business. Existing encrypted mail delivery, recipient verification, seven-day expiry and explicit role checks remain in use.

The business Team UI uses server capability flags. Selected admins see only businesses they administer in invitation choices, cannot select Admin, cannot manage account-wide people and do not receive an account-team management link. Access history and removal confirmation remain connected.

Acceptance covers real PostgreSQL forced RLS, actual authenticated routes and local SMTP; browser testing covers delegated invitation/revocation and accessibility. No external email delivery or cloud migration/application acceptance is implied. The dev database remains at 039 until migration 040 is explicitly deployed through the operator bootstrap flow.
