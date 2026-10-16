// /palace and /people register in the entry bundle, but their implementation (the palace HTML
// generator, collectors and the /people runtime) ships as the `#omo-memory-palace-runtime` sidecar,
// imported on the first invocation of either command.

import type * as PalaceRuntime from "./runtime"

export type PalaceRuntimeModule = Pick<typeof PalaceRuntime, "runPalaceCommand" | "runPeopleCommand">
export type PalaceRuntimeLoader = () => Promise<PalaceRuntimeModule>

export const PALACE_RUNTIME_ARTIFACT = "extensions/omo-memory-palace.js"

/** One shared import per process; a failed import is not cached, so the next invocation retries. */
export function createPalaceRuntimeLoader(importRuntime: () => Promise<PalaceRuntimeModule>): PalaceRuntimeLoader {
  let pending: Promise<PalaceRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadPalaceRuntime: PalaceRuntimeLoader = createPalaceRuntimeLoader(() => import("#omo-memory-palace-runtime"))

export function palaceRuntimeLoadFailure(command: "palace" | "people", error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `/${command} is unavailable: the memory palace runtime (${PALACE_RUNTIME_ARTIFACT}) failed to load: ${cause}. This build's plugin payload is incomplete; reinstall omo, then start a new session.`
}
