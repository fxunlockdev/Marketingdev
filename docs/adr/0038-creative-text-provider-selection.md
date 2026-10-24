# ADR 0038: direct Canvas text provider selection

Canvas image briefs and video scripts accept OpenAI or Gemini. Images still use OpenAI and videos still use Higgsfield. Existing official SDK adapters and the isolated original skill runtime are reused. No provider fallback or alternate platform architecture is introduced.

Migration 034 snapshots the selected text provider and operator-approved model on each request. Worker calls must match this snapshot and the currently enabled, unexpired grant. A request created without a grant cannot silently acquire a model after an operator enables one. Feedback video regeneration preserves its provider; a fresh model snapshot is taken for the new request. Existing OpenAI request fingerprints remain compatible.

OpenAI keeps its existing combined text/image allowance. Gemini creative text has its own operator-owned grant and ledger provider field; calendar planning grants cannot authorize creative spending. Image ledger entries must use OpenAI. Grants are tenant-scoped, immutable to customers and workers; API access to the existing OpenAI grant is limited to model/eligibility columns. Provider uncertainty remains non-retryable without reconciliation. No keys enter browser controls or skill inputs.

Only video has prompt approval before generation. Text drafting itself consumes the selected text-model allowance. Images generate directly from the submitted request; both media retain exact-version review before publishing. Reviewer and Analyst roles cannot execute previously queued generation after an editor downgrade.

Local tests use actual tenant roles, PostgreSQL, storage, Temporal, original skills and canonical renderers with explicitly mocked official SDK transports. They do not establish model quality, live billing behavior, real Higgsfield acceptance, Postiz publication or deployment readiness.
