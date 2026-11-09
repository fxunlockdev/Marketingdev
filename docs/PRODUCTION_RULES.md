# Owner production rules integration

The owner-supplied 9 November 2026 category document is an additional, inert `desvio-production` skill. It does not replace or modify the existing marketing-skills or Brand Engine archives.

## Private source and scope

The repository is public. Source instructions, the curated Markdown skill, its ZIP and client/project extracts are intentionally ignored by Git. The local operator backup is `work/production-rules-private` in the main checkout. Restore its `inputs/` and `skills/` contents into an authorized checkout before building the skills image. Never place the full source in a public issue, log, browser bundle or repository.

`inventory/desvio-production.json` records the source, archive, tree and per-file hashes without their contents. No redistribution license is implied. The original attachment is preserved byte-for-byte. The shared runtime package excludes all named-client sections and the dated promotional film treatment. Those extracts require explicit organization, brand and project binding before they can become approved brand context. Matching a client name in a prompt cannot activate them.

Curated shared guidance generalizes client examples and makes historical calendars proposed defaults, not global entitlements. The logo category is retained in the private bundle for future supported logo work; current task routes do not claim to implement a logo workflow. Desvio identity proposals do not change application branding.

## Runtime behavior

`scripts/production_rules_audit.py` verifies the exact ZIP digest, bounds its entries/size and admits only safe Markdown paths. The runtime mounts its core skill plus task-relevant references:

| Task | Reference selection |
| --- | --- |
| Images and ads | Evidence, identity, art direction, composition, copy, visual production, styles, resolution, handoff and quality |
| Carousels | Evidence, identity, composition, copy, art direction, visual production, styles and quality |
| Video and Reels | Evidence, identity, legibility, copy, production/approval and quality |
| Campaign planning | Evidence, customer research, art direction, styles, calendar and production |
| Performance analysis | Evidence, research, scope and feedback; no visual-style instructions |

References are preloaded locally into the first planning request and recorded in the read manifest. This avoids an additional model/tool round trip but increases input context tokens. No latency or output-quality improvement is claimed from this change alone.

The existing approved brand snapshot remains the only business-fact source. Tools remain read-only, network-disabled and credential-free. Guidance cannot grant publishing permission, approve media reuse or replace output validators. Real rendering, visual inspection, disclosure handling, persistence and approvals remain application responsibilities. No actual QA or publication is implied by reading a rule.

New sandbox results require the current production pin and core read. Persisted legacy plans may retain the exact previous audited skill set so existing drafts and retries remain usable. Their provenance is not rewritten to falsely claim they used the new rules. Unknown, duplicate, missing original skills and changed hashes remain rejected.

## Updating and building

1. Review changes against the private original and preserve client/project scope.
2. Update the private `skills/desvio-production/` Markdown. Repackage deterministic Markdown entries in `inputs/desvio-production.zip`.
3. Review and update the archive pin, public hash inventory and API skill pin together. Never auto-trust a changed bundle on startup.
4. Run the audit, contract and actual isolated-runtime tests. Restore private inputs locally if missing.
5. Build and roll out the trusted worker and skills image together. Keep the previous worker and immutable images for rollback. The API must accept old saved manifests during transition.

The skills Docker context explicitly includes only the runtime ZIP, never the original or client/project extracts. Hosted builds and real isolated-runtime checks are recorded separately in release evidence. Model responses in integration tests are mocked; these checks demonstrate routing, provenance and isolation, not aesthetic quality or production readiness.
