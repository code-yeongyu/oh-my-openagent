import { describe, expect, test } from "bun:test"

import { adaptRpcHandle } from "../../manager/child-handle"
import { nativeChildPausePort } from "../../pause/native-child-pause"
import type { RunPauseOwner } from "../../pause/ports"
import { event, fakeSessionPort, handleOverPort } from "./handle.test-support"
import { createHostTaskParentWire, type HostRunHoldClient } from "./task-parent-wire"

const owner: RunPauseOwner = { parentSessionId: "parent", parentPauseSeq: 2, runRef: { kind: "dag", id: "run" } }
const resume = { ...owner, resumeId: "resume-1", childSeqCutoff: 4 }

function hostChild(engine: (emit: (value: unknown) => void) => HostRunHoldClient) {
  const port = fakeSessionPort()
  const emit = (value: unknown) => port.emitEvent(event(value))
  const wire = createHostTaskParentWire({ setClientInfo: async () => undefined, ...engine(emit) })
  const raw = handleOverPort(Object.assign(port, { taskParentWire: () => wire }))
  const settleTurn = (text: string) => {
    const message = { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
    for (const value of [{ type: "message_end", message }, { type: "agent_end", willRetry: false, messages: [message] }, { type: "agent_idle" }]) emit(value)
  }
  return { handle: adaptRpcHandle(raw), raw, emit, settleTurn }
}

describe("host-session native run pause", () => {
  test("#given an engine client without the run hold methods #when pausing #then refuse as native_pause_unavailable", async () => {
    const h = hostChild(() => ({}))
    try {
      await expect(nativeChildPausePort.pauseForRun(h.handle, owner)).rejects.toMatchObject({ code: "native_pause_unavailable" })
    } finally { await h.raw.dispose() }
  })

  test("#given the engine refuses another parent #when relaying guidance #then surface wrong_parent", async () => {
    const h = hostChild(() => ({
      holdInput: async () => { throw new Error("wrong_parent: this child is not paused for that parent session's run") },
    }))
    try {
      await expect(nativeChildPausePort.holdInput(h.handle, { inputId: "g-1", revision: 1, text: "Use staging" }, { parentSessionId: "other" }))
        .rejects.toMatchObject({ code: "wrong_parent" })
    } finally { await h.raw.dispose() }
  })

  test("#given a stale Resume cutoff #when resuming #then the refusal names stale and no turn is claimed", async () => {
    const h = hostChild(() => ({ resumeForRun: async () => ({ released: false, reason: "stale" }) }))
    let selfResumed = 0
    h.handle.onSelfResumed?.(() => { selfResumed += 1 })
    try {
      h.emit({ type: "agent_start" })
      h.settleTurn("first")
      await h.handle.waitForOutcome()
      await expect(nativeChildPausePort.resumeTurn(h.handle, resume)).rejects.toMatchObject({ code: "native_resume_refused", reason: "stale" })
      h.emit({ type: "agent_start" })
      expect(selfResumed).toBe(1)
    } finally { await h.raw.dispose() }
  })

  test("#given a released hold #when the engine starts the Resume turn #then it is claimed, not self-resumed, and settles with its own result", async () => {
    const h = hostChild(emit => ({
      pauseForRun: async () => ({ held: true, childSeq: 4 }),
      resumeForRun: async () => {
        emit({ type: "agent_start" })
        return { released: true, otherHoldLive: false, turnId: "5" }
      },
    }))
    let selfResumed = 0
    h.handle.onSelfResumed?.(() => { selfResumed += 1 })
    try {
      h.emit({ type: "agent_start" })
      h.settleTurn("first")
      expect(await h.handle.waitForOutcome()).toMatchObject({ status: "completed", finalResponse: "first" })
      expect(await nativeChildPausePort.pauseForRun(h.handle, owner)).toEqual({ childSeq: 4 })
      const turn = await nativeChildPausePort.resumeTurn(h.handle, resume)
      if (!("turnId" in turn)) throw new Error("expected a resumed turn")
      expect(turn.turnId).toBe("5")
      h.settleTurn("resumed")
      expect(await turn.outcome).toMatchObject({ status: "completed", finalResponse: "resumed" })
      expect(selfResumed).toBe(0)
    } finally { await h.raw.dispose() }
  })
})
