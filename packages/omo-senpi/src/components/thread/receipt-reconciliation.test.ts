import { expect, setSystemTime, test } from "bun:test"
import { join } from "node:path"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import { createGatewayHarness } from "./gateway/testing/harness"
import { createInboxDrain } from "./gateway/drain"
import { FakeSessionRuntime } from "./gateway/testing/fake-runtime"
import { createDeliveryConsumer } from "./consumer/consumer"
import { createFakeDeliveryService } from "./consumer/testing/fake-delivery-service"
import { writeSessionFile } from "./wake/testing/fake-wake-host"
import type { JsonObject, RemoteThreadSurface } from "./remote/ports"
import type { GatewayStore } from "./gateway/store"

type Timer = { readonly run: () => void; readonly ms: number; cancelled: boolean }

async function setup(
  noticeMode: "deliver" | "drop" | "duplicate" = "deliver",
  options: {
    readonly timers?: Timer[]
    /** Wraps the store the holder's consumer reads, to hold or count its reads. */
    readonly holderStore?: (store: GatewayStore) => GatewayStore
    /** Collects what the holder's consumer reports through onError. */
    readonly errors?: unknown[]
  } = {},
) {
  const h = createGatewayHarness()
  const f = createRemoteThreadFixture()
  const store = h.store()
  const session = "dur-on-b"
  const path = writeSessionFile(join(h.agentDir, "sessions"), session)
  const runtime = new FakeSessionRuntime(path, session, h.agentDir)
  runtime.phaseValue = "mid_turn"
  const drain = createInboxDrain({
    store,
    runtime,
    durableId: session,
    sessionPath: () => path,
    now: () => h.clock.now,
    admitIntake: async () => "admitted",
  })
  const admission = { admitted: true }
  const link = { connected: true, consumerDenied: false }
  const service = createFakeDeliveryService(admission)
  const counts = { forward: 0, reverse: 0, wakes: 0, queries: 0 }
  const senderService = createFakeDeliveryService({ admitted: true })
  // reportDrained reports its mark at once and sends each refusal notice in the background (#14623 review M3), so a test
  // that reads what a notice did waits for every notice it started, then for the sender's consumer to apply them.
  const notices: Promise<void>[] = []
  const consumer = createDeliveryConsumer({
    store: options.holderStore?.(store) ?? store,
    port: {
      ...service.port,
      notice: (n) => {
        counts.reverse++ // Count before transport, including notices deliberately lost below.
        const sent = (async () => {
          if (noticeMode === "drop") return
          for (let i = 0; i < (noticeMode === "duplicate" ? 2 : 1); i++)
            await senderService.inbound({
              command_id: `notice-${counts.reverse}-${i}`,
              sender_device: "b",
              durable_id: n.session,
              record: {
                type: "delivery_outcome_notice",
                deliveryId: n.delivery_id,
                targetSessionId: n.target_durable_id,
                reason: n.reason,
              },
            })
        })()
        notices.push(sent)
        return sent
      },
    },
    agentDir: h.agentDir,
    sessionsDirectory: join(h.agentDir, "sessions"),
    chainCountLimit: async () => undefined,
    wake: async () => {
      counts.wakes++
    },
    ...(options.errors === undefined ? {} : { onError: (error: unknown) => options.errors?.push(error) }),
    ...(options.timers === undefined
      ? {}
      : {
          schedule: (run: () => void, ms: number) => {
            const timer: Timer = { run, ms, cancelled: false }
            options.timers?.push(timer)
            return () => {
              timer.cancelled = true
            }
          },
        }),
  })
  await consumer.start()
  const account = f.account({ live: [], unlistedReason: "route_unlisted", wakeFeature: true })
  const hand = async (durable_id: string, record: JsonObject) => {
    const answer = await service.inbound({
      command_id: `command-${counts.forward}-${counts.queries}`,
      sender_device: "a",
      durable_id,
      record,
    })
    await consumer.idle()
    return { kind: "ok" as const, response: { ...answer } }
  }
  const remote: RemoteThreadSurface = {
    ...account.remote,
    sessions: {
      ...account.remote.sessions,
      wake: async (_device, target, record) => {
        counts.forward++
        return hand(target, record)
      },
      receipt: async (_device, target, deliveryId) => {
        if (!link.connected) return { kind: "unavailable" }
        counts.queries++
        if (link.consumerDenied)
          return {
            kind: "ok",
            response: { type: "response", success: true, data: { kind: "refused", reason: "sender_not_admitted" } },
          }
        if (!admission.admitted) return { kind: "refused", reason: "remote_control_off" }
        return hand(target, { type: "get_delivery_outcome", deliveryId })
      },
    },
  }
  const sender = f.surface(remote)
  const senderConsumer = createDeliveryConsumer({
    store: sender.store,
    port: senderService.port,
    agentDir: sender.agentDir,
    sessionsDirectory: join(sender.agentDir, "sessions"),
    chainCountLimit: async () => undefined,
    wake: async () => {
      counts.wakes++
    },
  })
  await senderConsumer.start()
  return {
    h,
    store,
    runtime,
    drain,
    counts,
    admission,
    sender,
    remote,
    f,
    consumer,
    senderService,
    link,
    noticesSettled: async () => {
      await Promise.all(notices)
      await senderConsumer.idle()
    },
    cleanup: async () => {
      setSystemTime()
      consumer.stop()
      senderConsumer.stop()
      drain.stop()
      await f.cleanup()
      await h.dispose()
    },
  }
}

