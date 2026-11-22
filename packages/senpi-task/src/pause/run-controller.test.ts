import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "./admission-barrier"
import { PauseRegistry, type PauseParticipant } from "./registry"
import { RunPauseController, type RunPauseEffects } from "./run-controller"

afterEach(cleanupProjects)

const participant: PauseParticipant = {
  key: "a",
  kind: "task",
  taskId: "a",
  runEpoch: 0,
  runRef: { kind: "task", id: "a" },
  state: "pending",
  at: new Date(0).toISOString(),
  admission: { model: "test/model", laneKey: "test/model", sequence: 1, phase: "parked" },
}

function harness(overrides: Partial<RunPauseEffects> = {}) {
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(tempProject(), barrier)
  const events: string[] = []
  const effects: RunPauseEffects = {
    snapshot: () => [participant],
    quiesce: () => {
      events.push("quiesce")
    },
    addFences: async () => {
      events.push("fences")
    },
    pause: async () => {
      events.push("pause")
      return { kind: "held", childSeq: 8 }
    },
    dispatchGuidance: async () => {
      events.push("guidance")
    },
    resume: async () => {
      events.push("resume")
      return { kind: "resumed", turnId: "turn-2" }
    },
    install: async () => {
      events.push("install")
    },
    acknowledgeInstalled: async () => {
      events.push("ack")
    },
    cancel: async () => {
      events.push("cancel")
    },
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
      phase: "applied",
      participants: { a: { state: "held", observedChildSeq: 8, ackSeq: 1 } },
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
    const h = harness({
      dispatchGuidance: async () => {
        entered.resolve()
        await deliver.promise
      },
    })
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
    const h = harness({
      resume: async (_participant, request) => {
        expect(request.childSeqCutoff).toBe(8)
        return { kind: "held_by_user", childSeq: 9 }
      },
    })
    await h.controller.pause("root", 1)
    await h.controller.resume("root", 1, "resume-1")
    expect(h.registry.require("root").participants.a).toMatchObject({ state: "held_by_user", observedChildSeq: 9 })
    expect(h.registry.require("root").resume?.childSeqCutoffs.a).toBe(8)
  })

  test("#given a child restore awaiting failure #when a newer Stop arrives #then the failed old Resume cannot release it", async () => {
    const restoring = Promise.withResolvers<void>()
    const failed = Promise.withResolvers<void>()
    const h = harness({
      resume: async () => {
        restoring.resolve()
        await failed.promise
        throw new Error("restore failed")
      },
    })
    await h.controller.pause("root", 1)
    const oldResume = h.controller.resume("root", 1, "resume-1")
    await restoring.promise
    await h.controller.pause("root", 2)
    failed.resolve()
    expect(await oldResume).toEqual({ kind: "superseded" })
    expect(h.registry.require("root").pauseSeq).toBe(2)
    expect(h.registry.require("root").participants.a?.state).toBe("held")
    expect(h.controller.released("root", 1, "resume-1")).toBe(false)
    expect(h.barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 2 })
    expect(h.events).not.toContain("install")
  })

  test("#given a paused run #when cancelled #then ledger participants are cancelled before removal", async () => {
    const h = harness({
      cancel: async (entry) => {
        expect(h.registry.require("root").participants[entry.key]).toBeDefined()
      },
    })
    await h.controller.pause("root", 1)
    await h.controller.cancel("root", participant.runRef)
    expect(h.registry.require("root").participants).toEqual({})
  })

  test("#given a lost queued admission after a restart #when retryLost runs without a credential #then it settles and drops instead of failing every session start (#10864)", async () => {
    const queued: PauseParticipant = {
      key: "held",
      kind: "held_admission",
      runEpoch: 0,
      runRef: { kind: "task", id: "held" },
      state: "pending",
      at: new Date(0).toISOString(),
    }
    const h = harness({
      snapshot: () => [participant, queued],
      resume: async (entry, _request, credential) => {
        if (entry.kind === "held_admission" && credential === undefined)
          throw new Error("a queued admission resumes only inside a resume transaction")
        return { kind: "resumed", turnId: "turn-2" }
      },
    })
    await h.controller.pause("root", 1)
    await h.controller.resume("root", 1, "resume-1")
    expect(h.controller.released("root", 1, "resume-1")).toBe(true)
    h.registry.update("root", 1, "held", { state: "lost", lostReason: "propagation failed" })

    // A restart rebuilt the controller: the released transaction's credential is gone.
    const restarted = new RunPauseController(h.registry, h.effects)
    expect(await restarted.retryLost("root", 1)).toEqual([])
    expect(h.registry.require("root").participants.held).toBeUndefined()
  })

  test("#given a lost participant its engine no longer holds #when the resume observes it #then the participant leaves the run instead of being re-observed forever (#10864)", async () => {
    const h = harness({
      snapshot: () => [participant],
      pause: async () => {
        throw new Error("propagation failed")
      },
      observeHold: async () => ({ held: false, childSeq: 0 }),
    })
    await h.controller.pause("root", 1)
    expect(h.registry.require("root").participants.a).toMatchObject({ state: "lost" })
    await h.controller.resume("root", 1, "resume-1")
    expect(h.controller.released("root", 1, "resume-1")).toBe(true)
    expect(await h.controller.retryLost("root", 1)).toEqual([])
    expect(h.registry.require("root").participants.a).toBeUndefined()
  })

  test("#given a participant recorded without a cutoff #when Resume reaches it #then the failure is recorded instead of throwing past the transaction (#10864)", async () => {
    const h = harness({ snapshot: () => [participant] })
    await h.controller.pause("root", 1)
    h.registry.update("root", 1, "a", { state: "resuming", observedChildSeq: undefined, ackSeq: undefined })
    const result = await h.controller.resume("root", 1, "resume-1")
    expect(result).toMatchObject({ kind: "installed", failures: [{ key: "a" }] })
    expect(h.registry.require("root").participants.a).toMatchObject({ state: "lost" })
  })

  test("#given guidance or install that throws #when Resume runs #then the failure is recorded and the barrier still releases (#10864)", async () => {
    const h = harness({
      dispatchGuidance: async () => {
        throw new Error("guidance exploded")
      },
      install: async () => {
        throw new Error("install exploded")
      },
    })
    await h.controller.pause("root", 1)
    const result = await h.controller.resume("root", 1, "resume-1")
    expect(result).toMatchObject({
      kind: "installed",
      failures: [
        { key: "parent", reason: expect.stringContaining("guidance exploded") },
        { key: "parent", reason: expect.stringContaining("install exploded") },
      ],
    })
    expect(h.controller.released("root", 1, "resume-1")).toBe(true)
    expect(h.barrier.state("root")).toEqual({ kind: "open" })
  })
})
