export const HOOK_NAME = "design-intent-preserver"

export const PLANS_DIR = ".matrixx/plans"

// Matches "phase 1", "Phase 2:", "phase-3", "PHASE 4 — anything"
export const PHASE_TRANSITION_PATTERN = /\bphase[\s\-:]*(\d+)\b/i

// Matches construct category, web-designer agent, frontend-ui-ux skill, @designer
export const CONSTRUCT_INDICATORS = /\b(?:construct|web[\s-]?designer|frontend[\s-]?ui[\s-]?ux)\b|@designer/i

export const IDEMPOTENCY_MARKER = "<design-intent-preservation>"

export const INTENT_PRESERVATION_BLOCK = `<design-intent-preservation>
The previous phase included @construct / @web-designer / @frontend-ui-ux work. Visual decisions are FROZEN:
- Layout, rhythm, hierarchy, motion, spacing, color
- Affordances, responsiveness, component feel
Route ANY visual / responsive / motion / polish changes back to @construct or @web-designer.
Use @source only for bounded mechanical follow-up that preserves design exactly
(wiring, tests, type fixes, non-visual behavior).
If design intent must change, record why in .matrixx/drafts/design-changes.md first.
</design-intent-preservation>`
