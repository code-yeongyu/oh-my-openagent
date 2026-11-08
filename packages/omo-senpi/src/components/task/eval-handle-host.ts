import { createEvalHandleHost, type EvalHandleHostDeps } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

export type EvalHandleEngine = {
  readonly manager: EvalHandleHostDeps["tasks"] & { readonly workpools?: EvalHandleHostDeps["workpools"] }
  readonly stateDir: string
  readonly resolveAncestry: (sessionId: string) => { readonly rootSessionId: string; readonly depth: number } | undefined
  readonly runtime: { cwd(): string }
}

export function registerEvalHandleHost(pi: SenpiExtensionAPI, engine: EvalHandleEngine): void {
  if (pi.provideEvalHandleHost === undefined) return
  const workpools = engine.manager.workpools
  if (workpools === undefined) return
  pi.provideEvalHandleHost(createEvalHandleHost({
    tasks: engine.manager,
    workpools,
    stateDir: engine.stateDir,
    poolCaller: (sessionId) => {
      const ancestry = engine.resolveAncestry(sessionId)
      return { sessionId, rootSessionId: ancestry?.rootSessionId ?? sessionId, depth: ancestry?.depth ?? 0, cwd: engine.runtime.cwd() }
    },
  }))
}
