import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { writeSessionFile } from "../wake/testing/fake-wake-host"
import { createLocalTransport } from "./local-transport"
import { resultFromRow } from "./result"
import { createSameDeviceWake } from "./same-device-wake"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { OutboundDelivery } from "./transport"

// The same-device leg behind its switch (#13037 design 5.3, A3.1.6) and what a queued row answers (A2.6, A2.11).

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function delivery(target: string): OutboundDelivery {
  return {
    sender: { kind: "session", durable_id: "a" },
    caller_id: "a",
    target: { kind: "local", thread_id: target },
    text: "hello",
    mode: "auto",
    idempotency_key: `k-${target}-${Math.random()}`,
    args: {},
  }
}

function setup(options: {
  readonly enabled: boolean
  readonly carrier: boolean
  readonly header?: Record<string, unknown>
}) {
  const h = (harness = createGatewayHarness())
  const sender = h.session("a")
  h.phantom("t")
  const sessions = join(h.agentDir, "sessions")
  writeSessionFile(sessions, "t", options.header ?? {})
  const carried: string[] = []
  const transport = createLocalTransport(
    sender.engine,
    createSameDeviceWake({
      store: sender.store,
      sessionsDirectory: sessions,
      enabled: () => options.enabled,
      ...(options.carrier
        ? {
            carrier: {
              wake: async (durableId: string) => {
                carried.push(durableId)
              },
            },
          }
        : {}),
    }),
  )
  return { h, sender, transport, carried }
}

describe("the same-device switch", () => {
  test("#given the default switch (off) #when a session sends to one that is not running #then it is queued offline as today and no wake row is written", async () => {
    const { sender, transport, carried } = setup({ enabled: false, carrier: true })
    expect(await transport.deliver(delivery("t"))).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
    expect(await sender.store.woken.list()).toEqual([])
    expect(carried).toEqual([])
  })

  test("#given the switch on and a sender that is a carrier #when it sends #then the wake row is written, the carrier takes it, and the answer is queued waiting on the wake", async () => {
    const { sender, transport, carried } = setup({ enabled: true, carrier: true })
    expect(await transport.deliver(delivery("t"))).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "wake" } },
    })
    expect(await sender.store.woken.list()).toMatchObject([{ durable_id: "t", state: "requested" }])
    expect(carried).toEqual(["t"])
  })

  test("#given the switch on and no carrier running #when it sends #then the row waits requested and the answer is queued offline with the reason wake_unavailable", async () => {
    const { sender, transport } = setup({ enabled: true, carrier: false })
    expect(await transport.deliver(delivery("t"))).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued_offline", reason: "wake_unavailable" },
    })
    expect(await sender.store.woken.list()).toMatchObject([{ durable_id: "t", state: "requested" }])
  })

  test.each<[string, Record<string, unknown>]>([
    ["a child session", { spawnedBy: { parentSessionId: "p", rootSessionId: "p", taskId: "x" } }],
    ["a session of a kind this build does not know", { kind: "robot" }],
  ])(
    "#given the switch on and %s as the target #when it sends #then it stays queued offline and nothing is requested",
    async (_label, header) => {
      const { sender, transport, carried } = setup({ enabled: true, carrier: true, header })
      expect(await transport.deliver(delivery("t"))).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
      expect(await sender.store.woken.list()).toEqual([])
      expect(carried).toEqual([])
    },
  )
})

describe("what a queued row answers", () => {
  test("#given a woken row, a held state and a person's wait #when the session's waiting is read #then a hold comes before the wake, and a person's wait reads approval", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    expect(await store.sessionWait.waitingOn({ durable_id: "t" })).toBeNull()
    await store.woken.request({ durable_id: "t", session_file: "/sessions/t.jsonl" })
    expect(await store.sessionWait.waitingOn({ durable_id: "t" })).toEqual({ kind: "wake" })
    await store.sessionWait.write({ durable_id: "t", wait: "held", hold_kinds: ["session_hold"], file_size: 1 })
    expect(await store.sessionWait.waitingOn({ durable_id: "t" })).toEqual({ kind: "hold" })
    await store.sessionWait.write({ durable_id: "t", wait: "waiting", hold_kinds: [], file_size: 1 })
    expect(await store.sessionWait.waitingOn({ durable_id: "t" })).toEqual({ kind: "approval" })
  })

  test("#given a row the engine answered started while the session is held #when it is answered #then the wait is reported before the admission kind, naming this device", async () => {
    const h = (harness = createGatewayHarness())
    const sender = h.session("a")
    h.phantom("t")
    const sent = await sender.engine.deliver({ sender: { kind: "session", durable_id: "a" }, target: "t", text: "x" })
    if (sent.kind !== "ok") throw new Error("send refused")
    const [row] = await sender.store.list({ target_durable_id: "t" })
    if (row === undefined) throw new Error("no row")
    const started = { ...row, state: "admitted" as const, admission_kind: "started", turn_epoch: 1 }
    expect(resultFromRow(started, 1, null, false, false, { kind: "hold", device: "dev-here" })).toMatchObject({
      delivery: { kind: "queued", waiting_on: { kind: "hold", device: "dev-here" } },
    })
    expect(resultFromRow(started, 1, null, false, false)).toMatchObject({ delivery: { kind: "started" } })
  })
})
