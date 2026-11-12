import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { WAKE_LEASE_MS } from "./constants"
import { createInboxDrain, type IntakeAdmission } from "./drain"
import type { GatewayStore } from "./store"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRequest } from "./types"

// Admission at run and the opening gate (#13037 design 5.6, A2.2, A3.1.5): before the drain claims an intake row it
// asks whether the sending device is admitted now; a no settles the row refused, no answer skips that device's rows
// only, and a same-device row is never asked about. While a woken session's row is opening, nothing is admitted.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function intake(h: GatewayHarness, deliveryId: string, device: string): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: device,
    record: {
      sessionId: "t",
      deliveryId,
      text: `OMO_GATEWAY v=1\n\n${deliveryId}`,
      displayText: deliveryId,
      sender: { kind: "agent", session_id: "sender-s" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

function drainFor(
  h: GatewayHarness,
  store: GatewayStore,
  options: { readonly admit?: (device: string) => Promise<IntakeAdmission>; readonly gated?: boolean } = {},
) {
  const runtime = new FakeSessionRuntime(join(h.agentDir, "sessions", "t.jsonl"), "t", h.agentDir)
  const asked: string[] = []
  const drain = createInboxDrain({
    store,
    runtime,
    durableId: "t",
    sessionPath: () => runtime.sessionPath,
    now: () => h.clock.now,
    ...(options.admit === undefined
      ? {}
      : {
          admitIntake: async (device: string) => {
            asked.push(device)
            return await (options.admit ?? (async () => "admitted" as const))(device)
          },
        }),
    ...(options.gated === undefined ? {} : { wakeGated: async () => options.gated === true }),
  })
  return { runtime, drain, asked }
}

describe("admission at run", () => {
  test("#given intake rows of an admitted and a refused device #when the drain runs #then the admitted row is admitted and the refused one settles refused sender_not_admitted", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-ok", "dev-ok"))
    await store.intake(intake(h, "d-no", "dev-no"))
    const { runtime, drain } = drainFor(h, store, {
      admit: async (device) => (device === "dev-ok" ? "admitted" : "refused"),
    })
    await drain.drain({ reason: "command" })
    expect(runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual(["device:dev-ok/d-ok"])
    expect((await store.list({ target_durable_id: "t" })).map((row) => [row.ledger_id, row.state, row.reason])).toEqual([
      ["device:dev-ok/d-ok", "admitted", null],
      ["device:dev-no/d-no", "refused", "sender_not_admitted"],
    ])
  })

  test("#given the device service does not answer for one device #when the drain runs #then only that device's rows wait and a same-device row behind them is admitted without asking", async () => {
    const h = (harness = createGatewayHarness())
    const sender = h.session("a")
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-silent"))
    h.phantom("t")
    const local = await sender.engine.deliver({ sender: { kind: "session", durable_id: "a" }, target: "t", text: "local" })
    if (local.kind !== "ok") throw new Error("local send refused")
    const { runtime, drain, asked } = drainFor(h, store, { admit: async () => "unknown" })
    await drain.drain({ reason: "command" })
    expect(runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual([local.delivery_id])
    expect(asked).toEqual(["dev-silent"])
    expect((await store.list({ target_durable_id: "t" })).find((row) => row.ledger_id !== null)?.state).toBe("queued")
  })

  test("#given a drain with no way to ask the device service #when an intake row is queued #then no turn opens from it", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-a"))
    const { runtime, drain } = drainFor(h, store)
    await drain.drain({ reason: "command" })
    expect(runtime.enqueueCalls).toEqual([])
  })
})

describe("the opening gate", () => {
  test("#given the woken session's row is opening with a live lease #when the drain runs #then nothing is admitted and the queued rows are reported held", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-a"))
    await store.woken.request({ durable_id: "t", session_file: "/sessions/t.jsonl" })
    await store.woken.start({ durable_id: "t" })
    const { runtime, drain } = drainFor(h, store, { admit: async () => "admitted", gated: true })
    expect(await drain.drain({ reason: "command" })).toEqual({
      admitted: [{ delivery_id: expect.any(String), kind: "held_draft" }],
    })
    expect(runtime.enqueueCalls).toEqual([])
  })

  test("#given the opening row's lease ran out #when the drain runs with the store's gate #then it admits as usual", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-a"))
    await store.woken.request({ durable_id: "t", session_file: "/sessions/t.jsonl" })
    await store.woken.start({ durable_id: "t" })
    h.clock.now += WAKE_LEASE_MS + 1
    const runtime = new FakeSessionRuntime(join(h.agentDir, "sessions", "t.jsonl"), "t", h.agentDir)
    const drain = createInboxDrain({
      store,
      runtime,
      durableId: "t",
      sessionPath: () => runtime.sessionPath,
      now: () => h.clock.now,
      admitIntake: async () => "admitted",
      wakeGated: () => store.woken.gated({ durable_id: "t" }),
    })
    await drain.drain({ reason: "command" })
    expect(runtime.enqueueCalls).toHaveLength(1)
  })
})
