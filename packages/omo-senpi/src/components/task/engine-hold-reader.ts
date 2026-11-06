import type { EnginePauseState, RunRef } from "../../../../senpi-task/src/pause/ports"

export type RpcPauseState = {
  readonly pauseSeq: number
  readonly records: readonly {
    readonly kind: string
    readonly key: string
    readonly runRef?: { readonly kind: string; readonly id: string }
    readonly parentSessionId?: string
  }[]
}

export function readEngineRunHold(state: EnginePauseState | RpcPauseState): {
  readonly pauseSeq: number; readonly stopped: boolean; readonly runRefs: readonly RunRef[]
} {
  const entries = "holds" in state ? state.holds : state.records
  const refs: RunRef[] = []
  for (const entry of entries) {
    if (entry.kind !== "run_fence") continue
    const candidate = "runRef" in entry ? entry.runRef
      : "data" in entry && isRecord(entry.data) ? entry.data["runRef"] : undefined
    if (isRunRef(candidate) && !refs.some(ref => ref.kind === candidate.kind && ref.id === candidate.id)) refs.push(candidate)
  }
  return { pauseSeq: state.pauseSeq, stopped: entries.some(entry => entry.kind === "session_hold"), runRefs: refs }
}

function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && typeof value["id"] === "string"
    && (value["kind"] === "dag" || value["kind"] === "task" || value["kind"] === "workpool" || value["kind"] === "team")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
