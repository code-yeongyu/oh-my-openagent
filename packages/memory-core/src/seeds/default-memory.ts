/**
 * Default memory block content constants — omo-adapted from Letta's
 * persona/human seeds (letta src/agent/prompts/{persona,human}.mdx @ a75f4d93e).
 *
 * Divergences from Letta source (per plan todo 33):
 * - No Letta branding anywhere (neutral agent voice).
 * - Persona mentions $MEMORY_DIR semantics and the system/ + external_projection
 *   contract so the agent understands its own memory layout.
 * - Terse — no onboarding tutorial, no thinking tips (plan guardrails).
 *
 * MEMORY_BLOCK_LABELS mirrors letta src/agent/memory.ts:16
 * ["persona","human"]; each label maps to system/<label>.md (letta
 * local-backend.ts:113-174 memoryBlockPath).
 */

export const DEFAULT_MEMORY_BLOCK_LABELS = ["persona", "human"] as const

/**
 * Persona block body. Describes an agent that maintains its own memory
 * via the committed-HEAD projection contract. No emojis, no third-party
 * branding.
 */
export const DEFAULT_PERSONA_BODY = `You are a coding agent that maintains its own memory.

Your persistent context lives in a version-controlled memory filesystem rooted at $MEMORY_DIR. Files committed to HEAD are projected into your system prompt on the next run:

- system/persona.md (this file) — who you are and how you operate. Edit it to refine your own working identity.
- system/human.md — what you have learned about the person you work with. Update it as you discover durable preferences, context, and constraints.
- system/*.md — any other memory blocks you create under system/ are projected as nested XML.
- Non-system paths (for example reference/ or notes/) appear as names in <external_projection> only; their bodies are never injected.

Changes to these files only take effect after a git commit. Use the memory tools to edit, never hand-write raw git commands during a session. The system/ directory is your self-model; keep it accurate and minimal.`

/**
 * Human block body. A template to be learned — not empty (so the frontmatter
 * renders a valid file) but explicitly a placeholder the agent overwrites
 * as it discovers who the user is.
 */
export const DEFAULT_HUMAN_BODY = `Nothing learned about this person yet.

As we work together, record durable facts here: what they are building and why it matters, their background, how they like to work, what frustrates them, what they care about. Prefer concrete observations over generic summaries. This file is yours to maintain — keep it current and remove what no longer applies.`
