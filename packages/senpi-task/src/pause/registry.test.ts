import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "./admission-barrier"
import { PauseRegistry, type PauseParticipant } from "./registry"

afterEach(cleanupProjects)

function participant(key: string, sequence: number, phase: "pre_grant" | "parked"): PauseParticipant {
  return {
    key, kind: phase === "parked" ? "task" : "held_admission",
    taskId: key, runEpoch: 0, runRef: { kind: "task", id: key },
    admission: { model: "test/model", laneKey: "test/model", sequence, phase },
    state: "pending", at: new Date(0).toISOString(),
  }
}

describe("durable parent pause participant ledger", () => {
  test("#given Stop #when its first registry write is observed #then admission was already closed", () => {
    const dir = tempProject()
    const barrier = new AdmissionBarrier()
    const registry = new PauseRegistry(dir, barrier)
    registry.begin("root", 1, [participant("task-a", 2, "parked")])
    expect(barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 1 })
    const saved = JSON.parse(readFileSync(join(dir, "pause", "root.json"), "utf8"))
    expect(saved).toMatchObject({ parentSessionId: "root", pauseSeq: 1, phase: "propagating" })
    expect(saved.participants["task-a"].admission).toEqual({
      model: "test/model", laneKey: "test/model", sequence: 2, phase: "parked",
    })
  })

  test("#given a restart #when restoring paused admissions #then parked capacity resumes before queued capacity in persisted sequence", () => {
    const dir = tempProject()
    const registry = new PauseRegistry(dir, new AdmissionBarrier())
    registry.begin("root", 1, [
      participant("queued-oldest", 0, "pre_grant"),
      participant("parked-later", 3, "parked"),
      participant("parked-first", 1, "parked"),
    ])
    const barrier = new AdmissionBarrier()
    const restored = new PauseRegistry(dir, barrier)
    restored.restore("root", { pauseSeq: 1 })
    expect(barrier.enter("root", { key: "late", runRef: { kind: "task", id: "late" } }).kind).toBe("held")
    expect(restored.orderedAdmissions("root").map(entry => entry.key))
      .toEqual(["parked-first", "parked-later", "queued-oldest"])
  })

  test("#given an acknowledged child cutoff #when resume is requested and Stop repeats #then cutoffs are frozen and old continuations cannot mutate the ledger", () => {
    const registry = new PauseRegistry(tempProject(), new AdmissionBarrier())
    registry.begin("root", 1, [participant("a", 0, "parked")])
    registry.update("root", 1, "a", { state: "held", ackSeq: 1, observedChildSeq: 8 })
    const intent = registry.requestResume("root", 1, "resume-1")
    expect(intent.childSeqCutoffs).toEqual({ a: 8 })
    registry.update("root", 1, "a", { observedChildSeq: 9 })
    expect(registry.load("root")?.resume?.childSeqCutoffs).toEqual({ a: 8 })
    registry.begin("root", 2, [participant("a", 0, "parked")])
    expect(registry.update("root", 1, "a", { state: "resumed" })).toBe(false)
    expect(registry.load("root")?.participants.a?.state).toBe("pending")
  })

  test("#given a crash before registry persistence #when the engine ledger is newer #then rebuild and close before reconciliation", () => {
    const barrier = new AdmissionBarrier()
    const registry = new PauseRegistry(tempProject(), barrier)
    registry.restore("root", { pauseSeq: 2, rebuild: () => [participant("a", 0, "parked")] })
    expect(registry.load("root")?.pauseSeq).toBe(2)
    expect(barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 2 })
  })
})