test("an older peer has no receipt capability and a replay never turns into a second hand-off", async () => {
  const f = createRemoteThreadFixture()
  try {
    const account = f.account({ live: [], unlistedReason: "route_unlisted", wakeFeature: true })
    const sender = f.surface(account.remote)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "legacy" }
    const first = await sender.run("thread_send", args)
    expect(first.kind).toBe("ok")
    expect(await sender.run("thread_send", args)).toMatchObject({
      kind: "ok",
      deduplicated: true,
      outcome: { kind: "outcome_unavailable" },
    })
    expect(account.sent.filter((entry) => entry.via === "wake")).toHaveLength(1)
  } finally {
    await f.cleanup()
  }
})

test("a notice from a different authenticated device cannot revise the retained receipt", async () => {
  const x = await setup()
  try {
    const first = await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k" })
    if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
      throw new Error("missing delivery id")
    const reply = await x.senderService.inbound({
      command_id: "forged-notice",
      sender_device: "another-device",
      durable_id: "dur-caller",
      record: {
        type: "delivery_outcome_notice",
        deliveryId: first.delivery_id,
        targetSessionId: "dur-on-b",
        reason: "expired",
      },
    })
    expect(reply).toEqual({ type: "response", success: true, data: { accepted: true } })
    const held = await x.sender.store.remoteReceipt({
      now: x.sender.store.now(),
      principal: "session:dur-caller",
      delivery_id: first.delivery_id,
    })
    expect(held?.result.outcome).toBeUndefined()
    expect(
      await x.store.receiptOutcome({
        now: x.h.clock.now,
        principal: "device:another-device",
        delivery_id: first.delivery_id,
        target_durable_id: "dur-on-b",
      }),
    ).toEqual({ kind: "outcome_unavailable" })
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 0 })
  } finally {
    await x.cleanup()
  }
})

test.each([86_399_999, 86_400_000, 86_400_001])(
  "remote lookup at %i ms never wakes or repeats its hand-off",
  async (elapsed) => {
    const x = await setup()
    try {
      setSystemTime(x.h.clock.now)
      const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
      const first = await x.sender.run("thread_send", args)
      expect(first).toMatchObject({ kind: "ok", delivery: { kind: "queued" } })
      x.h.clock.now += elapsed
      setSystemTime(x.h.clock.now)
      const replay = await x.sender.run("thread_send", args)
      expect(replay).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued" },
        outcome: elapsed < 86_400_000 ? { kind: "pending" } : { kind: "refused", reason: "expired" },
      })
      const rows = await x.store.list({ target_durable_id: "dur-on-b" })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject(
        elapsed < 86_400_000 ? { state: "queued" } : { state: "refused", reason: "expired" },
      )
      expect(x.runtime.enqueueCalls).toHaveLength(0)
      expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
    } finally {
      await x.cleanup()
    }
  },
)

