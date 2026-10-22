# Approved source images in Canvas

Status: implemented and regression-tested locally at `19b9fc8`. All six verification suites pass at matching unchanged source. Release remains BLOCKED; not live verified.

A customer can explicitly permit a saved website capture or uploaded document page to be sent to the image provider, then select up to three approved references for a Canvas request. This is separate from approving facts or style suggestions. Existing three-step onboarding remains unchanged.

Migration 022 stores immutable source links, approval identity/time, revocation time and ordered job selections. Composite foreign keys and forced RLS prevent references crossing businesses. Only the application can approve/revoke or attach references to queued requests. The creative worker can read only its selected references and their source pixels. The application cannot rewrite approval identity, source or label; approving again after revocation creates a new identity.

The worker verifies stored length, hash, JPEG dimensions and bounded decoding before planning. It normalizes each reference to PNG inside a 1536-pixel box. It sends private bytes, not storage URLs, through the existing official SDK. The prior creative image comes first for edits, followed by selected references. An empty selection preserves the existing create/edit behavior. Input fingerprints include reference identity and original/transformed hashes. Saved creative manifests retain provenance; retries use the existing paid-call ledger.

Before reserving each new model call, the worker checks current approval. A revocation blocks future submissions; it cannot retract an already submitted provider call. Previously saved versions remain available. The configured maximum image reservation is multiplied by one plus the number of selected references, conservatively holding extra budget. Actual cost settlement and account-specific live cost/fidelity acceptance remain open.

Official contract inspected: [Image API edits with an array of uploaded images](https://developers.openai.com/api/docs/guides/image-generation#edit-images), plus pinned `openai` 7.39.0 types. Multipart ordering and actual decoded bytes are verified with MOCK provider responses. No default model change or paid call was made.

Development evidence: real local PostgreSQL/private storage/skill/Temporal tests cover approval, viewer/outsider denial, replay, revocation, reference corruption and immutable approval fields. Browser checks cover document approval/preview/removal and selecting a website reference through a real Canvas job and saved editable creative. These fixtures do not prove provider output quality.

Remaining scope includes product-photo/logo extraction and selection, arbitrary uploaded image references, cropping, richer creative formats, deployed runtime/storage, authorized live output quality and actual usage settlement. Whole-page references are an implemented source type, not a substitute for those requirements.
