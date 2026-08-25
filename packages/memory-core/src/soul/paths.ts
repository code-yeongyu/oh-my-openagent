// Soul-file identity shared by the write tools, the notice watermark, and the
// omo-senpi notice wiring. A "soul edit" is any committed change touching
// system/persona.md or system/identity.md (plan IC-5 / todo 7).

export const SOUL_PATHS = ["system/persona.md", "system/identity.md"] as const

/**
 * Stable machine-consumed token embedded in the tool-result soul-edit
 * directive. Tests key on this token, never on the full directive sentence
 * (`.omo/rules/test-discipline.md`: prose wording is review-gated, not pinned).
 */
export const MEMORY_SOUL_EDIT_RESULT_TOKEN = "soul edit"

/** Model-facing discipline line appended to the tool result on a soul edit. Unconditional by design. */
export const SOUL_EDIT_RESULT_LINE = "This was a soul edit: announce it to the user in your reply."

export function touchesSoulPath(paths: readonly string[]): boolean {
  return paths.some((path) => (SOUL_PATHS as readonly string[]).includes(path))
}