test("application evidence wins after the deadline; admission alone is not application", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    const first = await x.sender.run("thread_send", args)
    if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
      throw new Error("send did not return a delivery id")
    await x.drain.drain({ reason: "command" })
    const ledgerId = `device:a/${first.delivery_id}`
    expect(x.runtime.transcriptEntries(ledgerId)).toBe(0)
    x.h.clock.now += 86_400_000
    setSystemTime(x.h.clock.now)
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "admitted" } })
    await x.consumer.reportDrained()
    expect(x.counts.reverse).toBe(0)
    x.runtime.endTurn()
    expect(x.runtime.transcriptEntries(ledgerId)).toBe(1)
    // No drain after emission: the lookup itself must find durable proof.
    expect(await x.sender.run("thread_send", args)).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued" },
      outcome: { kind: "applied" },
    })
    expect(await x.sender.run("thread_read", { thread: "dur-on-b", delivery_id: first.delivery_id })).toMatchObject({
      kind: "ok",
      outcome: { kind: "applied" },
    })
    expect(
      await x.sender.store.reconcileRemoteReceipt({
        now: x.sender.store.now(),
        principal: "session:dur-caller",
        idempotency_key: "k",
        delivery_id: first.delivery_id,
        device: "b",
        target_durable_id: "dur-on-b",
        outcome: { kind: "refused", reason: "expired" },
      }),
    ).toEqual({ kind: "applied" })
    expect(x.runtime.enqueueCount(ledgerId)).toBe(1)
    await x.consumer.reportDrained()
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 3 })
  } finally {
    await x.cleanup()
  }
})

test("query by old ID never sends anew after sender receipt retention", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    const first = await x.sender.run("thread_send", args)
    if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
      throw new Error("send did not return a delivery id")
    x.h.clock.now += 30 * 86_400_000 - 1
    setSystemTime(x.h.clock.now)
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "refused", reason: "expired" } })
    x.h.clock.now++
    setSystemTime(x.h.clock.now)
    expect(await x.sender.run("thread_read", { thread: "dur-on-b", delivery_id: first.delivery_id })).toMatchObject({
      outcome: { kind: "outcome_unavailable" },
    })
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
    const next = await x.sender.run("thread_send", args)
    expect(next).toMatchObject({ kind: "ok", deduplicated: false })
    expect(x.counts.forward).toBe(2)
    expect(await x.store.list({ target_durable_id: "dur-on-b" })).toHaveLength(2)
  } finally {
    await x.cleanup()
  }
})

test.each(["sender_not_admitted", "expired"] as const)(
  "a revoked sender gets no %s notice or receipt state",
  async (reason) => {
    const x = await setup()
    try {
      const args = { thread: "dur-on-b", message: "private", idempotency_key: "k" }
      await x.sender.run("thread_send", args)
      x.admission.admitted = false
      const [row] = await x.store.list({ target_durable_id: "dur-on-b" })
      if (row === undefined) throw new Error("missing row")
      await x.store.refuseQueued({ now: x.h.clock.now, delivery_id: row.delivery_id, reason })
      await x.consumer.reportDrained()
      const denied = await x.sender.run("thread_send", args)
      expect(denied.kind).toBe("error")
      expect(denied).not.toHaveProperty("outcome")
      expect(JSON.stringify(denied)).not.toContain("private")
      expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
    } finally {
      await x.cleanup()
    }
  },
)

