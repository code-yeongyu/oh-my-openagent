// Barrel registrar for the memory slash-command suite.
//
// The memory component calls this once at registration time with the seams it
// owns (bound identities, settings, prompt-cache bust, reflection sink).

import type { SenpiExtensionAPI } from "../../../extension/types"
import { registerDoctorCommand } from "./doctor"
import { registerInitCommand } from "./init"
import { registerMemfsCommand } from "./memfs"
import { registerMemoryCommand } from "./memory"
import { registerMemoryRepositoryCommand } from "./memory-repository"
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
  "search",
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
  registerSearchCommand(pi, deps)
}

export type {
  ManualReflectionRequest,
  MemoryCommandContext,
  MemoryCommandDeps,
  MemoryCommandIdentity,
  MemoryCommandSettings,
  ReflectionRequestReceipt,
  ReflectionRequestSink,
} from "./types"
