/**
 * handoff tool — description string and shared constants.
 *
 * The tool description is referenced by the tool factory and included in the
 * LLM-facing tool schema, so keep it factual, concise, and triggerable.
 */

/** Tool description — covers all four supported actions. */
export const HANDOFF_DESCRIPTION =
  "Multi-action handoff tool backed by .matrixx/handoff.md. Actions: 'create' (write a structured handoff with YAML frontmatter and a markdown body), 'read' (load the current handoff content for context pickup), 'archive' (rename the active handoff to handoff.consumed.md to mark it as consumed), 'list' (show all handoff files in .matrixx/). Use this tool when the current session needs to preserve state for a future session, or when a fresh session is resuming work from a prior handoff."

/** Maximum bytes tolerated from a single git stdout read before we abort. */
export const MAX_GIT_OUTPUT_BYTES = 4096

/** Hard timeout for any single `git` invocation, in milliseconds. */
export const GIT_COMMAND_TIMEOUT_MS = 5000

/** Sentinel used when we cannot resolve git metadata for the working dir. */
export const UNKNOWN_GIT_SHA = "unknown"

/** Canonical list of supported actions (kept in sync with the zod enum). */
export const HANDOFF_ACTIONS = ["create", "read", "list", "archive"] as const
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number]