test("a consumer-side access denial cannot be disguised as an unavailable outcome", async () => {
  const x = await setup()
  try {
    const args = { thread: "dur-on-b", message: "private", idempotency_key: "k" }
    await x.sender.run("thread_send", args)
    x.link.consumerDenied = true
    const denied = await x.sender.run("thread_send", args)
    expect(denied.kind).toBe("error")
    expect(denied).not.toHaveProperty("outcome")
    expect(JSON.stringify(denied)).not.toContain("private")
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})

test.each(["expired", "turn_conflict", "not_steerable", "target_closed"] as const)(
  "a permitted %s notice is claimed once, and duplicate transport never changes the terminal outcome",
  async (reason) => {
    const x = await setup("duplicate")
    try {
      const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
      await x.sender.run("thread_send", args)
      const [row] = await x.store.list({ target_durable_id: "dur-on-b" })
      if (row === undefined || row.ledger_id == null) throw new Error("missing intake")
      await x.store.refuseQueued({ now: x.h.clock.now, delivery_id: row.delivery_id, reason })
      await x.consumer.reportDrained()
      await x.consumer.reportDrained()
      await x.noticesSettled()
      const held = await x.sender.store.remoteReceipt({
        now: x.sender.store.now(),
        principal: "session:dur-caller",
        delivery_id: row.ledger_id.slice("device:a/".length),
      })
      expect(held?.result.outcome).toEqual({ kind: "refused", reason })
      expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "refused", reason } })
      expect(x.counts).toEqual({ forward: 1, reverse: 1, wakes: 1, queries: 1 })
    } finally {
      await x.cleanup()
    }
  },
)

test("a lost refusal notice is recovered by query without another hand-off", async () => {
  const x = await setup("drop")
  try {
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    await x.sender.run("thread_send", args)
    const [row] = await x.store.list({ target_durable_id: "dur-on-b" })
    if (row === undefined) throw new Error("missing intake")
    await x.store.refuseQueued({ now: x.h.clock.now, delivery_id: row.delivery_id, reason: "target_closed" })
    await x.consumer.reportDrained()
    expect(await x.sender.run("thread_send", args)).toMatchObject({
      outcome: { kind: "refused", reason: "target_closed" },
    })
    expect(x.counts).toEqual({ forward: 1, reverse: 1, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})

test("a claim held before the deadline is not falsely expired by lookup", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    await x.sender.run("thread_send", args)
    const [row] = await x.store.list({ target_durable_id: "dur-on-b" })
    if (row === undefined) throw new Error("missing intake")
    const self = await x.store.identity()
    x.h.clock.now += 86_399_999
    expect(
      await x.store.claim({ now: x.h.clock.now, delivery_id: row.delivery_id, self, lane: "follow_up" }),
    ).toMatchObject({ kind: "claimed" })
    x.h.clock.now++
    setSystemTime(x.h.clock.now)
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "outcome_unavailable" } })
    expect(await x.store.list({ target_durable_id: "dur-on-b" })).toMatchObject([{ state: "admitting", attempt: 1 }])
    await x.consumer.reportDrained()
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})

test("expiry and a deadline claim cannot both win", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    await x.sender.run("thread_send", args)
    const [row] = await x.store.list({ target_durable_id: "dur-on-b" })
    if (row === undefined) throw new Error("missing intake")
    const self = await x.store.identity()
    x.h.clock.now += 86_400_000
    setSystemTime(x.h.clock.now)
    const [claim, replay] = await Promise.all([
      x.store.claim({ now: x.h.clock.now, delivery_id: row.delivery_id, self, lane: "follow_up" }),
      x.sender.run("thread_send", args),
    ])
    expect(claim).toEqual({ kind: "lost", state: "refused" })
    expect(replay).toMatchObject({ outcome: { kind: "refused", reason: "expired" } })
    expect(x.runtime.enqueueCalls).toHaveLength(0)
    expect(await x.store.list({ target_durable_id: "dur-on-b" })).toMatchObject([{ state: "refused", attempt: 0 }])
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})

// #14266: the holder answered queued and asked for the wake, but the session never ran (this fixture's wake only counts).
// The intake row is left to the target's own reconcile, which never comes, so at its deadline the holder settles it and
// tells the sender; the sender never has to ask.
test.each([86_399_999, 86_400_000])(
  "a delivery whose holder never woke the session is reported to the sender at its deadline, unasked (%i ms)",
  async (elapsed) => {
    const x = await setup()
    try {
      setSystemTime(x.h.clock.now)
      const first = await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k" })
      if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
        throw new Error("send did not return a delivery id")
      expect(first).toMatchObject({ delivery: { kind: "queued", waiting_on: { kind: "wake" } } })
      x.h.clock.now += elapsed
      setSystemTime(x.h.clock.now)
      await x.consumer.reportDrained()
      await x.noticesSettled()
      const due = elapsed >= 86_400_000
      expect(await x.store.list({ target_durable_id: "dur-on-b" })).toMatchObject([
        due ? { state: "refused", reason: "expired" } : { state: "queued" },
      ])
      const held = await x.sender.store.remoteReceipt({
        now: x.sender.store.now(),
        principal: "session:dur-caller",
        delivery_id: first.delivery_id,
      })
      expect(held?.result.outcome).toEqual(due ? { kind: "refused", reason: "expired" } : undefined)
      expect(x.runtime.enqueueCalls).toHaveLength(0)
      expect(x.counts).toEqual({ forward: 1, reverse: due ? 1 : 0, wakes: 1, queries: 0 })
    } finally {
      await x.cleanup()
    }
  },
)

