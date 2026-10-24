# Desvio studio direction

Reference: owner-supplied cream/orange dashboard, 24 October 2026. Applied to the existing business-first product; architecture and permissions are unchanged.

Guidance inspected from `https://github.com/jakubkrehel/skills`, commit `4c66b1fa86e9ab70187b43d7da9b6fdb29f2ef63`: `better-ui` and `better-layout`. No upstream executable helpers were run. These are development design instructions, not new customer-facing runtime skills.

- Cream paper, warm off-white cards, near-black typography, restrained burnt orange.
- Sans-serif headings, generous spacing, softly raised surfaces and clear selected navigation.
- Overview links the actual brand, Canvas and review routes. Counts remain API-derived. No sample engagement, connection, autopilot or subscription claims.
- One-time staged entrances communicate hierarchy; hover transitions retarget immediately; buttons compress on press. Motion is gated by the reduced-motion preference. No continuous decorative animation.
- Shared styles apply to the existing screens. The new workflow section is on the business Overview. Mobile, keyboard, contrast and reduced-motion checks are required before deployment.

New runtime skills still require audit, immutable pins, workflow registration and a rebuilt skill runtime. Descriptions help discovery inside the registered set; they do not enable arbitrary tools or integrations.
