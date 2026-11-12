import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"

import { WAKE_LEASE_MS, WOKEN_SESSION_CAP } from "./constants"
import { gatewayDatabasePath, gatewayWakeMarkerPath } from "./paths"
import { processStartTime } from "./process-identity"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { ProcessIdentity } from "./types"

// The record of a woken session (#13037, amendment A3.1.1 to A3.1.3): one row per session a wake asked for or opened,
// with the cap of 4 counted in the transaction that starts a row, a lease and a generation that fences every write.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

async function started(store: GatewayStore, durableId: string): Promise<number> {
  await store.woken.request({ durable_id: durableId, session_file: `/sessions/${durableId}.jsonl` })
  const answer = await store.woken.start({ durable_id: durableId })
  if (answer.kind !== "started") throw new Error(`expected ${durableId} to start, got ${answer.kind}`)
  return answer.row.generation
}

async function deadIdentity(): Promise<ProcessIdentity> {
  const child = Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  const startTime = await processStartTime(child.pid)
  child.stdin.end()
  await child.exited
  return { pid: child.pid, process_start_time: startTime, instance_id: randomUUID(), runtime_instance: null }
}

describe("woken session record", () => {
  test("#given a wake request #when it is repeated #then one requested row exists at generation 0 and the wake marker was touched", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const first = await store.woken.request({ durable_id: "s1", session_file: "/sessions/s1.jsonl" })
    const second = await store.woken.request({ durable_id: "s1", session_file: "/sessions/s1.jsonl" })
    expect(first).toMatchObject({ kind: "requested", created: true, row: { state: "requested", generation: 0 } })
    expect(second).toMatchObject({ kind: "requested", created: false })
    expect(await store.woken.list()).toHaveLength(1)
    expect(existsSync(gatewayWakeMarkerPath(h.agentDir))).toBe(true)
  })

  test("#given three rows past requested #when two store handles race to start a fourth and a fifth #then exactly one passes and the other is overloaded and stays requested", async () => {
    const h = (harness = createGatewayHarness())
    const seed = h.store()
    for (const id of ["a", "b", "c"]) await started(seed, id)
    const left = h.store()
    const right = h.store()
    await left.woken.request({ durable_id: "d", session_file: "/sessions/d.jsonl" })
    await right.woken.request({ durable_id: "e", session_file: "/sessions/e.jsonl" })

    const answers = await Promise.all([left.woken.start({ durable_id: "d" }), right.woken.start({ durable_id: "e" })])

    expect(answers.map((answer) => answer.kind).sort()).toEqual(["overloaded", "started"])
    const rows = await seed.woken.list()
    expect(rows.filter((row) => row.state !== "requested")).toHaveLength(WOKEN_SESSION_CAP)
    expect(rows.filter((row) => row.state === "requested")).toHaveLength(1)
  })

  test("#given four rows past requested #when a fifth asks to start #then it is overloaded, and it starts once one row ends", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const generations = new Map<string, number>()
    for (const id of ["a", "b", "c", "d"]) generations.set(id, await started(store, id))
    await store.woken.request({ durable_id: "e", session_file: "/sessions/e.jsonl" })

    expect(await store.woken.start({ durable_id: "e" })).toMatchObject({ kind: "overloaded" })
    expect((await store.woken.list()).find((row) => row.durable_id === "e")?.state).toBe("requested")

    expect(await store.woken.end({ durable_id: "a", generation: generations.get("a") ?? -1 })).toEqual({
      kind: "ended",
    })
    expect(await store.woken.start({ durable_id: "e" })).toMatchObject({
      kind: "started",
      row: { durable_id: "e", state: "opening", generation: 1 },
    })
  })

  test("#given a started row #when it starts #then the caller holds the lease for the lease time and the generation is raised", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.woken.request({ durable_id: "s1", session_file: "/sessions/s1.jsonl" })
    const answer = await store.woken.start({ durable_id: "s1" })
    if (answer.kind !== "started") throw new Error("not started")
    expect(answer.row).toMatchObject({
      state: "opening",
      generation: 1,
      requested_at: h.clock.now,
      lease_expires_at: h.clock.now + WAKE_LEASE_MS,
      lease_owner: await store.identity(),
    })

    h.clock.now += 20_000
    expect(await store.woken.renew({ durable_id: "s1", generation: 1 })).toMatchObject({
      kind: "renewed",
      row: { lease_expires_at: h.clock.now + WAKE_LEASE_MS, generation: 1 },
    })
  })

  test("#given a lease that has not run out #when another handle takes over #then it is refused and nothing changes", async () => {
    const h = (harness = createGatewayHarness())
    const owner = h.store()
    await started(owner, "s1")
    h.clock.now += WAKE_LEASE_MS - 1
    expect(await h.store().woken.takeOver({ durable_id: "s1" })).toMatchObject({
      kind: "lease_live",
      row: { generation: 1 },
    })
    expect((await owner.woken.list())[0]?.lease_owner).toEqual(await owner.identity())
  })

  test("#given an expired lease whose owner is alive #when another handle takes over #then the generation rises, it holds the lease, and the previous owner is reported alive", async () => {
    const h = (harness = createGatewayHarness())
    const owner = h.store()
    await started(owner, "s1")
    h.clock.now += WAKE_LEASE_MS + 1
    const successor = h.store()
    expect(await successor.woken.takeOver({ durable_id: "s1" })).toMatchObject({
      kind: "taken_over",
      previous_owner_alive: true,
      row: { generation: 2, lease_owner: await successor.identity(), lease_expires_at: h.clock.now + WAKE_LEASE_MS },
    })
  })

  test("#given an expired lease whose owner process is gone #when another handle takes over #then the previous owner is reported dead", async () => {
    const h = (harness = createGatewayHarness())
    const owner = h.store()
    await started(owner, "s1")
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.query("UPDATE woken_sessions SET lease_owner = ? WHERE durable_id = 's1'").run(
        JSON.stringify(await deadIdentity()),
      )
    } finally {
      db.close()
    }
    h.clock.now += WAKE_LEASE_MS + 1
    expect(await h.store().woken.takeOver({ durable_id: "s1" })).toMatchObject({
      kind: "taken_over",
      previous_owner_alive: false,
      row: { generation: 2 },
    })
  })

  test("#given a row taken over #when the earlier carrier writes with its generation #then every write answers lost_lease and the row is unchanged", async () => {
    const h = (harness = createGatewayHarness())
    const owner = h.store()
    const stale = await started(owner, "s1")
    h.clock.now += WAKE_LEASE_MS + 1
    const successor = h.store()
    expect(await successor.woken.takeOver({ durable_id: "s1" })).toMatchObject({ kind: "taken_over" })

    const lost = { kind: "lost_lease" }
    expect(await owner.woken.renew({ durable_id: "s1", generation: stale })).toEqual(lost)
    expect(await owner.woken.setState({ durable_id: "s1", generation: stale, state: "open" })).toEqual(lost)
    expect(await owner.woken.recordWaiting({ durable_id: "s1", generation: stale })).toEqual(lost)
    expect(await owner.woken.end({ durable_id: "s1", generation: stale })).toEqual(lost)

    const [row] = await successor.woken.list()
    expect(row).toMatchObject({ state: "opening", generation: 2, first_waiting_at: null })
  })

  test("#given the current generation #when the carrier sets the state and records waiting twice #then the state moves and the first time seen waiting is kept", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const generation = await started(store, "s1")
    h.clock.now += 1_000
    expect(await store.woken.setState({ durable_id: "s1", generation, state: "open" })).toMatchObject({
      kind: "ok",
      row: { state: "open", opened_at: h.clock.now },
    })
    const firstSeen = h.clock.now + 5_000
    h.clock.now = firstSeen
    await store.woken.recordWaiting({ durable_id: "s1", generation })
    h.clock.now += 60_000
    expect(await store.woken.recordWaiting({ durable_id: "s1", generation })).toMatchObject({
      kind: "ok",
      row: { first_waiting_at: firstSeen },
    })
  })
})
