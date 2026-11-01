import { afterEach, describe, expect, test } from "bun:test"

afterEach(cleanupProjects)

import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"
import { readProcessStartLowerBoundMs } from "./owner-process"

// The bound is compared against record timestamps in epoch ms on every platform; a reader that
// answered in seconds or clock ticks would make every live owner look like a newcomer.
describe("process start lower bound", () => {
  test.if(process.platform === "linux" || process.platform === "darwin" || process.platform === "win32")(
    "#given this process #when its start is read #then it is an epoch-ms bound no later than now and no earlier than its uptime allows",
    async () => {
      // given
      const before = Date.now()

      // when
      const start = await readProcessStartLowerBoundMs(process.pid)

      // then
      if (start === null) throw new Error("this platform could not read its own process start")
      expect(start).toBeLessThanOrEqual(before)
      expect(start).toBeGreaterThan(before - process.uptime() * 1000 - 10_000)
    },
  )

  test("#given an impossible pid #when its start is read #then nothing is claimed", async () => {
    expect(await readProcessStartLowerBoundMs(-1)).toBeNull()
  })
})

// The stamp is the only evidence other processes trust against a live pid, so it must come from the
// owner, not be inherited from an earlier process that held the same pid.
describe("host claim stamp", () => {
  test("#given a record this process owns #when it is written #then it carries this process's own claim stamp", () => {
    // given
    const store = tempStore()
    const before = Date.now()

    // when
    const record = seedRecord(store, { task_id: "st_7c000001", status: "running", residency_state: "resident", host_pid: process.pid })

    // then
    const claim = store.load(record.task_id)?.host_claim
    expect(claim?.pid).toBe(process.pid)
    expect(Date.parse(claim?.at ?? "")).toBeGreaterThanOrEqual(before)
  })

  test("#given a stamp under this pid from before this process began #when this process writes the record #then the stamp is renewed", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { task_id: "st_7c000002", status: "running", residency_state: "resident", host_pid: 4_242 })
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_claim: { pid: process.pid, at: new Date(0).toISOString() } }))

    // when
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_pid: process.pid }))

    // then
    expect(Date.parse(store.load(record.task_id)?.host_claim?.at ?? "")).toBeGreaterThanOrEqual(performance.timeOrigin)
  })

  test("#given a record another process owns #when this process writes it #then that owner's stamp is left alone", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { task_id: "st_7c000003", status: "running", residency_state: "resident", host_pid: 4_242 })
    const stamp = { pid: 4_242, at: new Date(1_000).toISOString() }
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_claim: stamp }))

    // when
    store.mutate(record.task_id, (fresh) => ({ ...fresh, revival_deferred_reason: "capacity" }))

    // then
    expect(store.load(record.task_id)?.host_claim).toEqual(stamp)
  })
})
