import { afterEach, describe, expect, test } from "bun:test"
import { DatabaseSync } from "node:sqlite"

import { createGatewayEngine, resolveFromEntries, type GatewayDeliverRequest } from "./engine"
import { gatewayDatabasePath } from "./paths"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"
import type { GatewayDeliveryResult } from "./types"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function summary(result: GatewayDeliveryResult | undefined): string {
  if (result === undefined) return "none"
  return result.kind === "ok" ? `${result.delivery.kind}${result.deduplicated === true ? "+dedup" : ""}` : `error:${result.error.code}`
}

const request = (key: string): GatewayDeliverRequest => ({ sender: { kind: "session", durable_id: "A" }, target: "B", text: `stuck ${key}`, idempotency_key: key })

describe("receipt_write_failures_leave_the_store_serving", () => {
  test("#given one process whose two deliveries both lost their receipt writes #when it retries both keys and sends a third #then every call answers and nothing is sent twice", async () => {
    const h = createGatewayHarness()
    harness = h
    h.session("A")
    const b = h.session("B")
    const sender = h.store()
    const lockWait = () => Object.assign(new Error("gateway store lock wait exceeded"), { code: "gateway_lock_wait_exceeded" })
    const stuck = h.engineFor({ ...sender, completeReceipt: async () => { throw lockWait() }, abandonReceipt: async () => { throw lockWait() } } satisfies GatewayStore)
    const retrying = h.engineFor(sender)

    const first = await settled(stuck.deliver(request("admitted")))
    await h.quiesce()
    const replay = await settled(retrying.deliver(request("admitted")))
    b.online = false
    const second = await settled(stuck.deliver(request("queued")))
    const inProgress = await settled(retrying.deliver(request("queued")))
    const third = await settled(retrying.deliver(request("third")))

    expect({
      first: first.error?.message,
      replay: summary(replay.value),
      second: second.error?.message,
      inProgress: summary(inProgress.value),
      third: summary(third.value),
    }).toEqual({ first: "gateway store lock wait exceeded", replay: "started+dedup", second: "gateway store lock wait exceeded", inProgress: "error:idempotency_in_progress", third: "queued_offline" })
    const rows = await b.store.list({ target_durable_id: "B" })
    expect(rows.map((row) => [row.body, row.state, b.runtime.enqueueCount(row.delivery_id)])).toEqual([
      ["stuck admitted", "applied", 1],
      ["stuck queued", "queued", 0],
      ["stuck third", "queued", 0],
    ])
  })

  test("#given another connection holds the write lock while a send settles its receipt #when both receipt writes hit the real lock-wait bound twice #then the worker keeps answering and the retries resolve from the rows", async () => {
    const h = createGatewayHarness()
    harness = h
    h.session("A")
    const b = h.session("B")
    const sender = h.store({ _test: { busyTimeoutMs: 50, lockWaitMaxMs: 300 } })
    await sender.identity()
    const holder = new DatabaseSync(gatewayDatabasePath(h.agentDir), { timeout: 0 })
    let holding = false
    const engine = createGatewayEngine({
      store: sender,
      resolve: resolveFromEntries(h.entries, () => h.agentDir),
      now: () => h.clock.now,
      endpoints: {
        wake: async () => {
          holder.exec("BEGIN IMMEDIATE")
          holding = true
          throw new Error("endpoint unreachable")
        },
      },
    })
    const release = () => {
      if (!holding) return
      holder.exec("COMMIT")
      holding = false
    }
    const events: string[] = []
    sender.onEvent((event) => events.push(event.kind))
    try {
      const outcomes: Record<string, string> = {}
      for (const key of ["one", "two"]) {
        const lost = await settled(engine.deliver(request(key)))
        release()
        outcomes[`${key}:send`] = lost.error === undefined ? `resolved:${summary(lost.value)}` : String((lost.error as { code?: string }).code)
        outcomes[`${key}:retry`] = summary((await settled(h.engineFor(sender).deliver(request(key)))).value)
      }
      await settled(b.drain.drain({ reason: "start" }))
      b.runtime.endTurn()
      await h.quiesce()
      outcomes["one:after_admit"] = summary((await settled(h.engineFor(sender).deliver(request("one")))).value)
      outcomes.third = summary((await settled(h.engineFor(sender).deliver(request("three")))).value)
      expect(outcomes).toEqual({
        "one:send": "gateway_lock_wait_exceeded",
        "one:retry": "error:idempotency_in_progress",
        "two:send": "gateway_lock_wait_exceeded",
        "two:retry": "error:idempotency_in_progress",
        "one:after_admit": "started+dedup",
        third: "queued",
      })
      expect(events.filter((kind) => kind === "lock_wait_exceeded").length).toBe(4)
      const rows = await b.store.list({ target_durable_id: "B" })
      expect(rows.map((row) => b.runtime.enqueueCount(row.delivery_id))).toEqual([1, 1, 1])
    } finally {
      release()
      holder.close()
    }
  }, 30_000)
})
