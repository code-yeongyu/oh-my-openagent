// Sidecar entry for the memory slash-command handlers, bundled as extensions/omo-memory-commands.js and
// imported through `#omo-memory-commands-runtime` on the first invocation of any of them (see
// runtime-loader.ts). Each command module still owns its registration; this module runs that
// registration against a capturing port and hands back the handler it registered.

import { registerAgreementsCommand } from "./agreements"
import { registerDreamCommand } from "./dream"
import { registerFactsCommand } from "./facts"
import { registerInitCommand } from "./init"
import type { LazyMemoryCommandName, MemoryCommandPort } from "./metadata"
import { registerMemoryCommand } from "./memory"
import { registerMemoryRepositoryCommand } from "./memory-repository"
import { registerRecompileCommand } from "./recompile"
import { registerReflectCommand } from "./reflect"
import { registerRememberCommand } from "./remember"
import { registerSearchCommand } from "./search"
import { registerSleeptimeCommand } from "./sleeptime"
import type { MemoryCommandContext, MemoryCommandDeps, MemoryCommandHandler } from "./types"

type CommandRegistrar = (pi: MemoryCommandPort, deps: MemoryCommandDeps) => void

const REGISTRARS: Readonly<Record<LazyMemoryCommandName, CommandRegistrar>> = {
  memory: registerMemoryCommand,
  remember: registerRememberCommand,
  init: registerInitCommand,
  recompile: registerRecompileCommand,
  "memory-repository": registerMemoryRepositoryCommand,
  sleeptime: registerSleeptimeCommand,
  reflect: registerReflectCommand,
  dream: registerDreamCommand,
  search: registerSearchCommand,
  facts: registerFactsCommand,
  agreements: registerAgreementsCommand,
}

type HandlerCache = WeakMap<MemoryCommandDeps, Map<LazyMemoryCommandName, MemoryCommandHandler>>
const handlersByPort = new WeakMap<MemoryCommandPort, HandlerCache>()

export function memoryCommandHandler(
  name: LazyMemoryCommandName,
  pi: MemoryCommandPort,
  deps: MemoryCommandDeps,
): MemoryCommandHandler {
  let byDeps = handlersByPort.get(pi)
  if (byDeps === undefined) {
    byDeps = new WeakMap()
    handlersByPort.set(pi, byDeps)
  }
  let handlers = byDeps.get(deps)
  if (handlers === undefined) {
    handlers = new Map()
    byDeps.set(deps, handlers)
  }
  const known = handlers.get(name)
  if (known !== undefined) return known
  const captured = captureHandler(name, pi, deps)
  handlers.set(name, captured)
  return captured
}

export function runMemoryCommand(
  name: LazyMemoryCommandName,
  pi: MemoryCommandPort,
  deps: MemoryCommandDeps,
  args: string,
  ctx: MemoryCommandContext,
): Promise<string> {
  return memoryCommandHandler(name, pi, deps)(args, ctx)
}

function captureHandler(name: LazyMemoryCommandName, pi: MemoryCommandPort, deps: MemoryCommandDeps): MemoryCommandHandler {
  let handler: MemoryCommandHandler | undefined
  REGISTRARS[name]({
    registerCommand: (commandName, options) => {
      if (commandName === name && typeof options.handler === "function") handler = options.handler as MemoryCommandHandler
    },
    sendUserMessage: (content, options) => pi.sendUserMessage(content, options),
  }, deps)
  if (handler === undefined) throw new Error(`memory command runtime registered no handler for /${name}`)
  return handler
}
