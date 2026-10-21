# Architecture diagrams — Marketing OS (living design)

**Audience:** Codex implementers, tech leads, security, operations. **Status:** Target architecture; diagrams are not evidence of implemented functionality. Each `.mmd` file under `diagrams/` is the editable source. Diagrams below render directly on GitHub.

**Critical operating rule:** The customer-facing application is ours. Deep Agents executes the owner's skill files. OpenAI GPT Images and Higgsfield are model providers through server-side SDKs. Postiz is a **headless organic publishing component**, subject to tenant isolation, supported API and licensing proof. There are no coding-agent processes in the customer runtime.

## Quick visual previews (SVG exports)

For eight rendered SVG + PNG diagrams, see **[Diagram gallery](diagrams/INDEX.md)**.

These scalable exports can be viewed without Mermaid support. The editable system-of-record diagrams remain the `.mmd` files below.

![Marketing OS infrastructure](diagrams/exports/system-overview.svg)

![Brand onboarding to creative publishing](diagrams/exports/brand-onboarding.svg)

**Read alongside:** [PRODUCT.md](PRODUCT.md), [INTEGRATION_FIRST_BUILD.md](INTEGRATION_FIRST_BUILD.md), [CONFIGURE_AND_LAUNCH.md](CONFIGURE_AND_LAUNCH.md), [AGENTS.md](AGENTS.md).


## 1. System context and component ownership

Blue: our customer surface. Green: product-owned services and state. Amber: external/dependency boundaries. The graphic intentionally separates text/creative workflows, external model APIs, and publishing.

[Editable Mermaid source](diagrams/00-system-context.mmd)

```mermaid
flowchart TB
  user[Customer / Brand Marketer] --> ui[YOUR Marketing OS Web App]
  ui --> api[Marketing OS API / BFF]
  api --> auth[Auth, Org, RBAC, Billing]
  api --> brand[Verified Brand Brain]
  api --> agent[Deep Agents + 52 Marketing Skills]
  api --> job[Temporal Durable Workflows]
  agent --> job
  job --> img[OpenAI GPT Image Adapter]
  job --> vid[Higgsfield Video Adapter]
  job --> render[Fabric.js Project + FFmpeg Renderer]
  api --> pub[Internal Postiz Adapter]
  pub --> postiz[Self-hosted Postiz Service]
  postiz --> social[Authorized Social Accounts]
  img --> store[(Private Object Storage)]
  vid --> store
  render --> store
  api --> data[(PostgreSQL + pgvector)]
  brand <--> data
  api --> learn[Performance Learning Service]
  learn --> data
  postiz --> learn
  agent --> eval[Langfuse: traces and evaluations]
  classDef customer fill:#e7f2fe,stroke:#2563eb,color:#172554;
  classDef owned fill:#eaf7ee,stroke:#15803d,color:#14532d;
  classDef external fill:#fff7e6,stroke:#d97706,color:#78350f;
  class ui customer;
  class api,auth,brand,agent,job,render,pub,learn,data,store owned;
  class img,vid,postiz,social,eval external;
```

## 2. Trust, security and tenant boundaries

No browser-to-provider or browser-to-Postiz credentials. Web content, uploads, and imported skills are untrusted inputs. Authentication and row/asset authorization must be enforced server-side on *every* access.

[Editable Mermaid source](diagrams/01-trust-boundaries.mmd)

