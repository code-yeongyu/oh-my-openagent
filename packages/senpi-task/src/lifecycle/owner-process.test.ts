import { afterEach, describe, expect, test } from "bun:test"

import { getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"

import type { TaskRecord } from "../state"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"
import { createOwnerProcessView, readProcessStartIdentity, recordOwnerAlive } from "./owner-process"

afterEach(cleanupProjects)

const OWNER = 4_242
const STAMPED = "linux-proc-start-ticks:1000"

function claimed(claim: TaskRecord["host_claim"]): TaskRecord {
  return { host_pid: OWNER, ...(claim === undefined ? {} : { host_claim: claim }) } as TaskRecord
}

async function aliveWith(actual: string | null, record: TaskRecord): Promise<boolean> {
  const view = createOwnerProcessView(async () => actual)
  await view.observe(OWNER)
  return recordOwnerAlive(() => true, view, record)
}

describe("process start identity", () => {
  test.if(process.platform === "linux" || process.platform === "darwin" || process.platform === "win32")(
    "#given this process #when its start identity is read twice #then both reads agree",
    async () => {
      const first = await readProcessStartIdentity(process.pid)
      if (first === null) throw new Error("this platform could not read its own process start")
      expect(await readProcessStartIdentity(process.pid)).toBe(first)
    },
  )

  test("#given an impossible pid #when its start is read #then nothing is claimed", async () => {
    expect(await readProcessStartIdentity(-1)).toBeNull()
  })
})

// The check must never call a live owner dead (#12078 review): identities are values from one reader,
// so no wall-clock step between the stamp and the check can change the answer.
describe("owner liveness from the claim stamp", () => {
  for (const at of [new Date(0).toISOString(), new Date(Date.now() + 86_400_000).toISOString()]) {
    test(`#given the owner still holds its pid and the wall clock moved (stamp at ${at}) #when checked #then the owner is alive`, async () => {
      expect(await aliveWith(STAMPED, claimed({ pid: OWNER, at, start: STAMPED }))).toBe(true)
    })
  }

  test("#given another process now holds the owner's pid #when checked #then the owner is dead", async () => {
    expect(await aliveWith("linux-proc-start-ticks:2000", claimed({ pid: OWNER, at: new Date().toISOString(), start: STAMPED }))).toBe(false)
  })

  test("#given a stamp from a build that wrote no start identity #when checked #then a live pid stays the owner", async () => {
    expect(await aliveWith("linux-proc-start-ticks:2000", claimed({ pid: OWNER, at: new Date().toISOString() }))).toBe(true)
  })

  test("#given identities from different readers #when checked #then a live pid stays the owner", async () => {
    expect(await aliveWith("proc-start-epoch:5", claimed({ pid: OWNER, at: new Date().toISOString(), start: STAMPED }))).toBe(true)
  })

  test("#given the start cannot be read now #when checked #then a live pid stays the owner", async () => {
    expect(await aliveWith(null, claimed({ pid: OWNER, at: new Date().toISOString(), start: STAMPED }))).toBe(true)
  })
})

// The stamp is the only evidence other processes trust against a live pid, so it must come from the
// owner, not be inherited from an earlier process that held the same pid.
describe("host claim stamp", () => {
  test("#given a record this process owns #when it is written #then it carries this process's own claim stamp", async () => {
    // given
    const store = tempStore()
    const before = Date.now()


    // when
    const record = seedRecord(store, { task_id: "st_7c000001", status: "running", residency_state: "resident", host_pid: process.pid })
    // The same cached read the store requested on its first write, so its own callback has run first.
    const own = await getProcessStartIdentity(process.pid)
    store.mutate(record.task_id, (fresh) => ({ ...fresh, revival_deferred_reason: "capacity" }))

    // then
    const claim = store.load(record.task_id)?.host_claim
    expect(claim?.pid).toBe(process.pid)
    expect(Date.parse(claim?.at ?? "")).toBeGreaterThanOrEqual(before)
    expect(claim?.start).toBe(own ?? undefined)
  })

  test("#given a stamp under this pid from an earlier holder of the pid #when this process writes the record #then the stamp is renewed", async () => {
    // given
    const store = tempStore()
    const own = await getProcessStartIdentity(process.pid)
    const record = seedRecord(store, { task_id: "st_7c000002", status: "running", residency_state: "resident", host_pid: 4_242 })
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_claim: { pid: process.pid, at: new Date().toISOString(), start: "linux-proc-start-ticks:1" } }))

    // when
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_pid: process.pid }))

    // then
    expect(store.load(record.task_id)?.host_claim?.start).toBe(own ?? undefined)
  })

  test("#given a record another process owns #when this process writes it #then that owner's stamp is left alone", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { task_id: "st_7c000003", status: "running", residency_state: "resident", host_pid: 4_242 })
    const stamp = { pid: 4_242, at: new Date(1_000).toISOString(), start: STAMPED }
    store.mutate(record.task_id, (fresh) => ({ ...fresh, host_claim: stamp }))

    // when
    store.mutate(record.task_id, (fresh) => ({ ...fresh, revival_deferred_reason: "capacity" }))

    // then
    expect(store.load(record.task_id)?.host_claim).toEqual(stamp)
  })
})
