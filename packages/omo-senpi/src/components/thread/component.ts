import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { registerThreadTools, type ThreadToolSurfaceOptions } from "./tools"
import { createLiveThreadSurface, defaultThreadStateDirectory } from "./live-surface"

export type ThreadComponentOptions = Partial<Omit<ThreadToolSurfaceOptions, "callerSessionId" | "callerWorkspaceRoot">> & {
  readonly callerSessionId?: () => string
  readonly callerWorkspaceRoot?: () => string
}

/**
 * Component registration follows task's factory/register pattern. Production constructs a client
 * for the existing Senpi multi-session socket; an injected host remains available as a test seam.
 */
export function createThreadComponent(options: ThreadComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "thread",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const host = options.host ?? createLiveThreadSurface(pi)
      const stateDirectory = options.stateDirectory ?? defaultThreadStateDirectory(pi)
      if (host === undefined) {
        ctx.logger.warn("omo-senpi thread component skipped: live RPC surface unavailable")
        return
      }
      registerThreadTools(pi, {
        host,
        stateDirectory,
        diskSessions: options.diskSessions,
        ensureHost: options.ensureHost,
        callerSessionId: options.callerSessionId ?? (() => "unknown-caller"),
        callerWorkspaceRoot: options.callerWorkspaceRoot ?? (() => pi.cwd ?? process.cwd()),
      })
    },
  }
}
