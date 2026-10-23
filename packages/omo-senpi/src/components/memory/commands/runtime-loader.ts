// The memory slash commands in metadata.ts register in the entry bundle, but their handlers ship as the
// `#omo-memory-commands-runtime` sidecar, imported on the first invocation of any of them.

import type * as CommandsRuntime from "./runtime"

export type MemoryCommandsRuntimeModule = Pick<typeof CommandsRuntime, "runMemoryCommand">
export type MemoryCommandsRuntimeLoader = () => Promise<MemoryCommandsRuntimeModule>

export const MEMORY_COMMANDS_RUNTIME_ARTIFACT = "extensions/omo-memory-commands.js"

/** One shared import per process; a failed import is not cached, so the next invocation retries. */
export function createMemoryCommandsRuntimeLoader(
  importRuntime: () => Promise<MemoryCommandsRuntimeModule>,
): MemoryCommandsRuntimeLoader {
  let pending: Promise<MemoryCommandsRuntimeModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadMemoryCommandsRuntime: MemoryCommandsRuntimeLoader = createMemoryCommandsRuntimeLoader(
  () => import("#omo-memory-commands-runtime"),
)

export function memoryCommandsRuntimeLoadFailure(command: string, error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `/${command} is unavailable: the memory commands runtime (${MEMORY_COMMANDS_RUNTIME_ARTIFACT}) failed to load: ${cause}. This build's plugin payload is incomplete; reinstall omo, then start a new session.`
}
