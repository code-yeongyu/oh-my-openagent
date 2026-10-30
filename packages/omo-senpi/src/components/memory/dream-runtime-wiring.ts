import { createDreamTriggerWiring, resolveDreamTriggerSettings } from "./dream-trigger"
import { resolveMemorySettings } from "./identity-runtime"
import { sessionIdFrom } from "./wiring-context"
import type { MemoryRuntimeWiring } from "./wiring-runtime"
import type { MemoryWiringOptions } from "./wiring-types"

export function buildDreamTriggerWiring(
  options: MemoryWiringOptions,
  runtimeWiring: MemoryRuntimeWiring,
  activeSession: { current?: string },
  hasUserActivity: (sessionId: string) => boolean,
) {
  return createDreamTriggerWiring({
    resolveSession: (eventCtx) => {
      const sessionId = sessionIdFrom(eventCtx)
      return sessionId !== undefined && hasUserActivity(sessionId) ? runtimeWiring.dreamSessionFor(eventCtx) : undefined
    },
    // A manual /dream is an explicit user action and needs no prior prompt.
    resolveActiveSession: () => activeSession.current === undefined
      ? undefined
      : runtimeWiring.dreamSessionById(activeSession.current),
    resolveSessionById: (sessionId) => hasUserActivity(sessionId) ? runtimeWiring.dreamSessionById(sessionId) : undefined,
    resolveSettings: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      return resolveDreamTriggerSettings(settings, identity)
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
}
