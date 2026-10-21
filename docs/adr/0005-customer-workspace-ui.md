# ADR 0005 — customer accounts, client workspaces and brand files

Desvio now has a custom Next.js/React customer interface for the existing authenticated APIs. This is a local implementation milestone. Website discovery, Brand Brain review, image/video creation, creative editing, approval and social publishing remain separate unfinished flows; none is presented as a working control.

## Experience and implementation

`apps/web/app` contains the responsive shell, dynamic page route, metadata and design tokens. `apps/web/components` contains account forms, client/brand views, private-file handling, team management and invitation acceptance. Plain native controls provide keyboard behavior; visible focus, a skip link, labels, error announcements and reduced-motion support are included. The visual direction follows PRODUCT_EXPERIENCE: paper backgrounds, charcoal text, a single blue action color and quiet client identity tiles. No external fonts, tracking or decorative live metrics are loaded.

- Account creation requests a real verification email. Sign-in, resend verification, password recovery/reset and sign-out use Better Auth's actual backend. Password fields clear after success and never enter web storage.
- Client and brand navigation remains explicit. Page components are keyed by route, removing the previous client's in-memory data on switching. Authorization is always rechecked by the backend. Empty states describe the next available action.
- Brand create uses an idempotency key; edits include the saved revision. Failed saves retain entered values. Stale edits require an explicit review/reload of the saved version. Ambiguous client creation disables resubmission until the user refreshes the saved client list; client creation itself is not yet backend-idempotent.
- File selection computes a local SHA-256 and requests a scoped signed upload. The browser calls only that storage grant and same-origin APIs. A failed upload retains the selected File for retry; an ambiguous submit retains its reservation ID. The backend validates bytes with the real durable worker. The saved list survives reload; it exposes actual file/job state, cancellation and ready-only downloads. Asset listing adds the corresponding job ID/cancellation state under existing RLS so cancel remains usable after reload.
- Invitations, role changes, removals and revocation call the real team API. Removal requires an explicit inline confirmation. Email acceptance is described as accepted by the mail server, never as delivery. The invitation token survives sign-in in a URL fragment, is cleared on the acceptance screen, and is posted only to the same-origin acceptance API. New invitees can create/verify an account before returning to the invitation.
- A session expiring during a save leaves the form in place and offers sign-in in a separate tab. Retrying then uses the same draft. Native navigation warnings protect unsaved brand edits and in-flight uploads; they are not a persisted draft/autosave system.

## Runtime and security boundaries

Next.js 16.4.2, React/React DOM 19.3.1, Playwright 1.64.1 and axe-core Playwright 4.14.0 are exactly locked. The web server receives no DB/password/provider/mail/object-store secret. `API_ORIGIN` is a server-only build-time rewrite destination. `S3_BROWSER_ORIGIN` supplies the exact storage origin allowed by Content-Security-Policy. No NEXT_PUBLIC secret settings exist.

Pages render dynamically with nonce-based script policy, same-origin forms, no object embeds/framing, no-referrer and no-store. Development alone permits unsafe-eval for Next tooling. Inline styles remain allowed for framework compatibility. React escapes customer names and text. CSP is an additional boundary, not proof against every XSS vector.

The API remains the authentication/authorization boundary. Local Next rewrites preserve cookie/origin semantics. Production ingress, forwarded-IP trust, API throttling across replicas and external HTTPS/cookie validation remain unfinished: the local proxy makes requests appear to the API as loopback and is not the production ingress design.

Browser uploads require a private bucket with CORS allowing the exact app origin, PUT and the content-type header. Tests configure this on a disposable Garage bucket through the actual SDK. This does not verify Railway/AWS bucket settings. Signed download bearer grants retain their documented 60-second expiry window.

Development commands: build the API (`npm run build`), configure and run API/worker processes, then `API_ORIGIN=... S3_BROWSER_ORIGIN=... npm run dev:web`. For a built server, set API_ORIGIN when building (`npm run build:web`) and S3_BROWSER_ORIGIN when starting. The example template documents public origin versus private API origin. Existing `make dev` remains explicitly incomplete until the full stack has reproducible operator provisioning.

## Evidence

`make verify-browser` starts disposable real PostgreSQL, SMTP, Garage, full-signature ClamAV and Temporal services, builds the actual Next application and drives Chromium through its public UI. There are no mocked auth, storage, email, worker or provider success responses. A deliberately aborted browser PATCH tests network-failure recovery only. Tests cover signup/email verification, account login, client/brand persistence, actual upload/download, failed/stale edits, invitation through sign-in, viewer denial, password recovery, session recovery, mobile overflow, keyboard reachability and scoped axe checks.

`make verify-security` retains server-side isolation and failure tests. Evidence is machine-generated with a source fingerprint excluding generated Next output and incremental compiler files. Browser success does not grant LIVE_VERIFIED or LAUNCH_READY. Axe is limited to inspected pages and does not replace manual screen-reader review or a full WCAG audit.

Primary framework contracts: [Next rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), [Next headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), [Playwright browser installation](https://playwright.dev/docs/browsers). Local pinned package declarations and actual browser behavior are authoritative for this slice.

Next: complete brand intake and source-backed verification, connect the approved Brand Brain to skill selection and actual generation/revisions, then approvals and verified social publication. Production setup, deliverability, quotas, telemetry, deletion/retention, complete draft recovery and browser-engine coverage remain part of the end-to-end goal.
