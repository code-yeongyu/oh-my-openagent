import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "./admission-barrier"
import { PauseRegistry, type PauseParticipant } from "./registry"
import { RunPauseController, type RunPauseEffects } from "./run-controller"

afterEach(cleanupProjects)

const participant: PauseParticipant = {
  key: "a", kind: "task", taskId: "a", runEpoch: 0,
  runRef: { kind: "task", id: "a" }, state: "pending", at: new Date(0).toISOString(),
  admission: { model: "test/model", laneKey: "test/model", sequence: 1, phase: "parked" },
}

function harness(overrides: Partial<RunPauseEffects> = {}) {
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(tempProject(), barrier)
  const events: string[] = []
  const effects: RunPauseEffects = {
    snapshot: () => [participant],
    quiesce: () => { events.push("quiesce") },
    addFences: async () => { events.push("fences") },
    pause: async () => { events.push("pause"); return { kind: "held", childSeq: 8 } },
    dispatchGuidance: async () => { events.push("guidance") },
    resume: async () => { events.push("resume"); return { kind: "resumed", turnId: "turn-2" } },
    install: async () => { events.push("install") },
    acknowledgeInstalled: async () => { events.push("ack") },
    cancel: async () => { events.push("cancel") },
    ...overrides,
  }
  return { barrier, registry, effects, events, controller: new RunPauseController(registry, effects) }
}

describe("whole-run pause custody", () => {
  test("#given running participants #when Stop begins #then the barrier and ledger precede every async effect", async () => {
    let observed = false
    const h = harness({
      quiesce: () => {
        observed = true
        expect(h.barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 1 })
        expect(h.registry.require("root").participants.a?.state).toBe("pending")
      },
    })
    const stopping = h.controller.pause("root", 1)
    expect(observed).toBe(true)
    await stopping
    expect(h.registry.require("root")).toMatchObject({
      phase: "applied", participants: { a: { state: "held", observedChildSeq: 8, ackSeq: 1 } },
    })
  })

  test("#given a paused run #when Resume installs #then guidance precedes turns and only the release event opens admission", async () => {
    const h = harness()
    await h.controller.pause("root", 1)
    h.events.length = 0
    expect(await h.controller.resume("root", 1, "resume-1")).toEqual({ kind: "installed" })
    expect(h.events).toEqual(["guidance", "resume", "install", "ack"])
    expect(h.barrier.enter("root", { key: "b", runRef: { kind: "task", id: "b" } }).kind).toBe("held")
    expect(h.controller.released("root", 1, "resume-1")).toBe(true)
    expect(h.barrier.state("root")).toEqual({ kind: "open" })
  })

  test("#given Resume 1 waits on guidance #when Stop 2 supersedes it #then no stale turn or install commits", async () => {
    const entered = Promise.withResolvers<void>()
    const deliver = Promise.withResolvers<void>()
    const h = harness({ dispatchGuidance: async () => { entered.resolve(); await deliver.promise } })
    await h.controller.pause("root", 1)
    const first = h.controller.resume("root", 1, "resume-1")
    await entered.promise
    await h.controller.pause("root", 2)
    deliver.resolve()
    expect(await first).toEqual({ kind: "superseded" })
    expect(h.events).not.toContain("resume")
    expect(h.events).not.toContain("install")
    expect(h.controller.released("root", 1, "resume-1")).toBe(false)
    expect(h.barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 2 })
  })

  test("#given a newer child-owned hold #when parent resumes #then retain it and its observed cutoff", async () => {
    const h = harness({ resume: async (_participant, request) => {
      expect(request.childSeqCutoff).toBe(8)
      return { kind: "held_by_user", childSeq: 9 }
    } })
    await h.controller.pause("root", 1)
    await h.controller.resume("root", 1, "resume-1")
    expect(h.registry.require("root").participants.a).toMatchObject({ state: "held_by_user", observedChildSeq: 9 })
    expect(h.registry.require("root").resume?.childSeqCutoffs.a).toBe(8)
  })

  test("#given a paused run #when cancelled #then ledger participants are cancelled before removal", async () => {
    const h = harness({ cancel: async entry => {
      expect(h.registry.require("root").participants[entry.key]).toBeDefined()
    } })
    await h.controller.pause("root", 1)
    await h.controller.cancel("root", participant.runRef)
    expect(h.registry.require("root").participants).toEqual({})
  })
})
