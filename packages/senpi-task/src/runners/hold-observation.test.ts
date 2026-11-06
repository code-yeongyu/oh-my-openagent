import { describe, expect, test } from "bun:test"
import { createInProcessRunPause } from "./in-process/native-run-pause"
import { createTaskParentControl, type TaskParentWire } from "./task-parent-control"

const watch = () => ({ outcome: new Promise<never>(() => undefined), cancel: () => undefined })

function inProcess(pauseView: { readonly pauseSeq: number; readonly records: readonly { readonly kind: string; readonly parentSessionId?: string }[] }) {
  const pause = createInProcessRunPause({
    pauseForRun: async () => ({ childSeq: 1 }),
    resumeForRun: async () => ({ released: true, otherHoldLive: false }),
    holdInput: () => ({ kind: "held", entryId: "e", duplicate: false }),
    pauseView,
  }, watch)
  if (pause === undefined) throw new Error("expected a native run pause")
  return pause
}

describe("delta M1: the parent can read a child's live run hold", () => {
  test("#given an in-process child holding this parent's run #when observed #then held with the child's sequence", async () => {
    const pause = inProcess({ pauseSeq: 5, records: [{ kind: "inherited_hold", parentSessionId: "parent" }] })
    expect(await pause.observeHold?.("parent")).toEqual({ held: true, childSeq: 5 })
    expect(await pause.observeHold?.("someone-else")).toEqual({ held: false, childSeq: 5 })
  })

  test("#given an RPC child #when observed #then its get_state pause records decide", async () => {
    const sent: string[] = []
    const wire: TaskParentWire = {
      width: 80,
      send: async command => {
        sent.push(command.type)
        if (command.type === "get_state") return { success: true, data: { pause: { pauseSeq: 4, records: [{ kind: "inherited_hold", key: "k", parentSessionId: "parent" }] } } }
        return { success: true }
      },
    }
    const control = createTaskParentControl(wire)
    expect(await control.observeHold("parent")).toEqual({ held: true, childSeq: 4 })
    expect(await control.observeHold("someone-else")).toEqual({ held: false, childSeq: 4 })
    expect(sent.filter(type => type === "get_state")).toHaveLength(2)
  })

  test("#given an RPC child whose engine reports no pause view #when observed #then the hold is unknown", async () => {
    const control = createTaskParentControl({ width: 80, send: async () => ({ success: true, data: { sessionId: "s" } }) })
    expect(await control.observeHold("parent")).toBeUndefined()
  })
})
