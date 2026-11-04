import { afterEach, describe, expect, test } from "bun:test"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import { cleanupPair, controlPair, T1 } from "./__fixtures__/control-pair"

afterEach(cleanupPair)

type Pair = ReturnType<typeof controlPair>
const RUN = { kind: "task" as const, id: T1 }
const OWNER = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN }
const planted = Array.from({ length: 8 }, (_, n) => ({ inputId: `planted-${n}`, revision: 0, text: "earlier" }))

const record = (pair: Pair): TaskRecord => {
  const loaded = pair.store.load(T1)
  if (loaded === null || loaded === undefined) throw new Error(`${T1} has no record`)
  return loaded
}
const participant = (pair: Pair) => pair.runPause.registry.load("parent-1")?.participants[T1]
const plant = (pair: Pair) => pair.channel.assertDesired({ taskId: T1, runEpoch: 1, parentSessionId: "parent-1", pauseSeq: 2, runRef: RUN,
  phase: "paused", guidance: planted })

describe("messages held for a remote child while the run is stopped (review of #12373, HIGH)", () => {
  test("#given each message is answered by the owner #when a ninth is sent and the run Resumes #then all nine are delivered and the child resumes", async () => {
    const pair = controlPair()
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    for (let n = 0; n < 9; n += 1) {
      expect(await pair.carry.carry(record(pair), OWNER, `m${n}`)).toMatchObject({ kind: "held" })
      await pair.inbox.tick()
      await pair.runPause.bridge.tickRemote("parent-1")
    }
    expect(pair.owner.calls.hold).toHaveLength(9)
    expect(await pair.runPause.controller.resume("parent-1", 2, "r-1")).toMatchObject({ kind: "installed" })
    expect(pair.owner.calls.resume).toBe(1)
    expect(participant(pair)?.state).toBe("resumed")
  })

  test("#given the register already holds eight unanswered messages #when one more is sent #then a typed guidance_too_large, nothing kept, and the Resume still reaches the owner", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    plant(pair)
    const sent = await pair.carry.carry(record(pair), OWNER, "ninth")
    expect(sent).toMatchObject({ kind: "not_continuable" })
    expect(sent.kind === "not_continuable" ? sent.reason : "").toStartWith("guidance_too_large")
    expect(participant(pair)?.guidance ?? []).toEqual([])
    pair.ownerTicks.enabled = true
    expect(await pair.runPause.controller.resume("parent-1", 2, "r-1")).toMatchObject({ kind: "installed" })
    expect(pair.owner.calls.resume).toBe(1)
  })

  test("#given ledger guidance that no longer fits the register #when the run Resumes #then the Resume is written without it and the child resumes", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    pair.runPause.registry.begin("parent-1", 2, [{ key: T1, taskId: T1, kind: "task", runRef: RUN, runEpoch: 1, state: "owned_elsewhere",
      guidance: [{ inputId: "send-late", revision: 0, text: "late" }], at: new Date(0).toISOString() }])
    pair.runPause.registry.phase("parent-1", 2, "applied")
    plant(pair)
    pair.ownerTicks.enabled = true
    expect(await pair.runPause.controller.resume("parent-1", 2, "r-1")).toMatchObject({ kind: "installed" })
    expect(pair.owner.calls.resume).toBe(1)
  })
})