```mermaid
flowchart LR
  subgraph browser[UNTRUSTED: Customer Browser]
    web[Custom Web UI]
  end
  subgraph edge[TRUSTED: API Edge]
    auth[Auth, CSRF / RBAC, Tenant Scope]
    bff[Application API]
  end
  subgraph internal[TRUSTED: Private Network / Workers]
    vault[Secrets Manager]
    db[(Brand Data / RLS)]
    skills[Isolated Skill Runtime]
    media[Media Workers]
    pub[Postiz Adapter]
    postiz[Isolated Postiz Instance(s)]
  end
  subgraph outside[EXTERNAL / UNTRUSTED]
    sites[Brand Websites + Files]
    models[OpenAI + Higgsfield]
    social[Social Platform APIs]
  end
  web -->|Authenticated API only| auth --> bff
  bff -->|Tenant-scoped| db
  bff --> skills
  bff --> media
  bff --> pub
  skills -->|Read-only brand context| db
  sites -->|Sanitized ingestion; no instruction authority| skills
  vault -.->|Server only| skills
  vault -.->|Server only| pub
  vault -.->|Server only| media
  media -->|Server-side HTTPS| models
  pub --> postiz --> social
  classDef caution fill:#fff3d6,stroke:#c47a0b;
  class web,sites caution;
```

## 3. Onboarding and brand verification

Website and optional guidelines feed draft findings with citations. Correct/Wrong/Edit and conflict resolution precede immutable approval; crawl and parsing continue asynchronously without blocking first value.

[Editable Mermaid source](diagrams/02-onboarding-sequence.mmd)

```mermaid
sequenceDiagram
  autonumber
  actor U as Brand Owner
  participant UI as Marketing OS UI
  participant API as Marketing API
  participant T as Temporal
  participant Crawl as Crawl4AI
  participant Docs as Docling
  participant Brain as Brand Brain DB
  U->>UI: Enter website (or skip)
  UI->>API: POST /brands/onboarding
  API->>T: Start bounded discovery workflow
  T->>Crawl: Crawl allowed public pages
  Crawl-->>T: Pages + source metadata + images
  T->>Brain: Draft field findings + evidence
  API-->>UI: Partial draft + crawl coverage
  U->>UI: Upload PDF/PPTX/other guidelines (optional)
  UI->>API: Register signed upload
  API->>T: Parse document job
  T->>Docs: Parse text, page/slide visuals
  Docs-->>T: Structured text + evidence pointers
  T->>Brain: Merge findings; create conflicts
  UI->>API: GET findings and conflicts
  API-->>UI: Suggested facts + provenance
  loop Each high-impact or uncertain field
    U->>UI: Correct / Wrong / Edit
    UI->>API: PATCH finding decision
    API->>Brain: Persist decision + audit event
  end
  U->>UI: Approve brand profile
  UI->>API: POST /brands/{id}/activate
  API->>Brain: Create immutable approved version
  API-->>UI: Brand Brain active; ready to create
```

## 4. Skill Harness runtime

Skill documents are versioned by content hash and loaded via a tenant-scoped virtual backend. Skills provide instructions; only allowlisted typed tool adapters may perform network/model execution.

[Editable Mermaid source](diagrams/03-skill-harness-sequence.mmd)

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer
  participant UI as Our Creative Studio
  participant API as Marketing API
  participant T as Temporal
  participant A as Deep Agents Runtime
  participant S as Tenant-Scoped Skill Registry
  participant B as Approved Brand Brain
  participant M as Model + Tool Adapters
  participant Q as QA / Evaluation
  U->>UI: Create premium LinkedIn ad campaign
  UI->>API: POST /creative-jobs (idempotency key)
  API->>T: Reserve credits + enqueue job
  T->>A: Task, tenant scope, skill allowlist
  A->>S: Fetch verified skill content by hash
  S-->>A: social, ad-creative, image references
  A->>B: Retrieve confirmed facts / approved visuals
  B-->>A: Versioned, grounded context
  A->>M: Typed generateCopy / generateImage tools
  M-->>A: Text, asset IDs, usage, model metadata
  A->>Q: Brand claims + format QA
  Q-->>T: Score, revision requests, safety outcomes
  T->>API: Persist asset, cost, provenance, status
  API-->>UI: Editable creative + approval queue
  U->>UI: Modify and approve
