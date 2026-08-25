// Barrel registrar for the memory slash-command suite.
//
// The memory component calls this once at registration time with the seams it
// owns (bound identities, settings, prompt-cache bust, reflection sink).

import type { SenpiExtensionAPI } from "../../../extension/types"
import { registerDoctorCommand } from "./doctor"
import { registerDreamCommand } from "./dream"
import { registerFactsCommand } from "./facts"
import { registerInitCommand } from "./init"
import { registerMemfsCommand } from "./memfs"
import { registerMemoryCommand } from "./memory"
import { registerMemoryRepositoryCommand } from "./memory-repository"
import { registerPeopleCommand } from "./people"
import { registerRecompileCommand } from "./recompile"
import { registerReflectCommand } from "./reflect"
import { registerRememberCommand } from "./remember"
import { registerSearchCommand } from "./search"
import { registerSleeptimeCommand } from "./sleeptime"
import type { MemoryCommandDeps } from "./types"

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
] as const

export type MemoryCommandName = (typeof MEMORY_COMMAND_NAMES)[number]

export function registerMemoryCommands(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  registerMemoryCommand(pi, deps)
  registerMemfsCommand(pi, deps)
  registerRememberCommand(pi, deps)
  registerInitCommand(pi, deps)
  registerDoctorCommand(pi, deps)
  registerRecompileCommand(pi, deps)
  registerMemoryRepositoryCommand(pi, deps)
  registerSleeptimeCommand(pi, deps)
  registerReflectCommand(pi, deps)
  registerDreamCommand(pi, deps)
  registerSearchCommand(pi, deps)
  // `people.enabled` is enforced inside the handler, not at registration: reading settings
  // here would consume a config resolution the enablement latch depends on counting.
  registerPeopleCommand(pi, deps)
  registerFactsCommand(pi, deps)
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