test("the holder's own timer reports a never-woken delivery at its deadline, with no other drained report", async () => {
  const timers: Timer[] = []
  const x = await setup("deliver", { timers })
  try {
    setSystemTime(x.h.clock.now)
    const first = await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k" })
    if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
      throw new Error("send did not return a delivery id")
    await x.consumer.idle()
    const armed = timers.filter((timer) => !timer.cancelled)
    expect(armed.map((timer) => timer.ms)).toEqual([86_400_000])
    x.h.clock.now += 86_400_000
    setSystemTime(x.h.clock.now)
    armed[0]?.run()
    await x.consumer.idle()
    await x.noticesSettled()
    const held = await x.sender.store.remoteReceipt({
      now: x.sender.store.now(),
      principal: "session:dur-caller",
      delivery_id: first.delivery_id,
    })
    expect(held?.result.outcome).toEqual({ kind: "refused", reason: "expired" })
    // Nothing is left queued, so nothing is armed again.
    expect(timers.filter((timer) => !timer.cancelled && timer !== armed[0])).toEqual([])
    expect(x.counts).toEqual({ forward: 1, reverse: 1, wakes: 1, queries: 0 })
  } finally {
    await x.cleanup()
  }
})

test("a settlement pass that read the rows before a send was committed never cancels the timer the newer pass armed", async () => {
  const timers: Timer[] = []
  // The startup pass reads the open sessions before the send exists, and is held until the send's own pass has armed.
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let reads = 0
  const x = await setup("deliver", {
    timers: new Proxy(timers, {
      get: (target, key) =>
        key === "push"
          ? (timer: Timer) => {
              const length = target.push(timer)
              release?.()
              return length
            }
          : Reflect.get(target, key),
    }),
    holderStore: (store) => ({
      ...store,
      intakeMarks: {
        ...store.intakeMarks,
        openSessions: async () => {
          const sessions = await store.intakeMarks.openSessions()
          if (reads++ === 0) await held
          return sessions
        },
      },
    }),
  })
  try {
    setSystemTime(x.h.clock.now)
    await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k" })
    await x.consumer.idle()
    expect(timers.filter((timer) => !timer.cancelled).map((timer) => timer.ms)).toEqual([86_400_000])
  } finally {
    await x.cleanup()
  }
})

test("a settlement pass that fails with nothing armed arms a retry, so the deadline is not left to a later send", async () => {
  const timers: Timer[] = []
  const errors: unknown[] = []
  let failing = false
  const x = await setup("deliver", {
    timers,
    holderStore: (store) => ({
      ...store,
      intakeMarks: {
        ...store.intakeMarks,
        openSessions: async () => {
          if (failing) throw new Error("injected store failure")
          return await store.intakeMarks.openSessions()
        },
      },
    }),
    errors,
  })
  try {
    setSystemTime(x.h.clock.now)
    failing = true
    await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k" })
    await x.consumer.idle()
    expect(errors.map(String)).toContain("Error: injected store failure")
    const retry = timers.filter((timer) => !timer.cancelled)
    expect(retry.map((timer) => timer.ms)).toEqual([60_000])
    failing = false
    x.h.clock.now += 60_000
    setSystemTime(x.h.clock.now)
    retry[0]?.run()
    await x.consumer.idle()
    expect(timers.filter((timer) => !timer.cancelled && timer !== retry[0]).map((timer) => timer.ms)).toEqual([
      86_400_000 - 60_000,
    ])
  } finally {
    await x.cleanup()
  }
})