```

## 5. Creative generation job states

A video provider job is not the final export. Persist external IDs, safely reconcile uncertain submissions and move through media copy, rendering, QA and user approval before publishing.

[Editable Mermaid source](diagrams/04-creative-async-state.mmd)

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Queued: Validated + credits reserved
  Queued --> Running: Dispatch to GPT Images / Higgsfield
  Running --> ProviderPending: Video provider returned job ID
  ProviderPending --> ProviderPending: Poll / verified webhook
  Running --> AssetCopying: Image result
  ProviderPending --> AssetCopying: Video completed
  AssetCopying --> Rendering: Persist originals privately
  Rendering --> QualityCheck: Fabric project / FFmpeg export
  QualityCheck --> ReviewPending: Pass QA
  QualityCheck --> NeedsRevision: Rework requested
  NeedsRevision --> Queued: New version + explicit retry
  ReviewPending --> Approved: Human approves
  ReviewPending --> NeedsRevision: Human edits / rejects
  Queued --> Failed: Terminal error
  Running --> Failed: Terminal error
  ProviderPending --> Failed: Terminal provider error
  Failed --> Queued: Operator-approved retry
  Approved --> [*]
  note right of ProviderPending
    Never blindly retry a paid request
    if submission outcome is ambiguous.
    Reconcile using provider job IDs.
  end note
```

## 6. Publishing and status reconciliation

A scheduled post is not necessarily a published post. Authorization, remote-ID mapping, deduplication, webhook/poll reconciliation and tenant isolation are release blockers.

[Editable Mermaid source](diagrams/05-publishing-sequence.mmd)

```mermaid
sequenceDiagram
  autonumber
  actor U as Brand Owner
  participant UI as Our Calendar / Approval UI
  participant API as Marketing API
  participant DB as Approval and Publish Ledger
  participant PUB as Tenant-Safe Postiz Adapter
  participant P as Self-hosted Postiz
  participant SOC as Social Provider
  U->>UI: Approve creative + schedule time
  UI->>API: Request schedule with idempotency key
  API->>DB: Check org, role, brand, asset approval
  alt Not allowed / wrong tenant
    DB-->>API: DENY
    API-->>UI: Error; no publish
  else Approved
    API->>DB: Reserve unique publication operation
    API->>PUB: Tenant-scoped schedule request
    PUB->>P: Upload asset and create post (verified API)
    P-->>PUB: Remote post ID / scheduled status
    PUB->>DB: Map tenant + account + remote ID
    DB-->>UI: Scheduled; final publishing not implied
    P->>SOC: Publish at requested time
    SOC-->>P: Publish result
    P-->>PUB: Webhook or polling result
    PUB->>DB: Reconcile actual publish status
    API-->>UI: Published / failed / unknown
  end
```

## 7. Continuous performance learning

Evaluation of a generation is distinct from outcomes of publication. Evidence-driven insights propose tests but never modify owner-approved brand facts or make unsupported causal claims.

[Editable Mermaid source](diagrams/06-learning-loop.mmd)

```mermaid
flowchart TB
  cr[Generated creative + DNA + versioned skills] --> pub[Approved publication / campaign]
  pub --> m[Source-specific metrics + timestamps]
  m --> n[Normalize objective, placement, audience, exposure]
  n --> ex[Compare under evidence thresholds]
  ex --> insight[Evidence-linked hypothesis + uncertainty]
  insight --> human[Human reviews experiment]
  human -->|Approved| brief[Structured variant / experiment brief]
  brief --> generate[Skill Harness creates controlled variants]
  generate --> cr
  approved[(Approved Brand Facts)] --> generate
  insight -.->|May suggest, never overwrite| approved
  classDef fact fill:#eaf7ee,stroke:#15803d;
  class approved fact;
```

## 8. Deployment for growth

Autoscale frontend/API/intelligence/media separately; run Postiz under a proven tenant-isolation strategy. Thousands-of-customers readiness depends on measured load, quotas, vendor access, cost budgets and incident handling.

