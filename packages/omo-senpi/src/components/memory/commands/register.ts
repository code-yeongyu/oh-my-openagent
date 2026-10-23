// Barrel registrar for the memory slash-command suite.
//
// The memory component calls this once at registration time with the seams it
// owns (bound identities, settings, prompt-cache bust, reflection sink).

import type { SenpiExtensionAPI } from "../../../extension/types"
import { registerDoctorCommand } from "./doctor"
import { registerMemfsCommand } from "./memfs"
import { LAZY_MEMORY_COMMANDS, type LazyMemoryCommandName } from "./metadata"
import { registerPeopleCommand } from "./people"
import {
  loadMemoryCommandsRuntime,
  memoryCommandsRuntimeLoadFailure,
  type MemoryCommandsRuntimeLoader,
} from "./runtime-loader"
import { respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

export const MEMORY_COMMAND_NAMES = [
  "memory",
  "memfs",
  "remember",
  "init",
  "doctor",
  "recompile",
  "memory-repository",
  "sleeptime",
  "reflect",
  "dream",
  "search",
  "people",
  "facts",
  "agreements",
] as const

export type MemoryCommandName = (typeof MEMORY_COMMAND_NAMES)[number]

export function registerMemoryCommands(
  pi: SenpiExtensionAPI,
  deps: MemoryCommandDeps,
  loadRuntime: MemoryCommandsRuntimeLoader = loadMemoryCommandsRuntime,
): void {
  const lazy = (name: LazyMemoryCommandName): void => registerLazyMemoryCommand(pi, deps, name, loadRuntime)
  lazy("memory")
  registerMemfsCommand(pi, deps)
  lazy("remember")
  lazy("init")
  registerDoctorCommand(pi, deps)
  lazy("recompile")
  lazy("memory-repository")
  lazy("sleeptime")
  lazy("reflect")
  lazy("dream")
  lazy("search")
  // `people.enabled` is enforced inside the handler, not at registration: reading settings
  // here would consume a config resolution the enablement latch depends on counting.
  registerPeopleCommand(pi, deps)
  lazy("facts")
  lazy("agreements")
}

function registerLazyMemoryCommand(
  pi: SenpiExtensionAPI,
  deps: MemoryCommandDeps,
  name: LazyMemoryCommandName,
  loadRuntime: MemoryCommandsRuntimeLoader,
): void {
  pi.registerCommand(name, {
    ...LAZY_MEMORY_COMMANDS[name],
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const runtime = await loadRuntime().catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
      if (runtime instanceof Error) return respond(ctx, memoryCommandsRuntimeLoadFailure(name, runtime), "error")
      return runtime.runMemoryCommand(name, pi, deps, args, ctx)
    },
  })
}

export type {
  DreamRequestSink,
  FactsRetrySink,
  ManualDreamCommandRequest,
  ManualReflectionRequest,
  MemoryCommandContext,
  MemoryCommandDeps,
  MemoryCommandIdentity,
  MemoryCommandSettings,
  ReflectionRequestReceipt,
  ReflectionRequestSink,
} from "./types"
