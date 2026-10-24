# Desvio initial threat model

M0 probes only. Authenticated tenancy/RLS, full secret scanning, OAuth, crawler SSRF and parser isolation have NOT passed. Mount separation is not application tenancy.

| Threat | Required control / current evidence |
|---|---|
| Cross-client data/access | Session membership + role, composite tenant FKs, non-owner DB role with forced RLS; M1 A/B tests pending |
| Client switch retains draft/account | Bind org+brand+version on all actions; reset active context; E2E pending |
| Website/document/skill prompt injection | Untrusted data; approved facts take precedence; no generic shell/network/secret tools. Inert importer/mount tests pass, actual agent policy pending |
| ZIP escape/bomb | Checksum, path/symlink/size/ratio validation. Negative tests pass |
| SSRF | DNS and redirect/subresource rechecks, private-IP denial and egress firewall; M2 pending |
| Malicious PDF/PPTX | File validation/scanning, isolated resource-limited parser with no secrets/network; pending |
| Duplicate paid generation/publication | Atomic tenant operation/credit reservation/outbox, disable submit retries, reconcile ambiguity. SDK probes pass; DB/worker proof pending |
| Edited asset uses old approval | Approval pins immutable version/account; edits invalidate approval; M3 pending |
| Postiz admin override | Per-org non-platform-admin credentials, server-only allowlisted headers and foreign-resource rejection; runtime proof pending |
| OAuth replay/confused deputy | Session/provider-bound single-use expiring state; callback/race/reconnect tests pending |
| Fake callback/media URL | Envelope validation + authenticated status, allowlisted downloads; no invented signature scheme |
| Object/vector/cache leak | Private signed assets, tenant-filtered retrieval and cache keys; M1/M2 pending |
| Cost escalation | Finite caps, exact allowlists, atomic ledger and quotas. Guard rejects absent/NaN/wildcard values; ledger pending |
| False readiness | Machine reports/source fingerprint, fail-closed release gate. Manual green flags cannot unlock M0 |

No customer signups/social tokens at M0. Postiz registration disabled. Never store secrets in repo/browser/prompts/logs/traces. The task SSH key remained outside repo/outputs; its temporary public-key registration was removed after host verification prevented the probe. Host checking was not disabled. Runtime access verification remains pending. Full dependency/container scans and legal/operational readiness remain launch blockers.

## Authenticated video output policy (24 October 2026)

The worker may explicitly select `HIGGSFIELD_OUTPUT_POLICY=authenticated_provider_result` instead of a manually maintained exact-CDN list. This is a deliberate egress-policy choice: arbitrary public HTTPS origins may be fetched only when their URL is the completed result of the authenticated Higgsfield request. It does not authenticate a CDN or make its bytes trusted.

`VideoProviderJobs.output` rechecks current job/tenant permission and completed state, opens the scope-bound authenticated ciphertext from the provider ledger, then returns an immutable worker-local provenance object. `VideoDownload.readProviderOutput` requires that exact object identity (WeakSet); a raw string, JSON round trip or lookalike object cannot authorize a download. The mint function is internal trusted worker code, never exposed as an HTTP or skill tool. The skill runtime cannot import or execute trusted-worker modules. This is an in-process provenance boundary, not cryptographic proof against compromised worker code.

Public-address validation, all-answer DNS rejection/pinning, TLS verification, credential-free fetches, redirect refusal, time/byte/content limits, networkless decode/re-encode and final permission/approval checks remain mandatory. The old exact-origin mode remains the default and keeps its allowlist enforcement even for authenticated results. Conflicting modes are rejected. A malicious or compromised provider can choose a public destination under the explicit policy, but cannot fetch private network services, forward provider credentials, or make an unvalidated asset publishable. No user-supplied reference or model-produced URL can enter this result path.