[Editable Mermaid source](diagrams/07-deployment-scale.mmd)

```mermaid
flowchart TB
  customer[Web and mobile users] --> cdn[CDN / WAF / TLS]
  cdn --> web[Stateless Next.js replicas]
  web --> api[Stateless API replicas]
  api --> pg[(Managed PostgreSQL + pgvector / RLS)]
  api --> redis[(Redis Cache / Rate Controls)]
  api --> obj[(S3 / R2 Private Buckets)]
  api --> tq[Temporal cluster + namespaces]
  tq --> w1[Ingestion workers: Crawl4AI + Docling]
  tq --> w2[Intelligence workers: Deep Agents]
  tq --> w3[Media workers: FFmpeg]
  w2 --> oai[OpenAI APIs]
  w2 --> hf[Higgsfield API]
  w3 --> obj
  api --> postiz[Postiz Adapter / Tenant Isolation Boundary]
  postiz --> pz[Self-hosted Postiz deployment(s)]
  pz --> social[Social networks]
  api --> trace[OpenTelemetry + Langfuse]
  w1 --> trace
  w2 --> trace
  w3 --> trace
  policy[Autoscale by workload; enforce per-tenant limits; prove scale by realistic load tests]
  api -.-> policy
```

## 9. Core data ownership

Our application owns organizations, brand facts, creatives, approval and learning. Postiz owns its own tables; only references to remote identifiers belong in our data model.

[Editable Mermaid source](diagrams/08-data-ownership.mmd)

```mermaid
erDiagram
  ORGANIZATION ||--o{ BRAND : owns
  BRAND ||--o{ BRAND_PROFILE_VERSION : versions
  BRAND ||--o{ BRAND_SOURCE : ingests
  BRAND_SOURCE ||--o{ BRAND_FINDING : evidences
  BRAND ||--o{ CAMPAIGN : plans
  CAMPAIGN ||--o{ CREATIVE : generates
  CREATIVE ||--o{ CREATIVE_VERSION : revisions
  CREATIVE_VERSION ||--o{ ASSET : exports
  CREATIVE_VERSION ||--o{ PUBLISH_REQUEST : submits
  PUBLISH_REQUEST ||--o{ PERFORMANCE_SNAPSHOT : observes
  BRAND ||--o{ LEARNING_INSIGHT : remembers
  CREATIVE_VERSION ||--o{ SKILL_RUN : traces
  ORGANIZATION ||--o{ PROVIDER_CREDENTIAL_REFERENCE : configures
  ORGANIZATION {
    uuid id PK
  }
  BRAND {
    uuid id PK
    uuid organization_id FK
  }
  BRAND_PROFILE_VERSION {
    uuid id PK
    uuid brand_id FK
    string status
  }
  CREATIVE_VERSION {
    uuid id PK
    string skill_digest
    string model_id
  }
  PUBLISH_REQUEST {
    uuid id PK
    string remote_post_id
    string state
  }
  PROVIDER_CREDENTIAL_REFERENCE {
    uuid id PK
    string secret_manager_ref
  }
```

## 10. Backend-first build order

Each stage is gated by customer-visible functionality *and* real behavior. UI-only screenshots are not shippable milestones.

[Editable Mermaid source](diagrams/09-build-order.mmd)

```mermaid
flowchart LR
  m0[M0 Prove OSS and SDK contracts] --> infra[M1 Tenant-safe skeleton + live Postiz service]
  infra --> onboard[M2 Real crawling + upload + review]
  onboard --> slice[M3 Real skill and GPT Image + approval + Postiz]
  slice --> video[M4 Higgsfield + video render + analytics]
  video --> learn[M5 Learning + billing + load hardening]
  learn --> paid[M6 Optional paid ads API]
  blocked[No UI-only completion. Live integrations must pass gates.] -.-> slice
  classDef gate fill:#fff1f2,stroke:#be123c,color:#9f1239;
  class blocked gate;
```