test("a send while the holder's timer is armed reads no rows to re-arm it", async () => {
  const timers: Timer[] = []
  let reads = 0
  const x = await setup("deliver", {
    timers,
    holderStore: (store) => ({
      ...store,
      intakeMarks: {
        ...store.intakeMarks,
        openSessions: async () => {
          reads++
          return await store.intakeMarks.openSessions()
        },
      },
    }),
  })
  try {
    setSystemTime(x.h.clock.now)
    await x.sender.run("thread_send", { thread: "dur-on-b", message: "one", idempotency_key: "k1" })
    await x.consumer.idle()
    const after = reads
    x.h.clock.now += 1_000
    setSystemTime(x.h.clock.now)
    await x.sender.run("thread_send", { thread: "dur-on-b", message: "two", idempotency_key: "k2" })
    await x.consumer.idle()
    expect(reads).toBe(after)
    expect(timers.filter((timer) => !timer.cancelled).map((timer) => timer.ms)).toEqual([86_400_000])
  } finally {
    await x.cleanup()
  }
})

test("a holder that wakes the session late but before the deadline delivers once, and nothing is reported expired", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    const first = await x.sender.run("thread_send", args)
    if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
      throw new Error("send did not return a delivery id")
    const ledgerId = `device:a/${first.delivery_id}`
    x.h.clock.now += 86_399_999
    setSystemTime(x.h.clock.now)
    await x.drain.drain({ reason: "command" })
    x.runtime.endTurn()
    x.h.clock.now += 1
    setSystemTime(x.h.clock.now)
    await x.consumer.reportDrained()
    await x.noticesSettled()
    expect(x.runtime.enqueueCount(ledgerId)).toBe(1)
    expect(x.runtime.transcriptEntries(ledgerId)).toBe(1)
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "applied" } })
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})

test.each(["settled first", "woken first"] as const)(
  "a holder that wakes the session after the deadline delivers nothing the sender was told expired (%s)",
  async (order) => {
    const x = await setup()
    try {
      setSystemTime(x.h.clock.now)
      const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
      const first = await x.sender.run("thread_send", args)
      if (first.kind !== "ok" || !("delivery_id" in first) || typeof first.delivery_id !== "string")
        throw new Error("send did not return a delivery id")
      x.h.clock.now += 86_400_000
      setSystemTime(x.h.clock.now)
      if (order === "settled first") {
        await x.consumer.reportDrained()
        await x.drain.drain({ reason: "command" })
      } else {
        await x.drain.drain({ reason: "command" })
        await x.consumer.reportDrained()
      }
      await x.noticesSettled()
      expect(x.runtime.enqueueCalls).toHaveLength(0)
      expect(await x.store.list({ target_durable_id: "dur-on-b" })).toMatchObject([
        { state: "refused", reason: "expired" },
      ])
      const held = await x.sender.store.remoteReceipt({
        now: x.sender.store.now(),
        principal: "session:dur-caller",
        delivery_id: first.delivery_id,
      })
      expect(held?.result.outcome).toEqual({ kind: "refused", reason: "expired" })
      expect(x.counts).toEqual({ forward: 1, reverse: 1, wakes: 1, queries: 0 })
    } finally {
      await x.cleanup()
    }
  },
)

test("a partition across the deadline returns unavailable until authorized recovery", async () => {
  const x = await setup()
  try {
    setSystemTime(x.h.clock.now)
    const args = { thread: "dur-on-b", message: "one", idempotency_key: "k" }
    await x.sender.run("thread_send", args)
    x.link.connected = false
    x.h.clock.now += 86_400_000
    setSystemTime(x.h.clock.now)
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "outcome_unavailable" } })
    expect(await x.store.list({ target_durable_id: "dur-on-b" })).toMatchObject([{ state: "queued" }])
    x.link.connected = true
    expect(await x.sender.run("thread_send", args)).toMatchObject({ outcome: { kind: "refused", reason: "expired" } })
    expect(x.counts).toEqual({ forward: 1, reverse: 0, wakes: 1, queries: 1 })
  } finally {
    await x.cleanup()
  }
})
