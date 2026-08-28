import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { registerThreadTools, type ThreadToolSurfaceOptions } from "./tools"

export type ThreadComponentOptions = Partial<Omit<ThreadToolSurfaceOptions, "callerSessionId" | "callerWorkspaceRoot">> & {
  readonly callerSessionId?: () => string
  readonly callerWorkspaceRoot?: () => string
}

/**
 * Component registration follows task's factory/register pattern. The host adapter is injected by
 * the live multi-session launcher; keeping it as a port prevents this component from creating a
 * competing socket or host lifecycle.
 */
export function createThreadComponent(options: ThreadComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "thread",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      if (options.host === undefined || options.stateDirectory === undefined) return
      registerThreadTools(pi, {
        host: options.host,
        stateDirectory: options.stateDirectory,
        diskSessions: options.diskSessions,
        ensureHost: options.ensureHost,
        callerSessionId: options.callerSessionId ?? (() => "unknown-caller"),
        callerWorkspaceRoot: options.callerWorkspaceRoot ?? (() => pi.cwd ?? process.cwd()),
      })
    },
  }
}
