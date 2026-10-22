# 0018 — Customer publishing and business overview

Date: 2026-10-22. Status: implemented locally; deployed/live acceptance pending.

## Scope and architecture

Extend the existing business-scoped Nest/Next/PostgreSQL/Temporal/private-storage workflow from ADR 0017. No provider UI, new architecture, migration or live authorization. `Publishing` remains disabled unless the existing server configuration, verified private binding and expiring destination grant permit it.

`GET /api/v1/businesses/:id/publications/ready` shares the worker's exact current-image approval query. It returns safe identifiers/caption/date/hash, never storage keys. Candidates are LinkedIn posts within the existing one-minute/31-day window, with no nonterminal or accepted publication. Mutation-time checks remain authoritative. `publications` includes saved account names, current management permission and only allowed destinations.

`GET /api/v1/businesses/:id/overview` uses genuine session/business resolution and the existing forced-RLS transaction. Counts and recent jobs come from that business's rows. Publishing counts describe last observations; approved posts can also have publication requests. Engagement, usage and AI performance recommendations are not fabricated.

## Customer experience

`publishing.tsx` loads the actual private canonical PNG through a short-lived grant, validates its length and SHA256 against both the grant and approved snapshot, then requires successful image display. The user selects an exact destination and explicitly authorizes the image, caption and scheduled time. Changed approvals or existing requests disable confirmation. API/worker revalidation covers changes after that check.

The client preserves an idempotency key across ambiguous submission responses and refreshes persisted state. The backend's unique active-slot guard prevents a new key from duplicating an accepted/uncertain request. No timer or page visit submits a post. Only pre-submission cancellation and read-only status reconciliation are exposed. The interface distinguishes saved, submitted, observed scheduled, published, uncertain, failed and missing states. A status-check failure does not erase earlier history. No remote retry/cancel/reschedule is invented.

Business Overview shows actual review/creative/job/publication counts, recent work, uncertain-publication attention and links to real modules. The existing business switcher remounts scoped screens. Account-level selection remains separate. The existing warm V5 styles and native controls are retained.

## Verification and limits

The focused backend suite exercises ready-list proof, safe response fields, genuine overview counts, readonly access and foreign/sibling isolation in addition to the prior publishing tests. The browser suite uses actual Next/Nest/Better Auth/PostgreSQL/private S3/canonical Fabric renderer/Temporal. Its only social upstream is explicitly MOCK Postiz HTTP; seeded creatives are labeled TEST FIXTURE.

Five journeys cover successful confirmation/history/overview, uncertain writes, corrupted preview/stale approval, pre-submit cancellation/lost client response, and missing observations/readonly/foreign/business switching. Desktop/mobile accessibility, overflow, browser errors and no credential/browser-storage leakage are checked. Saved screenshot evidence is inspected locally. `make verify-publishing-ui` records source-bound results; focused suites do not replace full security/browser regression.

Real provider consent/publication, deployed runtime/source equivalence, callback ingress, account lifecycle/operator recovery, remote cancellation/rescheduling, other formats/channels and analytics remain open. No LIVE_VERIFIED or LAUNCH_READY status is granted. No paid model or live social request is part of this work.
