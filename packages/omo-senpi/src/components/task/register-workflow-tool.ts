import type { SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import type { DagRuntime } from "./dag-runtime"
import { createDagTool } from "./dag-tool"

export function registerDagTool(pi: SenpiExtensionAPI, engine: TaskEngine, runtime: DagRuntime): void {
  const sessionId = (): string => engine.runtime.sessionId() ?? ""
  const rootSessionId = (): string => {
    const id = sessionId()
    return engine.resolveAncestry(id)?.rootSessionId ?? id
  }
  pi.registerTool({
    ...createDagTool({
      manager: runtime.manager,
      parentSessionId: sessionId,
      rootSessionId,
      wait: runtime.wait,
      cancel: runtime.cancel,
      cancelNode: runtime.cancelNode,
      retry: runtime.retry,
      send: runtime.send,
      amend: runtime.amend,
      guide: runtime.guide,
    }),
  })
}
