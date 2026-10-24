import { describe, expect, test } from "bun:test"
import type { EnginePauseState, RunRef } from "../../../../senpi-task/src/pause/ports"
import { TaskRuntimeContext } from "./runtime-context"

describe("native engine hold reader", () => {
  test("#given the live extension context #when run fences change #then state stays live and refs use kind and id", () => {
    const runtime = new TaskRuntimeContext("/project")
    let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7", data: { localSeq: 7 } }] }
    const fenced: RunRef[] = []
    runtime.captureFrom({
      getPauseState: () => state,
      fenceRun: ref => {
        fenced.push(ref)
        state = { pauseSeq: 8, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}`, data: { runRef: ref } }] }
      },
    })
    expect(runtime.getPauseState()?.pauseSeq).toBe(7)
    runtime.fenceRun({ kind: "dag", id: "run" })
    expect(fenced).toEqual([{ kind: "dag", id: "run" }])
    expect(runtime.getPauseState()).toEqual(state)
    expect(runtime.getPauseState()?.pauseSeq).toBe(8)
  })

  test("#given a session switch #when the context is captured #then the previous session's hold reader is discarded", () => {
    const runtime = new TaskRuntimeContext("/project")
    runtime.captureFrom({ getPauseState: () => ({ pauseSeq: 1, holds: [{ kind: "session_hold", key: "session_hold:1" }] }) })
    runtime.captureFrom({ getPauseState: () => ({ pauseSeq: 0, holds: [] }) })
    expect(runtime.getPauseState()).toEqual({ pauseSeq: 0, holds: [] })
  })
})
