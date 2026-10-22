# ADR 0025 — Edit retained style and preserve interrupted review drafts

Status: implemented; final local verification in progress. No live provider evidence.

## Decision

Retained visual preferences remain editable through the existing scoped Brain review API. The server resolves only rows referenced by the latest approved Brand Brain, verifies their immutable evidence digest and identity, and applies the same membership locks, revisions and replay checks as current suggestions. A replacement analysis for that category removes the older row from the editable set. No model request is needed to edit or remove an existing preference.

Retained review rows are fetched in one scoped query. New approval freezes the current accepted values; removal excludes the preference from the new snapshot. Existing approved snapshots and source evidence remain unchanged. Before final profile approval, the customer can restore the last approved value after marking a style for removal.

## Customer behavior

Retained preferences use the existing visual-review cards with Edit, Remove style and Restore approved style. An editor remains mounted if a background analysis replaces or removes its suggestion, including empty analysis results. Stale text is retained for copying, while saving against replaced evidence is blocked. Discarding is explicit.

The next onboarding step is disabled while edits or decision saves are pending. Text is read-only during the save itself to prevent keystrokes from being discarded by a successful response. Failed saves keep the draft editable. Draft text stays in memory; it is not copied into browser storage.

## Verification and remaining scope

Real PostgreSQL/RLS tests cover retained edits, safe replay, immutable old snapshots, removal, replacements, foreign/viewer denial and evidence tampering. The browser journey uses explicit background-analysis database fixtures and actual review/profile APIs to cover no-new-AI editing, retained drafts, removal/restore and approval. These fixtures do not prove live visual-model quality.

This adds no migration, provider endpoint, credential or architecture change. Richer image-based PDF/PPTX extraction, cleared brand asset selection, deployed private runtimes and authorized real-model acceptance remain open. The full product goal remains active.
