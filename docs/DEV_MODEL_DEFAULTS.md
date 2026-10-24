# Dev model activation — 24 October 2026

Workspace defaults use the same administrator-only preview/hash/apply transport as business grants. A manifest sets `scope: "workspace_defaults"`, omits `business_id`, and identifies an exact `organization_id`. It affects only businesses created afterward. Existing business grants require their own explicit update. Publishing is rejected in this scope. Expiry is absolute, and each business receives separate grant and usage records. NULL lifetime budget is an explicit operator decision, not the default for all tenants.

Official contracts fetched on 24 October:

- [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) supports text/image input, Responses, structured outputs and tools. Snapshot `gpt-4.1-2025-04-14` is available in the documented catalog.
- [Standard pricing](https://developers.openai.com/api/docs/pricing): GPT-4.1 input $2/million and output $8/million tokens, equivalent to 2 and 8 microdollars/token.
- [GPT Image 1](https://developers.openai.com/api/docs/models/gpt-image-1) was retired October 23. Do not activate that old model ID.
- [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) supports generation and editing. [Image guide](https://developers.openai.com/api/docs/guides/image-generation) confirms PNG/base64 output, image edit inputs, `safety_identifier`, existing 1024/1536 sizes and low/medium/high quality. These match the deployed adapter. Account eligibility still requires the owner's actual test.

The planned initial dev defaults use the documented GPT-4.1 snapshot for analysis, planning, captions and video prompts, and GPT Image 2.5 Sunburst for visuals. Image request reservations are conservative operator estimates, not a claim of exact provider billing or an API-enforced spending limit. A configured grant does not establish model entitlement, funded balance or live generation success.

No paid generation was performed during this documentation/configuration work. Video activation is separate and remains gated on verified provider download handling; social authorization is separate.
