# Architecture diagram gallery

**Edit `../ARCHITECTURE.md` and `*.mmd` as the source of truth.** These SVG and PNG exports are readable previews of the intended architecture, not evidence of working integrations. The hand-rendered Graphviz previews preserve the essential architecture; refer to the Mermaid sequences for exact interaction details.

| Diagram | SVG preview | PNG preview | Editable source |
|---|---|---|---|
| End-to-end system | [SVG](exports/system-overview.svg) | [PNG](exports/system-overview.png) | [Mermaid](00-system-context.mmd) |
| Website onboarding and Brand Brain | [SVG](exports/brand-onboarding.svg) | [PNG](exports/brand-onboarding.png) | [Mermaid](02-onboarding-sequence.mmd) |
| Skill Harness and brand context | [SVG](exports/skill-harness.svg) | [PNG](exports/skill-harness.png) | [Mermaid](03-skill-harness-sequence.mmd) |
| OpenAI image / Higgsfield video jobs | [SVG](exports/creative-jobs.svg) | [PNG](exports/creative-jobs.png) | [Mermaid](11-provider-operations.mmd) |
| Headless Postiz publishing | [SVG](exports/publishing-integrations.svg) | [PNG](exports/publishing-integrations.png) | [Mermaid](05-publishing-sequence.mmd) |
| Evidence-based learning | [SVG](exports/learning.svg) | [PNG](exports/learning.png) | [Mermaid](06-learning-loop.mmd) |
| Scalable deployment | [SVG](exports/production-deployment.svg) | [PNG](exports/production-deployment.png) | [Mermaid](07-deployment-scale.mmd) |
| Release gate (no fake features) | [SVG](exports/release-gates.svg) | [PNG](exports/release-gates.png) | [Mermaid](10-release-readiness.mmd) |

## Other architecture source diagrams

- [Tenant trust boundaries](01-trust-boundaries.mmd)
- [Async creative state machine](04-creative-async-state.mmd)
- [Data ownership ERD](08-data-ownership.mmd)
- [Backend-first build order](09-build-order.mmd)
- [Provider operations sequence](11-provider-operations.mmd)
- [Tenant and cost controls](12-tenant-and-cost-controls.mmd)

Every integration arrow in these diagrams requires a typed adapter, persisted state, documented failure and retry policy, tenant authorization checks, and a reproducible test before the corresponding feature can be shown as complete. See [No Fake Features Gate](../NO_FAKE_FEATURES_RELEASE_GATE.md).

## Recommended reading order for Codex

1. [System overview](exports/system-overview.svg) + [trust boundaries](01-trust-boundaries.mmd)
2. [Onboarding](02-onboarding-sequence.mmd) + [Skill Harness](03-skill-harness-sequence.mmd)
3. [Provider operations](11-provider-operations.mmd) + [async creative state](04-creative-async-state.mmd)
4. [Postiz publishing](05-publishing-sequence.mmd) + [learning](06-learning-loop.mmd)
5. [Deployment](07-deployment-scale.mmd) + [release gates](10-release-readiness.mmd)