## 11. Release readiness and live-proof gate

[Editable Mermaid source](diagrams/10-release-readiness.mmd)

```mermaid
flowchart TB
  code[Feature code and UI] --> contract[Typed adapter and real upstream contract]
  contract --> local[Offline tests and durable state]
  local --> key{Real permitted staging credentials?}
  key -->|No| blocked[ADAPTER_READY: BLOCKED for launch]
  key -->|Yes| live[Cost-capped allowlisted live smoke test]
  live --> result{Provider result persisted and traceable?}
  result -->|No| blocked
  result -->|Yes| secure[Two-tenant tests, secret scans, failure recovery]
  secure --> pass{All safety and ops checks pass?}
  pass -->|No| blocked
  pass -->|Yes| ready[LAUNCH_READY: scoped capability]
  ready --> deploy[Enable in custom Marketing OS UI]
  classDef red fill:#fff1f2,stroke:#be123c,color:#9f1239;
  classDef green fill:#eaf7ee,stroke:#15803d,color:#14532d;
  class blocked red;
  class ready,deploy green;
```


## 12. Image, video and skill provider operations

[Editable Mermaid source](diagrams/11-provider-operations.mmd)

```mermaid
sequenceDiagram
  autonumber
  actor U as Customer
  participant UI as Our Creative Studio
  participant API as Tenant-Safe API
  participant T as Temporal Worker
  participant S as Skills + Brand Brain
  participant O as OpenAI Image Adapter
  participant H as Higgsfield Video Adapter
  participant AS as Private Asset Store
  participant QA as Render + QA
  U->>UI: Request on-brand static and video ads
  UI->>API: Submit creative brief and approval policy
  API->>T: Reserve credits; enqueue immutable job
  T->>S: Load approved brand and allowed skills
  S-->>T: Structured prompts and visual constraints
  par Image production
    T->>O: Generate image (server-side key)
    O-->>T: Real asset bytes and usage metadata
  and Video production
    T->>H: Submit video model request
    H-->>T: Provider job ID
    loop Reconcile by poll or verified callback
      T->>H: Fetch actual job status
      H-->>T: Pending / success / failed
    end
  end
  T->>AS: Copy provider media to private storage
  T->>QA: Build editable project and evaluate
  QA-->>API: Versioned render, QA and cost
  API-->>UI: Persisted preview / edit / reject / approve
  U->>UI: Approve final version
```


## 13. Tenant isolation, budgets and runtime policy

[Editable Mermaid source](diagrams/12-tenant-and-cost-controls.mmd)

```mermaid
flowchart LR
  browser[Customer browser] --> edge[Auth + org + brand scope]
  edge --> quota[Rate and budget reservation]
  quota --> queue[Temporal per-tenant workload queues]
  queue --> skill[Isolated skill runtime]
  queue --> image[OpenAI image adapter]
  queue --> video[Higgsfield video adapter]
  queue --> publish[Postiz adapter with proven account mapping]
  skill --> facts[(Versioned brand context)]
  image --> ledger[(Usage and cost ledger)]
  video --> ledger
  publish --> ledger
  facts --> db[(Tenant-scoped PostgreSQL RLS)]
  ledger --> db
  image --> media[(Private tenant assets)]
  video --> media
  publish --> remote[Authorized social accounts]
  vault[Secrets Manager] -.-> image
  vault -.-> video
  vault -.-> publish
  policy[No cross-tenant context, assets, creds or publishing] -.-> edge
  classDef warn fill:#fff7e6,stroke:#d97706;
  class policy warn;
```

**Release rule:** Follow [NO_FAKE_FEATURES_RELEASE_GATE.md](NO_FAKE_FEATURES_RELEASE_GATE.md). Diagrams are design intent, not proof of integration.
