# Provider contracts — 2026-10-21

**SDK/source verification only. No product adapter, persistence or paid live proof at PR-00.**

## OpenAI

`openai@7.39.0`, official `src/resources/images.ts`: images.generate → POST /images/generations; images.edit → multipart POST /images/edits. Actual SDK probes use intercepted fetch for create/edit, base64 output, 401/403/429/500 and ambiguous connection failure. All response bytes are marked MOCK. Explicit maxRetries:0 prevents automatic resubmission; default is two retries.

[Official image guide](https://developers.openai.com/api/docs/guides/image-generation) confirms create/edit/reference operations. Model availability, account verification/funding, real byte validation, private storage, cost/credits and error recovery remain to implement/test. Use configured capability-checked models, not assumed account access. No provider deduplication guarantee established.

## Higgsfield

`@higgsfield/client@0.2.6`, import `@higgsfield/client/v2`. createHiggsfieldClient accepts credentials key:secret or apiKey/apiSecret. Wire header: Authorization: Key id:secret. subscribe(endpoint,{input,withPolling:false}) returns remote request fields; maxRetries:0 must be explicit. Inputs are sent directly, not nested in params. SDK has no public getStatus/cancel method.

Use authenticated [GET /requests/{request_id}/status](https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status) in durable polls. Validate request IDs and host before attaching credentials. SDK status type omits documented canceled state, so validate actual HTTP output independently.

[Overview](https://docs.higgsfield.ai/docs) documents higgsfield/genjutsu/motion-transfer/v1.0 with video_url/image_urls. M0 tests that route against a local mock only; this is not the selected final creative-video model or account-access proof. M4 must freeze model-specific scene/generation contracts and supported revisions from official model docs/console.

SDK webhook options include secret, but inspected `dist/v2/client.js` does not transmit it or verify a signature. [Official webhook documentation](https://docs.higgsfield.ai/docs/how-to/webhooks) establishes delivery envelopes/retries, not HMAC authentication. Treat callbacks as reconciliation signals and verify terminal state through authenticated polling. Deduplicate, preserve request IDs and copy outputs to owned storage.

## Deep Agents

`deepagents==0.7.29` with transitive dependencies in uv.lock. Actual SkillsMiddleware(backend=...,sources=['/skills/'],tools=[]) discovers social, product-marketing, ad-creative, image and video. Per-run read-only memory mount contains selected skill trees and /.agents/product-marketing.md only. Tests verify reference bytes and two separate brand mounts. No CLI/host shell/credentials are mounted.

This proves discovery, not authenticated tenancy or a real marketing agent. M3 must execute actual skill selection, record hashes, validate output JSON and enforce typed tool grants outside model instructions. [Official skills docs](https://docs.langchain.com/oss/python/deepagents/skills).

Crawl4AI 0.9.5 and Docling 2.141.0 now have scoped local implementations, along with application tenancy/private storage. See ADR0006 and ADR0007 for contracts and limitations. OpenAI structured onboarding uses responses.create with strict text.format, bounded output, store:false and zero automatic retries; model tests are MOCKED. Model vision interpretation, Fabric/FFmpeg creative workflows, analytics and learning remain incomplete. Read generated evidence for current scoped readiness; no provider is implicitly live verified.
