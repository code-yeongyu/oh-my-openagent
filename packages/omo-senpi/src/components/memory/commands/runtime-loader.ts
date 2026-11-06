// The memory slash commands in metadata.ts register in the entry bundle, but their handlers ship as the
// `#omo-memory-commands-runtime` sidecar, imported on the first invocation of any of them.

import type * as CommandsRuntime from "./runtime"

import { reinstallStep } from "../../reinstall/reinstall-step"

export type MemoryCommandsRuntimeModule = Pick<typeof CommandsRuntime, "runMemoryCommand">
export type MemoryCommandsRuntimeLoader = () => Promise<MemoryCommandsRuntimeModule>
/** The dream selection a fired dream loads from the same sidecar (`dream-trigger-fire.ts`). */
export type DreamSelectionRuntimeModule = Pick<
  typeof CommandsRuntime,
  "computeUnreflectedVolumeFast" | "loadConversations" | "selectLoadedConversations"
>

export const MEMORY_COMMANDS_RUNTIME_ARTIFACT = "extensions/omo-memory-commands.js"

/** One shared import per process; a failed import is not cached, so the next invocation retries. */
export function createMemoryCommandsRuntimeLoader<Module>(importRuntime: () => Promise<Module>): () => Promise<Module> {
  let pending: Promise<Module> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadMemoryCommandsRuntime: () => Promise<MemoryCommandsRuntimeModule & DreamSelectionRuntimeModule> =
  createMemoryCommandsRuntimeLoader(() => import("#omo-memory-commands-runtime"))

export function memoryCommandsRuntimeLoadFailure(command: string, error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `/${command} is unavailable: the memory commands runtime (${MEMORY_COMMANDS_RUNTIME_ARTIFACT}) failed to load: ${cause}. Part of this omo installation is missing; ${reinstallStep()}, then start a new session.`
}
