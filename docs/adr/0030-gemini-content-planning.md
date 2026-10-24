# OpenAI/Gemini content planning

## Verified contract and pin

`@google/genai` is pinned to **2.30.0** in package.json/package-lock.json (Apache-2.0; Node >=20, within this repository's Node >=22 requirement). The installed SDK's `GoogleGenAI.models.generateContent`, `GenerateContentParameters`, `HttpOptions`, `HttpRetryOptions`, `Part`, `FunctionDeclaration` and `ApiError` contracts were inspected. This adapter uses the Gemini Developer API through the official SDK, with `vertexai: false`, API version `v1beta`, a 120-second timeout and one total attempt. SDK automatic function calling is disabled; only the existing isolated skill runtime executes its allowlisted `read_file` tool.

Primary references inspected:
- [Official JavaScript SDK](https://googleapis.github.io/js-genai/release_docs/index.html)
- [Google thinking/signature documentation](https://ai.google.dev/gemini-api/docs/thinking)

The SDK exposes generateContent alongside the newer Interactions API. No custom endpoint, guessed model default or OpenAI-compatible gateway is introduced. An operator enables a specific model name in a scoped grant. Wire tests use the official SDK with explicitly MOCK HTTP responses, including its generated route and native function-response serialization; these are not live acceptance.

## Persisted choice and funding

Migration 028 adds a provider discriminator to planning grants/calls and immutable provider/model fields to requests. Existing grants become OpenAI grants. Existing requests are backfilled from their business's OpenAI grant where available. New requests snapshot the selected model at submission; an unfunded request has no selected model and fails closed. Changing a grant to another model cannot silently change an already queued request. A user cannot update these columns or funding rows.

Each provider has its own expiry, rates, allowance and conservative reservation history. No fallback changes the selected provider or spends another allowance. Definite provider rejections do not retry automatically. Ambiguous network outcomes remain held and block a new planning request until reconciled. The maximum response count is one, with bounded input/output reservation before every model step.

## Skill context

Gemini signed response parts remain in their original order and structure through `PlannerResponse.provider_context`, private persisted call results, the Python broker's AIMessage metadata, and the next native model request. Tool names and arguments must match the signed context. Only bounded text/function-call/signature parts are accepted. Customer-visible content excludes thought parts; provider keys never enter the skill container. OpenAI rejects Gemini context rather than silently dropping it.

The original marketing-plan, product-marketing and social skills remain pinned and run in the existing isolated runtime. Brand facts, tenancy, output validation, video-generation approval and review gates are unchanged.

## Configuration and scope

Set `GEMINI_API_KEY` only on the provider worker, never the browser or customer API. A valid per-business `planning_grants` row for `provider='gemini'`, a specific Gemini model, expiry, rates and explicit budget is also required. The operator provisioning experience is still unfinished; these internal primitives are not presented as a completed no-code setup flow.

Canvas and calendar plan forms expose OpenAI/Gemini. This covers static/video calendar concepts, storylines, scripts and initial prompts. Direct Canvas image creative planning and the separate final video-script planner still use their existing OpenAI configuration. Gemini support for those paths, live quality/cost acceptance, recurring planning and cloud deployment remain open. No paid/live call was made for this change.

## Local verification

At unchanged source `f62fbfeadd215553e08c4c43caf9c1fa85fa4d28d7d749a43deb76affe13bcc8`, offline (4), contracts (78), video/export cases (9), Canvas/calendar browser journeys (6), security account/application cases (24 + 139), six guards and root/media dependency audits pass. The security suite includes twelve planning cases. Native Gemini signed tool turns, funding separation, immutable request/model choice and unknown-outcome holds are covered with MOCK responses. Release remains blocked for historical broader browser evidence and incomplete deployed/live product E2E.
