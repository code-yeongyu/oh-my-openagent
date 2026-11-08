import { describe, expect, test } from "bun:test"
import { createTaskParentControl, type TaskParentCommand, type TaskParentWire } from "./task-parent-control"

const owner = { parentSessionId: "parent", parentPauseSeq: 2, runRef: { kind: "dag" as const, id: "run" } }

describe("native task-parent RPC contract", () => {
  test("#given parent-relayed human guidance #when dispatching #then declare only task_parent and name the inherited hold owner", async () => {
    const calls: unknown[] = []
    const control = createTaskParentControl({
      width: 80,
      send: async command => {
        calls.push(command)
        return command.type === "set_client_info"
          ? { success: true }
          : { success: true, data: { entryId: "held-1", duplicate: false } }
      },
    })
    expect(await control.holdInput("parent", { inputId: "guide-1", revision: 2, text: "Use staging" }))
      .toEqual({ kind: "held", entryId: "held-1", duplicate: false })
    expect(calls).toEqual([
      { type: "set_client_info", width: 80, capabilities: ["task_parent"] },
      {
        type: "hold_input", inputId: "guide-1", revision: 2, text: "Use staging",
        parentSessionId: "parent", origin: "human",
      },
    ])
  })

  test("#given another parent owns custody #when dispatching guidance #then preserve wrong_parent without interactive escalation", async () => {
    const calls: unknown[] = []
    const control = createTaskParentControl({
      width: 80,
      send: async command => {
        calls.push(command)
        return command.type === "set_client_info" ? { success: true }
          : { success: false, error: "wrong_parent: this child is not paused for that parent session's run" }
      },
    })
    await expect(control.holdInput("other-parent", { inputId: "guide-1", revision: 1, text: "Use staging" }))
      .rejects.toMatchObject({ code: "wrong_parent" })
    expect(calls).toHaveLength(2)
  })

  test("#given engine-held guidance was already delivered #when retrying dispatch #then acknowledge without sending another input", async () => {
    const control = createTaskParentControl({
      width: 80,
      send: async command => command.type === "set_client_info" ? { success: true }
        : { success: true, data: { alreadyDelivered: true } },
    })
    expect(await control.holdInput("parent", { inputId: "guide-1", revision: 2, text: "Use staging" }))
      .toEqual({ kind: "already_delivered", revision: 2 })
  })

  test("#given two controls sharing a connection #when pausing and resuming #then declare task_parent once and use native field names", async () => {
    const calls: TaskParentCommand[] = []
    const wire: TaskParentWire = {
      width: 80,
      send: async command => {
        calls.push(command)
        if (command.type === "pause_for_run") return { success: true, data: { held: true, childSeq: 8 } }
        if (command.type === "resume_for_run") return { success: true, data: { released: true, otherHoldLive: false, turnId: "19" } }
        return { success: true }
      },
    }
    const first = createTaskParentControl(wire)
    const second = createTaskParentControl(wire)
    expect(await first.pauseForRun(owner)).toEqual({ childSeq: 8 })
    expect(await second.resumeForRun({ ...owner, resumeId: "resume-2", childSeqCutoff: 8 }))
      .toEqual({ released: true, otherHoldLive: false, turnId: "19" })
    expect(calls).toEqual([
      { type: "set_client_info", width: 80, capabilities: ["task_parent"] },
      { type: "pause_for_run", ...owner },
      { type: "resume_for_run", parentSessionId: "parent", parentPauseSeq: 2, resumeId: "resume-2", childSeqCutoff: 8 },
    ])
  })

  test("#given a wrong-parent refusal #when pausing #then return the native refusal without retrying or claiming a hold", async () => {
    const wire: TaskParentWire = {
      width: 80,
      send: async command => command.type === "set_client_info" ? { success: true }
        : { success: false, error: "wrong_parent: this child belongs to another parent" },
    }
    expect(await createTaskParentControl(wire).pauseForRun(owner)).toEqual({ refused: "wrong_parent" })
  })

  test("#given a newer child-owned hold #when resuming #then preserve otherHoldLive without inventing a child counter", async () => {
    const wire: TaskParentWire = {
      width: 80,
      send: async command => command.type === "set_client_info" ? { success: true }
        : { success: true, data: { released: true, otherHoldLive: true } },
    }
    expect(await createTaskParentControl(wire).resumeForRun({ ...owner, resumeId: "r", childSeqCutoff: 7 }))
      .toEqual({ released: true, otherHoldLive: true })
  })

  test("#given a stale Resume cutoff #when the engine refuses #then no new turn is reported", async () => {
    const wire: TaskParentWire = {
      width: 80,
      send: async command => command.type === "set_client_info" ? { success: true }
        : { success: true, data: { released: false, reason: "stale" } },
    }
    expect(await createTaskParentControl(wire).resumeForRun({ ...owner, resumeId: "old", childSeqCutoff: 1 }))
      .toEqual({ released: false, reason: "stale" })
  })
})
