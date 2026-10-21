# DESVIO V5 — UI NAVIGATION AND VISUAL HANDOFF

This document is for implementation designers and frontend engineers. It supersedes old UI navigation while preserving its color system and soft, sophisticated editorial presentation. For service logic use `DESVIO_UI_V5_PRODUCT_SPEC.md`.

## Exact navigation

| Group | Sidebar label | Default right-hand context | Core empty state |
|---|---|---|---|
| Home | Overview | All authorized businesses (aggregate) or selected business | “Your first brand is one step away” |
| Marketing | Brands | Cards for 0–3 authorized active businesses | “Add your first business” |
| Marketing | Content Plan | Selected business / this month | “Create your first 30-day plan” |
| Marketing | Review Inbox | Selected business / All connected channels / next 30 days | “No posts awaiting review” |
| Marketing | Canvas | Selected business / conversation + editable preview | “What would you like to create for [business]?” |
| Marketing | Publishing & Analytics | Selected business / Schedule tab | “Connect a channel to start publishing” |
| Intelligence | Memory | Selected business / Brand knowledge | “Confirm your brand to activate memory” |
| Management | Connections | Selected business / connection status cards | “Connect your first social account” |
| Management | Team | Selected business / scoped members | “Invite someone to this business” |
| Account | Billing | Account / plan+business usage | “View your subscription” |
| Account | Profile | User / personal settings | “Complete your profile” |

## Quick wireframes

### Brands index

```text
DESVIO  Overview  >  Brands                                 [2/3 businesses]  [+ Add business]

Your businesses
One place for each brand’s content, knowledge and channels.

  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────────┐
  │  [Logo] Brand A   │  │  [Logo] Brand B   │  │       ＋            │
  │  Brand Brain 92%  │  │  Needs review     │  │  Add a business    │
  │  3 channels       │  │  1 channel        │  │  1 slot remaining  │
  │  [Open brand]     │  │  [Open brand]     │  │  [Get started]     │
  └───────────────────┘  └───────────────────┘  └────────────────────┘
```

### Onboarding wizard (3 steps, resumable)

```text
             1. Your business ── 2. Confirm your brand ── 3. Goals & activate

Step 1: Website URL / name / no website                     [Analyze]
Step 2: Evidence-backed facts   [Correct] [Edit] [Wrong]    [Upload brand kit]
        Website ↔ PDF conflicts                              [Resolve]
Step 3: Primary goal · Channels · Cadence · Approval policy  [Activate & create plan]
```

### 30-day Review Inbox

```text
Review Inbox · [Brand A ▼]                   [Next 30 days ▼]  [Pending 24]
┌──All 24──┬── Instagram 12 ──┬── LinkedIn 8 ──┬── TikTok 4 ──┐
│ Pending │ Approved │ Changes requested │ Rejected │ Scheduled │
│
│  Thu 29 Oct                                               [4 posts]
│  ┌──────────────────────────────────────────────────────────────┐
│  │ [real thumbnail]  Instagram Reel 10:00    Version 3         │
│  │ Better morning rituals ... [Preview] [Edit in Canvas]      │
│  │ [Approve] [Request changes] [Reject]                        │
│  └──────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────┐
│  │ [real carousel] LinkedIn 13:00      Awaiting approval       │
│  └──────────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────────────┘
```

### Conversational Canvas

```text
┌─ DESVIO / Canvas ───────────────[Brand A ▼]────────────────────┐
│ Context            │ Conversation                 │ Preview / Editor        │
│                    │                              │                         │
│ Brand A            │ You: Make a 15s product     │ [actual image/video]    │
│ Products           │      video in brand tone    │ [editable canvas]       │
│ Format: Video      │ AI: Using video + ad skill  │                         │
│ Social: Instagram  │ [Planning / Higgsfield job] │ [Variants: 1 / 2 / 3]   │
│ Tone: Friendly     │                              │ [Text layer] [Logo]     │
│ Reference files    │ You: Add sage background    │ [Timeline/captions]     │
│ [Upload]           │                              │                         │
│                    │ [Type a creative brief...]   │ [Save] [Send to review] │
└────────────────────┴──────────────────────────────┴─────────────────────────┘
```

## Styling constraints

Use source CSS variables as baseline: background `#f5ead8`, text `#201e1d`, orange `#c67139`, sage `#7a8a5e`, paper cards `#f9f4ed`. Avoid bright gradient dashboard chrome. Business cards and chat outputs use slightly elevated warm-white surfaces with quiet divider lines. Prioritize clear type, spacious columns, tactile pill tabs, soft accent highlights. Typography can use a licensed, production-safe equivalent to reference fonts; do not redistribute attached font binaries. Keep accessibility color contrast and keyboard operation.

## Business context behavior

Selecting a business updates URL context (`/b/{businessId}/canvas` etc.), request query keys, notifications and data. All-business view **only Overview**; elsewhere require explicit business. When max business count reached, Add button remains discoverable but opens truthful plan limit/upgrading dialog, not an unhandled error. Never show inactive sample “Corner Café” as user's business.

## Visual contract for engineering

Visual resemblance must be evaluated **after** the data path works. Snapshot UI in states: blank account, one brand active, two brands mixed data, third at limit, failed crawl, facts awaiting review, key missing, social OAuth pending, generated asset ready, failed publication, low-data analytics, mobile view. Any disabled feature must truthfully describe what setup or entitlement is needed. No decorative clickable controls without meaningful action.
